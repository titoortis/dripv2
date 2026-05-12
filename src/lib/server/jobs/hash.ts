import { createHash } from "node:crypto";

/**
 * Canonical idempotency key for a `GenerationJob`. Identical inputs hashed
 * twice for the same session collide and short-circuit to the existing job
 * (see `@@unique([sessionId, requestHash])` and `/api/jobs` POST).
 *
 * `referenceMode` participates in the hash so a preset that internally
 * switches from `first_frame` to `reference_images` (or vice versa) hashes
 * differently — same image + same preset + different submit pathway is a
 * legitimately different job.
 *
 * Backward stability: when `referenceMode === "first_frame"` (the default),
 * the field is omitted from the canonical string. That keeps every hash
 * computed before this column existed byte-identical to its current value,
 * so existing idempotency keys in production DBs continue to match new
 * computations for the same logical inputs.
 */
export function requestHash(input: {
  presetId: string;
  sourceImageId: string;
  modelId: string;
  ratio: string;
  resolution: string;
  durationSec: number;
  generateAudio: boolean;
  promptTemplate: string;
  /** Defaults to `"first_frame"`; omitted from the canonical string at
   *  that default to preserve hash stability for legacy rows. */
  referenceMode?: "first_frame" | "reference_images";
}): string {
  const parts = [
    `preset:${input.presetId}`,
    `image:${input.sourceImageId}`,
    `model:${input.modelId}`,
    `ratio:${input.ratio}`,
    `resolution:${input.resolution}`,
    `duration:${input.durationSec}`,
    `audio:${input.generateAudio ? "1" : "0"}`,
    `prompt:${input.promptTemplate}`,
  ];
  const mode = input.referenceMode ?? "first_frame";
  if (mode !== "first_frame") {
    parts.push(`refmode:${mode}`);
  }
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
