import { randomUUID } from "node:crypto";
import { env } from "../env";
import { logError, logEvent } from "../logger";
import { prisma } from "../prisma";
import { openAiImage, OpenAiImageError } from "../providers/openai-image";
import {
  seedance,
  SeedanceError,
  type ImageRole,
  type ProviderTaskStatus,
} from "../providers/seedance";
import { storage } from "../storage";
import { maybeRefundJob } from "../wallet";
import { classifyFailure, isTerminal } from "./types";

export type StartJobInput = {
  jobId: string;
};

type TerminalStatus = "failed" | "cancelled" | "expired";

/**
 * Single writer for every terminal failure on a `GenerationJob`. Derives
 * `failureKind` from `errorCode` so we never have to remember to compute
 * it at the call site. Refund attempt is the caller's responsibility —
 * `markJobTerminal` doesn't call `maybeRefundJob`, because some callers
 * (e.g. completed path) don't need it and others (e.g. cancelled by
 * user) explicitly should not. Keep this helper pure-write so call
 * sites stay obvious.
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
 * Mode selection:
 *   - Default (and whenever the kill switch is off): `first_frame` —
 *     the user's uploaded source image is sent with role="first_frame",
 *     i.e. the legacy Seedance image-to-video baseline.
 *   - When `PROVIDER_REFERENCE_MODE_ENABLED` is on AND the preset opts in
 *     via `preset.referenceMode === "reference_images"`, the same source
 *     image URL is sent with role="reference_image". No provider-side
 *     asset upload; the only thing that changes between the two modes is
 *     the `role` label on the image content entry.
 */
export async function submitJob({ jobId }: StartJobInput): Promise<void> {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    // `outfitSourceImage` is the optional PR-B input — null on every
    // legacy preset (every preset today), populated only when the
    // selected preset has `referenceSheetPromptTemplate` set and the
    // client sent an `outfitSourceImageId` on the submit. Prisma
    // returns `null` for the optional relation when the FK column is
    // null, so the rest of the runner can just check the value.
    include: { preset: true, sourceImage: true, outfitSourceImage: true },
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

  // Pre-transform pipeline (PR: f1_pilot_v1):
  //   When the preset opts in via `transformPromptTemplate`, we first
  //   restage the user's uploaded photo through OpenAI Images Edit
  //   (model = `env.OPENAI_IMAGE_MODEL`, default `gpt-image-1`) and
  //   persist the edited PNG to our storage. The resulting public URL
  //   replaces `sourceImage.publicUrl` in the Seedance task body. The
  //   role label is forced to `first_frame` because the edited PNG is
  //   the desired first frame — Seedance does not need to do its own
  //   reference-image character lift on top.
  //
  // Reference-sheet pipeline (PR-B):
  //   When the preset opts in via `referenceSheetPromptTemplate` AND the
  //   job has an `outfitSourceImageId` (the API already required this at
  //   submit time), we compose a multi-view character sheet from the
  //   primary source image + the outfit reference via OpenAI Images Edit
  //   `image[]` multi-image upload form, persist the composed PNG as a
  //   new `SourceImage` row, and substitute it for the primary source
  //   image at the start of the pipeline. The pre-transform step, if
  //   also enabled, then runs against the reference-sheet PNG instead
  //   of the user's raw upload. Legacy presets skip this stage entirely.
  const useReferenceSheet = Boolean(
    job.preset.referenceSheetPromptTemplate && job.outfitSourceImage,
  );
  const usePreTransform = Boolean(job.preset.transformPromptTemplate);
  const useReferenceImageRole =
    !usePreTransform &&
    env().PROVIDER_REFERENCE_MODE_ENABLED &&
    job.preset.referenceMode === "reference_images";
  const role: ImageRole = useReferenceImageRole ? "reference_image" : "first_frame";

  // Stamp the wall-clock deadline as soon as we start working a job.
  const ensureExpiresAt = job.expiresAt
    ? undefined
    : new Date(Date.now() + env().JOB_WALL_CLOCK_TIMEOUT_MS);

  await prisma.generationJob.update({
    where: { id: job.id },
    data: {
      status: "uploading",
      attempts: { increment: 1 },
      role,
      ...(ensureExpiresAt ? { expiresAt: ensureExpiresAt } : {}),
    },
  });
  logEvent("job_transition", {
    job_id: job.id,
    preset_id: job.presetId,
    from: job.status,
    to: "uploading",
    attempts: job.attempts + 1,
    role,
    pre_transform: usePreTransform,
    reference_sheet: useReferenceSheet,
  });

  try {
    let providerImageUrl = job.sourceImage.publicUrl;
    let providerImageMime = job.sourceImage.mimeType;

    if (useReferenceSheet) {
      // The outer `useReferenceSheet` guard already proved both of these
      // are non-null; assert them through with `!` to satisfy TS without
      // re-narrowing the values.
      const outfit = job.outfitSourceImage!;
      await prisma.generationJob.update({
        where: { id: job.id },
        data: { status: "generating_reference_sheet" },
      });
      logEvent("job_transition", {
        job_id: job.id,
        preset_id: job.presetId,
        from: "uploading",
        to: "generating_reference_sheet",
      });
      const refSheet = await runComposeReferenceSheet({
        jobId: job.id,
        sources: [
          {
            sourceImageUrl: job.sourceImage.publicUrl,
            sourceMimeType: job.sourceImage.mimeType,
          },
          {
            sourceImageUrl: outfit.publicUrl,
            sourceMimeType: outfit.mimeType,
          },
        ],
        prompt: job.preset.referenceSheetPromptTemplate!,
      });
      providerImageUrl = refSheet.publicUrl;
      providerImageMime = refSheet.mimeType;
    }

    if (usePreTransform) {
      providerImageUrl = await runPreTransform({
        jobId: job.id,
        sourceImageUrl: providerImageUrl,
        sourceMimeType: providerImageMime,
        prompt: job.preset.transformPromptTemplate!,
      });
    }

    logEvent("job_pre_submit", {
      job_id: job.id,
      role,
      preset_id: job.presetId,
      pre_transform: usePreTransform,
      reference_sheet: useReferenceSheet,
      image_url: providerImageUrl,
    });
    const { providerTaskId } = await seedance.createImageToVideoTask({
      modelId: job.providerModelId,
      promptText: job.preset.promptTemplate,
      imageUrl: providerImageUrl,
      role,
      ratio: job.preset.aspectRatio,
      resolution: job.resolution,
      durationSec: job.durationSec,
      generateAudio: job.preset.generateAudio,
    });
    logEvent("job_submit_success", { job_id: job.id, providerTaskId, role });

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
      role,
    });
  } catch (err) {
    logError("job_submit_error", err, {
      job_id: job.id,
      preset_id: job.presetId,
      model_id: job.providerModelId,
      role,
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
  const code = errorCodeFor(err);
  await markJobTerminal({ jobId, status: "failed", errorCode: code, errorReason: reason });
  await maybeRefundJob(jobId);
}

function errorCodeFor(err: unknown): string {
  if (err instanceof SeedanceError) {
    return err.providerCode ?? `http_${err.httpStatus}`;
  }
  if (err instanceof OpenAiImageError) {
    if (err.providerCode === "missing_api_key") return "missing_api_key";
    if (err.providerCode === "source_download_failed") return "transform_source_download_failed";
    if (err.providerCode === "no_image_data") return "transform_no_image_data";
    if (err.providerCode) return `transform_${err.providerCode}`;
    return `transform_http_${err.httpStatus}`;
  }
  return "internal_error";
}

/**
 * Run the optional pre-transform step (OpenAI Images Edit → persist PNG to
 * storage) and return the public URL that should be handed to Seedance.
 * Throws on any failure so the caller's `markFailedFromError` can map it
 * to the right `errorCode` and refund taxonomy.
 */
async function runPreTransform(args: {
  jobId: string;
  sourceImageUrl: string;
  sourceMimeType: string;
  prompt: string;
}): Promise<string> {
  if (!openAiImage.hasCredentials()) {
    throw new OpenAiImageError("OPENAI_API_KEY is not configured.", {
      httpStatus: 0,
      providerCode: "missing_api_key",
    });
  }
  logEvent("job_pre_transform_start", {
    job_id: args.jobId,
    model: env().OPENAI_IMAGE_MODEL,
  });
  const t0 = Date.now();
  const edited = await openAiImage.editImage({
    sourceImageUrl: args.sourceImageUrl,
    sourceMimeType: args.sourceMimeType,
    prompt: args.prompt,
    size: "1024x1536",
    quality: "high",
  });
  const key = `transforms/${args.jobId}/${randomUUID()}.png`;
  const stored = await storage().put({
    key,
    body: edited.pngBuffer,
    contentType: edited.mime,
  });
  logEvent("job_pre_transform_success", {
    job_id: args.jobId,
    storage_key: stored.storageKey,
    public_url: stored.publicUrl,
    bytes: stored.bytes,
    elapsed_ms: Date.now() - t0,
  });
  return stored.publicUrl;
}

/**
 * PR-B stage-1: compose a multi-view character reference sheet from the
 * primary source image + an outfit reference via OpenAI Images Edit's
 * `image[]` multi-image upload form. Persists the composed PNG as a new
 * `SourceImage` row (so the operator history stays inspectable) and
 * returns just the public URL + MIME so the caller can keep feeding it
 * through the rest of the pipeline.
 *
 * Errors are surfaced as `OpenAiImageError` exactly the way
 * `runPreTransform` does, so `errorCodeFor` maps them into the same
 * `transform_*` / `transform_http_*` code prefixes the wallet already
 * understands — no new refundable code is introduced by PR-B.
 *
 * The new `SourceImage` row is intentionally NOT linked to the
 * `GenerationJob` (PR-B does not add a `refSheetImageId` column). It is
 * a transient pipeline artefact whose lifetime mirrors the job's; we
 * keep it in `SourceImage` so the bytes have a queryable home and so
 * that `storage()` adapters that key off the table see the row, but the
 * job-row stays narrow to what PR-B's scope allowed.
 */
async function runComposeReferenceSheet(args: {
  jobId: string;
  sources: Array<{ sourceImageUrl: string; sourceMimeType: string }>;
  prompt: string;
}): Promise<{ publicUrl: string; mimeType: string }> {
  if (!openAiImage.hasCredentials()) {
    throw new OpenAiImageError("OPENAI_API_KEY is not configured.", {
      httpStatus: 0,
      providerCode: "missing_api_key",
    });
  }
  logEvent("job_compose_reference_sheet_start", {
    job_id: args.jobId,
    model: env().OPENAI_IMAGE_MODEL,
    sources: args.sources.length,
  });
  const t0 = Date.now();
  const composed = await openAiImage.composeReferenceSheet({
    sources: args.sources,
    prompt: args.prompt,
    size: "1024x1536",
    quality: "high",
  });
  const key = `reference-sheets/${args.jobId}/${randomUUID()}.png`;
  const stored = await storage().put({
    key,
    body: composed.pngBuffer,
    contentType: composed.mime,
  });
  const row = await prisma.sourceImage.create({
    data: {
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      mimeType: composed.mime,
      bytes: stored.bytes,
    },
  });
  logEvent("job_compose_reference_sheet_success", {
    job_id: args.jobId,
    source_image_id: row.id,
    storage_key: stored.storageKey,
    public_url: stored.publicUrl,
    bytes: stored.bytes,
    elapsed_ms: Date.now() - t0,
  });
  return { publicUrl: stored.publicUrl, mimeType: composed.mime };
}
