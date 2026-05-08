/**
 * Provider-verification gate.
 *
 * The locked product surface (480p / 720p / 1080p × 5s / 10s / 15s) is what
 * the multipliers price for, but PR 6 only opens combos that have been live-
 * validated against BytePlus end-to-end. PR 4 proved exactly one combo:
 * 720p × 5s (`iron_hero_v1` happy-path, task `cgt-20260508235237-kp6rg`,
 * H.264 720×1280, 5.04 s, mp4 re-hosted on our storage).
 *
 * As more combos are live-verified, append them to `PROVIDER_VERIFIED_COMBOS`
 * — one PR per verified combo, with the live evidence in the PR description.
 * Do not bulk-add. Each entry is a contract that we will render at that
 * quality without silent failure.
 *
 * The picker (UI) hides any combo not in this set; the API rejects any combo
 * not in this set with `verification_pending`. Both sides query the same
 * source of truth via `isCombo Verified` so the gate cannot drift.
 */

import type { Resolution, Duration } from "@/lib/pricing";

export type VerifiedCombo = { resolution: Resolution; durationSec: Duration };

export const PROVIDER_VERIFIED_COMBOS: readonly VerifiedCombo[] = [
  { resolution: "720p", durationSec: 5 },
];

export function isComboVerified(input: { resolution: Resolution; durationSec: Duration }): boolean {
  return PROVIDER_VERIFIED_COMBOS.some(
    (c) => c.resolution === input.resolution && c.durationSec === input.durationSec,
  );
}
