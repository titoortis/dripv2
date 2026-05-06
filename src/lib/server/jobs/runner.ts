import { randomUUID } from "node:crypto";
import { env } from "../env";
import { prisma } from "../prisma";
import { seedance, SeedanceError, type ProviderTaskStatus } from "../providers/seedance";
import { storage } from "../storage";
import { isTerminal } from "./types";

export type StartJobInput = {
  jobId: string;
};

/**
 * Submit a `queued` or `uploading` job to Seedance. Idempotent: if the job
 * already has a `providerTaskId` it is left alone.
 */
export async function submitJob({ jobId }: StartJobInput): Promise<void> {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    include: { preset: true, sourceImage: true },
  });
  if (!job) return;
  if (job.providerTaskId) return;
  if (isTerminal(job.status)) return;

  if (!seedance.hasCredentials()) {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorCode: "missing_api_key",
        errorReason:
          "ARK_API_KEY is not configured. Set it in the environment to enable real generation.",
      },
    });
    return;
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: { status: "uploading", attempts: { increment: 1 } },
  });

  try {
    const { providerTaskId } = await seedance.createImageToVideoTask({
      modelId: job.providerModelId,
      promptText: job.preset.promptTemplate,
      imageUrl: job.sourceImage.publicUrl,
      ratio: job.preset.aspectRatio,
      resolution: job.preset.resolution,
      durationSec: job.preset.durationSec,
      generateAudio: job.preset.generateAudio,
    });

    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: "submitted",
        providerTaskId,
        nextPollAt: new Date(Date.now() + env().POLL_MIN_INTERVAL_MS),
        pollStartedAt: new Date(),
        expiresAt: new Date(Date.now() + env().JOB_WALL_CLOCK_TIMEOUT_MS),
      },
    });
  } catch (err) {
    await markFailedFromError(jobId, err);
  }
}

/**
 * Pull provider state once and update the job. Safe to call repeatedly.
 */
export async function pollOnce(jobId: string): Promise<void> {
  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (!job.providerTaskId) return;
  if (isTerminal(job.status)) return;

  if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: "expired",
        errorCode: "wall_clock_timeout",
        errorReason: "Generation did not complete in time.",
      },
    });
    return;
  }

  try {
    const task = await seedance.getTask(job.providerTaskId);
    const mapped = seedance.mapStatus(task.status);

    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        providerStatus: task.status,
        status: mapTo(mapped),
        nextPollAt: nextPollDate(),
      },
    });

    if (mapped === "succeeded") {
      const videoUrl = task.content?.video_url;
      if (!videoUrl) {
        await prisma.generationJob.update({
          where: { id: jobId },
          data: {
            status: "failed",
            errorCode: "succeeded_without_url",
            errorReason: "Provider reported succeeded but no video_url was returned.",
          },
        });
        return;
      }
      await persistResult(jobId, videoUrl, task.content?.last_frame_url);
    } else if (mapped === "failed" || mapped === "expired" || mapped === "cancelled") {
      await prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: mapped === "expired" ? "expired" : mapped === "cancelled" ? "cancelled" : "failed",
          errorCode: task.error?.code ?? mapped,
          errorReason: task.error?.message ?? `Provider reported ${task.status}`,
        },
      });
    }
  } catch (err) {
    if (err instanceof SeedanceError && err.httpStatus >= 500) {
      // transient — keep polling, do not flip terminal
      await prisma.generationJob.update({
        where: { id: jobId },
        data: { nextPollAt: nextPollDate() },
      });
      return;
    }
    await markFailedFromError(jobId, err);
  }
}

async function persistResult(jobId: string, sourceUrl: string, lastFrameUrl?: string) {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorCode: "download_failed",
        errorReason: `Could not download result: HTTP ${res.status}`,
      },
    });
    return;
  }
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const key = `videos/${jobId}/${randomUUID()}.mp4`;
  const stored = await storage().put({ key, body: buf, contentType: "video/mp4" });

  const result = await prisma.resultVideo.create({
    data: {
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      bytes: stored.bytes,
      lastFrameUrl: lastFrameUrl ?? null,
    },
  });

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      resultVideoId: result.id,
      nextPollAt: null,
    },
  });
}

function mapTo(p: ProviderTaskStatus): "submitted" | "processing" | "completed" | "failed" | "cancelled" | "expired" {
  switch (p) {
    case "queued":
      return "submitted";
    case "running":
      return "processing";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
  }
}

function nextPollDate(): Date {
  const min = env().POLL_MIN_INTERVAL_MS;
  const max = env().POLL_MAX_INTERVAL_MS;
  // simple linear backoff between min and max
  const ms = Math.min(max, Math.floor(min + Math.random() * (max - min)));
  return new Date(Date.now() + ms);
}

async function markFailedFromError(jobId: string, err: unknown) {
  const reason =
    err instanceof Error ? err.message : typeof err === "string" ? err : "unknown error";
  const code =
    err instanceof SeedanceError && err.providerCode
      ? err.providerCode
      : err instanceof SeedanceError
        ? `http_${err.httpStatus}`
        : "internal_error";
  await prisma.generationJob.update({
    where: { id: jobId },
    data: { status: "failed", errorCode: code, errorReason: reason },
  });
}
