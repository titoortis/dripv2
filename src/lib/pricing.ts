/**
 * Pricing engine — pure, deterministic, integer-credit cost computation.
 *
 * Single source of truth for both:
 *   - the live cost preview shown next to the Generate button on `/create`;
 *   - the actual debit written to the `JobLedgerEntry` at submit time.
 *
 * Display-must-match-charged is enforced by *both* call sites importing this
 * module and feeding it the same inputs. There is no second formula anywhere.
 *
 * Locked product surface (480p / 720p / 1080p × 5s / 10s / 15s) and the
 * multiplier table below are the operator's pricing decision; do not edit
 * these constants without a product-side approval.
 *
 * Rounding: `Math.ceil`. Conservative — never under-charge for partial-credit
 * arithmetic — and gives a clean "ish, rounded up" mental model. The alternative
 * (`Math.round`) was considered and rejected because at 720p × 10s and
 * 1080p × 10s it would charge less than `ceil` (3 vs 4 and 5 vs 6 credits
 * respectively), which is not the desired posture.
 *
 * Baseline: 1 credit at the cheapest combo (480p × 5s). Under the locked
 * multipliers this means 720p × 5s costs 2 credits, an explicit price change
 * from PR 4 (where every combo was a flat 1 credit because pricing wasn't
 * wired). Acknowledged at PR 6 spec time.
 */

export type Resolution = "480p" | "720p" | "1080p";
export type Duration = 5 | 10 | 15;

const RESOLUTION_MULTIPLIER: Record<Resolution, number> = {
  "480p": 1.0,
  "720p": 1.8,
  "1080p": 3.0,
};

const DURATION_MULTIPLIER: Record<Duration, number> = {
  5: 1.0,
  10: 1.8,
  15: 2.6,
};

/** 1 credit at the cheapest combo (480p × 5s). */
const BASELINE_CREDITS = 1;

export const RESOLUTION_VOCAB: readonly Resolution[] = ["480p", "720p", "1080p"];
export const DURATION_VOCAB: readonly Duration[] = [5, 10, 15];

export function isResolution(value: unknown): value is Resolution {
  return typeof value === "string" && (RESOLUTION_VOCAB as readonly string[]).includes(value);
}

export function isDuration(value: unknown): value is Duration {
  return typeof value === "number" && (DURATION_VOCAB as readonly number[]).includes(value);
}

/**
 * Integer credit cost for a (resolution, duration) combo. Throws on unknown
 * vocabulary — call sites must validate first via `isResolution` /
 * `isDuration` (or zod). Exceptions here mean the caller has a bug; they
 * should not surface to the user.
 */
export function computeCost(input: { resolution: Resolution; durationSec: Duration }): number {
  const r = RESOLUTION_MULTIPLIER[input.resolution];
  const d = DURATION_MULTIPLIER[input.durationSec];
  if (r === undefined || d === undefined) {
    throw new Error(
      `pricing.computeCost: unknown combo r=${input.resolution} d=${input.durationSec}`,
    );
  }
  return Math.ceil(BASELINE_CREDITS * r * d);
}

/**
 * Reference cost matrix — useful for tests and documentation. Recomputed
 * deterministically from the multipliers above; do not hand-edit.
 *
 *           5s   10s  15s
 *   480p:    1    2    3
 *   720p:    2    4    5
 *   1080p:   3    6    8
 */
export const COST_MATRIX: Readonly<Record<Resolution, Readonly<Record<Duration, number>>>> = {
  "480p": {
    5: computeCost({ resolution: "480p", durationSec: 5 }),
    10: computeCost({ resolution: "480p", durationSec: 10 }),
    15: computeCost({ resolution: "480p", durationSec: 15 }),
  },
  "720p": {
    5: computeCost({ resolution: "720p", durationSec: 5 }),
    10: computeCost({ resolution: "720p", durationSec: 10 }),
    15: computeCost({ resolution: "720p", durationSec: 15 }),
  },
  "1080p": {
    5: computeCost({ resolution: "1080p", durationSec: 5 }),
    10: computeCost({ resolution: "1080p", durationSec: 10 }),
    15: computeCost({ resolution: "1080p", durationSec: 15 }),
  },
};
