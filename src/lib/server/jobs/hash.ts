import { createHash } from "node:crypto";

export function requestHash(input: {
  presetId: string;
  sourceImageId: string;
  modelId: string;
  ratio: string;
  resolution: string;
  durationSec: number;
  generateAudio: boolean;
  promptTemplate: string;
}): string {
  const canonical = [
    `preset:${input.presetId}`,
    `image:${input.sourceImageId}`,
    `model:${input.modelId}`,
    `ratio:${input.ratio}`,
    `resolution:${input.resolution}`,
    `duration:${input.durationSec}`,
    `audio:${input.generateAudio ? "1" : "0"}`,
    `prompt:${input.promptTemplate}`,
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
