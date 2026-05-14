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
 * `outfitSourceImageId` and `referenceSheetPromptTemplate` participate in
 * the hash for presets that opt into PR-B's reference-sheet stage. Two
 * submits with the same primary image but different outfit references
 * (or a preset whose reference-sheet prompt changes between rows) are
 * legitimately different jobs.
 *
 * Backward stability: each of the three optional fields above is omitted
 * from the canonical string when null or at its default. Every hash that
 * was computed before any of these fields existed therefore remains
 * byte-identical to its current value when recomputed for the same
 * logical inputs, so existing idempotency keys in production DBs
 * continue to match new computations.
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
  /** PR-B: optional second `SourceImage` reference. Omitted from the
   *  canonical string when null/undefined to preserve byte-stability
   *  for every job that doesn't use the reference-sheet stage (every
   *  preset today). */
  outfitSourceImageId?: string | null;
  /** PR-B: the preset's reference-sheet prompt template at submit time.
   *  Participates in the hash so editing the template makes future
   *  submits produce a new job rather than colliding with the old one.
   *  Omitted from the canonical string when null/undefined. */
  referenceSheetPromptTemplate?: string | null;
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
  if (input.outfitSourceImageId) {
    parts.push(`outfit:${input.outfitSourceImageId}`);
  }
  if (input.referenceSheetPromptTemplate) {
    parts.push(`refsheet:${input.referenceSheetPromptTemplate}`);
  }
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
