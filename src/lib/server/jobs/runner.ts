import { randomUUID } from "node:crypto";
import type { ProviderAsset } from "@prisma/client";
import { env } from "../env";
import { logError, logEvent } from "../logger";
import { prisma } from "../prisma";
import {
  seedance,
  SeedanceError,
  referenceImageUriForFile,
  type ProviderTaskStatus,
} from "../providers/seedance";
import {
  ensureProviderAsset,
  refreshProviderAsset,
  ProviderAssetError,
} from "../providers/asset-lifecycle";
import { storage } from "../storage";
import { maybeRefundJob } from "../wallet";
import { classifyFailure, isTerminal } from "./types";

export type StartJobInput = {
  jobId: string;
};

type TerminalStatus = "failed" | "cancelled" | "expired";

/**
 * Single writer for every terminal failure on a `GenerationJob`. Derives
 * `failureKind` from `errorCode` (PR #29) so we never have to remember to
 * compute it at the call site. Refund attempt is the caller's
 * responsibility — `markJobTerminal` doesn't call `maybeRefundJob`,
 * because some callers (e.g. completed path) don't need it and others
 * (e.g. cancelled by user) explicitly should not. Keep this helper
 * pure-write so call sites stay obvious.
 */
async function markJobTerminal(opts: {
  jobId: string;
  status: TerminalStatus;
  errorCode: string;
  errorReason: string;
}): Promise<void> {
  await prisma.generationJob.update({
    where: { id: opts.jobId },
    data: {
      status: opts.status,
      errorCode: opts.errorCode,
      errorReason: opts.errorReason,
      failureKind: classifyFailure(opts.errorCode),
    },
  });
}

/**
 * Submit a non-terminal job to the provider. Idempotent — bails if the
 * job already has a `providerTaskId`.
 *
 * Branching (PR #29):
 *   - first_frame mode (default, or when PROVIDER_REFERENCE_MODE_ENABLED
 *     is off): the legacy path. Job goes queued → uploading → submitted
 *     and we pass `imageUrl: job.sourceImage.publicUrl` to Seedance.
 *   - reference_images mode (PROVIDER_REFERENCE_MODE_ENABLED is on AND
 *     `preset.referenceMode === "reference_images"`): job goes queued →
 *     provisioning → uploading → submitted. `provisioning` covers the
 *     time between issuing the provider Files API upload and observing
 *     `active` status. The poller re-enters `submitJob` while the job
 *     sits in `provisioning`.
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
    await markJobTerminal({
      jobId,
      status: "failed",
      errorCode: "missing_api_key",
      errorReason:
        "ARK_API_KEY is not configured. Set it in the environment to enable real generation.",
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

  const useReferenceImagesMode =
    env().PROVIDER_REFERENCE_MODE_ENABLED &&
    job.preset.referenceMode === "reference_images";

  // PR #29: stamp the wall-clock deadline as soon as we start working a
  // job, not only at `submitted`. Otherwise a job that's stuck in
  // `provisioning` (provider asset never reaches `active`) has no
  // deadline and `pollOnce` would never expire it. We use the existing
  // `JOB_WALL_CLOCK_TIMEOUT_MS` for the whole pipeline.
  const ensureExpiresAt = job.expiresAt
    ? undefined
    : new Date(Date.now() + env().JOB_WALL_CLOCK_TIMEOUT_MS);

  if (!useReferenceImagesMode) {
    await submitFirstFrame({ job, ensureExpiresAt });
    return;
  }

  await submitReferenceImages({ job, ensureExpiresAt });
}

async function submitFirstFrame(opts: {
  job: NonNullable<Awaited<ReturnType<typeof loadJobWithRelations>>>;
  ensureExpiresAt: Date | undefined;
}): Promise<void> {
  const { job, ensureExpiresAt } = opts;
  await prisma.generationJob.update({
    where: { id: job.id },
    data: {
      status: "uploading",
      attempts: { increment: 1 },
      ...(ensureExpiresAt ? { expiresAt: ensureExpiresAt } : {}),
    },
  });
  logEvent("job_transition", {
    job_id: job.id,
    preset_id: job.presetId,
    from: job.status,
    to: "uploading",
    attempts: job.attempts + 1,
    mode: "first_frame",
  });

  try {
    const { providerTaskId } = await seedance.createImageToVideoTask({
      mode: "first_frame",
      modelId: job.providerModelId,
      promptText: job.preset.promptTemplate,
      imageUrl: job.sourceImage.publicUrl,
      ratio: job.preset.aspectRatio,
      resolution: job.resolution,
      durationSec: job.durationSec,
      generateAudio: job.preset.generateAudio,
    });

    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: "submitted",
        providerTaskId,
        nextPollAt: new Date(Date.now() + env().POLL_MIN_INTERVAL_MS),
        pollStartedAt: new Date(),
        ...(job.expiresAt ? {} : { expiresAt: new Date(Date.now() + env().JOB_WALL_CLOCK_TIMEOUT_MS) }),
      },
    });
    logEvent("job_transition", {
      job_id: job.id,
      preset_id: job.presetId,
      from: "uploading",
      to: "submitted",
      provider_task_id: providerTaskId,
      model_id: job.providerModelId,
      mode: "first_frame",
    });
  } catch (err) {
    logError("job_submit_error", err, {
      job_id: job.id,
      preset_id: job.presetId,
      model_id: job.providerModelId,
      mode: "first_frame",
    });
    await markFailedFromError(job.id, err);
  }
}

async function submitReferenceImages(opts: {
  job: NonNullable<Awaited<ReturnType<typeof loadJobWithRelations>>>;
  ensureExpiresAt: Date | undefined;
}): Promise<void> {
  const { job, ensureExpiresAt } = opts;

  // First pass through this job in reference_images mode: move it into
  // `provisioning` and bump attempts. Subsequent poller passes find it
  // already at `provisioning` and skip the increment.
  if (job.status === "queued") {
    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: "provisioning",
        attempts: { increment: 1 },
        ...(ensureExpiresAt ? { expiresAt: ensureExpiresAt } : {}),
      },
    });
    logEvent("job_transition", {
      job_id: job.id,
      preset_id: job.presetId,
      from: job.status,
      to: "provisioning",
      attempts: job.attempts + 1,
      mode: "reference_images",
    });
  }

  // Wall-clock guard for stuck provisioning. pollOnce only fires for jobs
  // in {submitted, processing} so we own the guard here.
  if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
    await markJobTerminal({
      jobId: job.id,
      status: "expired",
      errorCode: "provider_asset_timeout",
      errorReason:
        "Provider-side asset did not become active before the wall-clock deadline.",
    });
    logEvent("job_expired", {
      job_id: job.id,
      from: job.status,
      reason: "provider_asset_timeout",
    });
    await maybeRefundJob(job.id);
    return;
  }

  let asset: ProviderAsset;
  try {
    asset = await ensureProviderAsset(job.sourceImageId);
    if (asset.status === "processing") {
      // Refresh once in case the provider has already finished — saves
      // an extra poller tick on the common fast path.
      asset = await refreshProviderAsset(asset.id);
    }
  } catch (err) {
    await markFailedFromAssetError(job.id, err);
    return;
  }

  if (asset.status === "failed" || asset.status === "deleted" || asset.status === "expired") {
    await markJobTerminal({
      jobId: job.id,
      status: "failed",
      errorCode: "provider_asset_upload_failed",
      errorReason: `Provider asset ${asset.id} ended in status "${asset.status}".`,
    });
    logEvent("job_failed", {
      job_id: job.id,
      preset_id: job.presetId,
      from: job.status,
      reason: "provider_asset_upload_failed",
      provider_asset_id: asset.id,
      provider_asset_status: asset.status,
    });
    await maybeRefundJob(job.id);
    return;
  }

  if (asset.status !== "active") {
    // still processing — pin the job to `provisioning` and let the poller
    // retry. Track the asset id on the job so observers can correlate.
    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        providerAssetId: asset.id,
        nextPollAt: nextPollDate(),
      },
    });
    return;
  }

  // Asset is active. Move job → uploading → submitted on the reference
  // path. We intentionally still pass through `uploading` so any existing
  // UI / log consumer that keys off that state behaves consistently with
  // the first_frame path.
  await prisma.generationJob.update({
    where: { id: job.id },
    data: {
      status: "uploading",
      providerAssetId: asset.id,
    },
  });
  logEvent("job_transition", {
    job_id: job.id,
    preset_id: job.presetId,
    from: "provisioning",
    to: "uploading",
    mode: "reference_images",
    provider_asset_id: asset.id,
    provider_file_id: asset.providerFileId,
  });

  try {
    const { providerTaskId } = await seedance.createImageToVideoTask({
      mode: "reference_images",
      modelId: job.providerModelId,
      promptText: job.preset.promptTemplate,
      referenceImages: [referenceImageUriForFile(asset.providerFileId)],
      ratio: job.preset.aspectRatio,
      resolution: job.resolution,
      durationSec: job.durationSec,
      generateAudio: job.preset.generateAudio,
    });

    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: "submitted",
        providerTaskId,
        nextPollAt: new Date(Date.now() + env().POLL_MIN_INTERVAL_MS),
        pollStartedAt: new Date(),
        ...(job.expiresAt ? {} : { expiresAt: new Date(Date.now() + env().JOB_WALL_CLOCK_TIMEOUT_MS) }),
      },
    });
    logEvent("job_transition", {
      job_id: job.id,
      preset_id: job.presetId,
      from: "uploading",
      to: "submitted",
      provider_task_id: providerTaskId,
      provider_asset_id: asset.id,
      provider_file_id: asset.providerFileId,
      model_id: job.providerModelId,
      mode: "reference_images",
    });
  } catch (err) {
    logError("job_submit_error", err, {
      job_id: job.id,
      preset_id: job.presetId,
      model_id: job.providerModelId,
      mode: "reference_images",
      provider_asset_id: asset.id,
    });
    await markFailedFromError(job.id, err);
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
    await markJobTerminal({
      jobId,
      status: "expired",
      errorCode: "wall_clock_timeout",
      errorReason: "Generation did not complete in time.",
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
        await markJobTerminal({
          jobId,
          status: "failed",
          errorCode: "succeeded_without_url",
          errorReason: "Provider reported succeeded but no video_url was returned.",
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
      const terminal: TerminalStatus =
        mapped === "expired" ? "expired" : mapped === "cancelled" ? "cancelled" : "failed";
      const code = task.error?.code ?? mapped;
      await markJobTerminal({
        jobId,
        status: terminal,
        errorCode: code,
        errorReason: task.error?.message ?? `Provider reported ${task.status}`,
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
    await markJobTerminal({
      jobId,
      status: "failed",
      errorCode: "download_failed",
      errorReason: `Could not download result: HTTP ${res.status}`,
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
  await markJobTerminal({ jobId, status: "failed", errorCode: code, errorReason: reason });
  await maybeRefundJob(jobId);
}

async function markFailedFromAssetError(jobId: string, err: unknown) {
  const reason =
    err instanceof Error ? err.message : typeof err === "string" ? err : "unknown error";
  let code = "provider_asset_upload_failed";
  if (err instanceof ProviderAssetError) {
    code =
      err.code === "storage_fetch_failed"
        ? "provider_asset_storage_fetch_failed"
        : err.code === "provider_get_failed"
          ? "provider_asset_get_failed"
          : "provider_asset_upload_failed";
  }
  await markJobTerminal({ jobId, status: "failed", errorCode: code, errorReason: reason });
  logEvent("job_failed", {
    job_id: jobId,
    reason: code,
  });
  await maybeRefundJob(jobId);
}

async function loadJobWithRelations(jobId: string) {
  return prisma.generationJob.findUnique({
    where: { id: jobId },
    include: { preset: true, sourceImage: true },
  });
}
