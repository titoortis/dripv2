import { randomUUID } from "node:crypto";
import { env } from "../env";
import { logError, logEvent } from "../logger";
import { prisma } from "../prisma";
import { seedance, SeedanceError, type ProviderTaskStatus } from "../providers/seedance";
import { storage } from "../storage";
import { maybeRefundJob } from "../wallet";
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
    logEvent("job_failed", {
      job_id: jobId,
      preset_id: job.presetId,
      from: job.status,
      reason: "missing_api_key",
    });
    await maybeRefundJob(jobId);
    return;
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: { status: "uploading", attempts: { increment: 1 } },
  });
  logEvent("job_transition", {
    job_id: jobId,
    preset_id: job.presetId,
    from: job.status,
    to: "uploading",
    attempts: job.attempts + 1,
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
    logEvent("job_transition", {
      job_id: jobId,
      preset_id: job.presetId,
      from: "uploading",
      to: "submitted",
      provider_task_id: providerTaskId,
      model_id: job.providerModelId,
    });
  } catch (err) {
    logError("job_submit_error", err, {
      job_id: jobId,
      preset_id: job.presetId,
      model_id: job.providerModelId,
    });
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
    logEvent("job_expired", {
      job_id: jobId,
      from: job.status,
      provider_task_id: job.providerTaskId,
    });
    await maybeRefundJob(jobId);
    return;
  }

  try {
    const task = await seedance.getTask(job.providerTaskId);
    const mapped = seedance.mapStatus(task.status);
    const nextStatus = mapTo(mapped);

    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        providerStatus: task.status,
        status: nextStatus,
        nextPollAt: nextPollDate(),
      },
    });
    if (nextStatus !== job.status) {
      logEvent("job_transition", {
        job_id: jobId,
        from: job.status,
        to: nextStatus,
        provider_status: task.status,
        provider_task_id: job.providerTaskId,
      });
    }

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
        logEvent("job_failed", {
          job_id: jobId,
          from: nextStatus,
          reason: "succeeded_without_url",
          provider_task_id: job.providerTaskId,
        });
        await maybeRefundJob(jobId);
        return;
      }
      await persistResult(jobId, videoUrl, task.content?.last_frame_url);
    } else if (mapped === "failed" || mapped === "expired" || mapped === "cancelled") {
      const terminal = mapped === "expired" ? "expired" : mapped === "cancelled" ? "cancelled" : "failed";
      await prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: terminal,
          errorCode: task.error?.code ?? mapped,
          errorReason: task.error?.message ?? `Provider reported ${task.status}`,
        },
      });
      logEvent("job_terminal", {
        job_id: jobId,
        to: terminal,
        provider_status: task.status,
        provider_error_code: task.error?.code ?? null,
        provider_task_id: job.providerTaskId,
      });
      // Refund applies only to refundable codes (5xx, internal_error, etc).
      // Provider 4xx (bad photo) and `cancelled` don't refund — see wallet.ts.
      await maybeRefundJob(jobId);
    }
  } catch (err) {
    if (err instanceof SeedanceError && err.httpStatus >= 500) {
      // transient — keep polling, do not flip terminal
      await prisma.generationJob.update({
        where: { id: jobId },
        data: { nextPollAt: nextPollDate() },
      });
      logEvent("job_poll_transient", {
        job_id: jobId,
        http_status: err.httpStatus,
        provider_task_id: job.providerTaskId,
      });
      return;
    }
    logError("job_poll_error", err, {
      job_id: jobId,
      provider_task_id: job.providerTaskId,
    });
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
    await maybeRefundJob(jobId);
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
  await maybeRefundJob(jobId);
}
