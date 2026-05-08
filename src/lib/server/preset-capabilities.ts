/**
 * Preset capability CSV parsing — server-side helpers shared by `/api/presets`
 * and `/api/jobs` so the validation against the preset's supported set is the
 * same code in both places.
 *
 * SQLite has no first-class array type; the seed serializes the supported set
 * as a CSV (see `prisma/seed.ts`). These helpers split the CSV, drop unknown
 * vocabulary entries silently (a seed bug, not a client surface), and fall
 * back to the preset's baseline render setting if the CSV ends up empty.
 *
 * Order is preserved from the CSV. Callers that depend on a particular order
 * must sort defensively — see `/api/presets/route.ts` and `PresetSheet`.
 */

import {
  isDuration,
  isResolution,
  type Duration,
  type Resolution,
} from "@/lib/pricing";

export function parseSupportedResolutions(csv: string, fallback: Resolution): Resolution[] {
  const raw = csv
    .split(",")
    .map((s) => s.trim())
    .filter(isResolution);
  return raw.length > 0 ? raw : [fallback];
}

export function parseSupportedDurations(csv: string, fallback: Duration): Duration[] {
  const raw = csv
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter(isDuration);
  return raw.length > 0 ? raw : [fallback];
}
