/**
 * Client-safe derivation of the public preset list.
 *
 * Returns the same `PresetSummary[]` shape that `/api/presets` GET returns,
 * but sourced directly from `presets-source.ts` (the seed source-of-truth)
 * instead of from Prisma. No I/O, no DB, no environment reads.
 *
 * Why this exists: the homepage's `<FeaturedPresetSection />` (only the
 * featured surface, not the full `/create` grid) needs preset metadata to
 * render its card. Hitting `/api/presets` from the homepage hard-couples
 * the marketing landing to Prisma + a seeded DB; on any deploy where the
 * DB isn't provisioned (e.g. marketing-mode prod with no Postgres) the
 * route 500s and the card body never paints.
 *
 * The DB row in `Preset` is only ever a mirror of `PRESETS` (populated by
 * `pnpm db:seed`). For a read-only homepage card we don't gain anything
 * by going through the DB — we add a network round-trip and a single
 * point of failure. So the homepage reads the same source-of-truth that
 * the seed reads, gets identical content, and stays alive in any deploy
 * shape.
 *
 * PR #22 extended this to `/create` as well: the picker grid uses this
 * static seed as its SSR-safe initial value, and `/api/presets` is only
 * a best-effort live refresh on top.
 *
 * PR #23 enriches `PresetSummary` with the preset-first metadata
 * (`lockedDurationSec`, `allowedQualities`, `allowedAspectRatios`,
 * display labels). The wire format here and in `/api/presets/route.ts`
 * is byte-faithful — `resolvePresetCapabilities` is the single shared
 * derivation rule.
 */

import type { PresetSummary } from "@/components/PresetCard";
import {
  activePresets,
  resolvePresetCapabilities,
} from "@/lib/server/presets-source";
import { PROVIDER_VERIFIED_COMBOS } from "@/lib/server/jobs/verified-combos";
import { computeCost } from "@/lib/pricing";

/**
 * Build the public preset summaries from the static seed source. Mirrors
 * `/api/presets` field-for-field except `sortOrder` and `generateAudio`,
 * neither of which are part of `PresetSummary` — the homepage card and
 * the launcher don't read them.
 *
 * `availableCombos` is the same `allowedQualities × allowedDurations ∩
 * verified` intersection the API computes, with the same `computeCost`
 * debit. UI consumers (`PresetLauncher`, `/create`) sort defensively, so
 * order here is whatever `PROVIDER_VERIFIED_COMBOS` gives us.
 */
export function getStaticPresetSummaries(): PresetSummary[] {
  return activePresets().map((p) => {
    const caps = resolvePresetCapabilities(p);
    const availableCombos = PROVIDER_VERIFIED_COMBOS.filter(
      (c) =>
        caps.allowedQualities.includes(c.resolution) &&
        caps.allowedDurations.includes(c.durationSec),
    ).map((c) => ({
      resolution: c.resolution,
      durationSec: c.durationSec,
      creditsCost: computeCost({ resolution: c.resolution, durationSec: c.durationSec }),
    }));
    return {
      id: p.id,
      title: p.title,
      subtitle: p.subtitle ?? null,
      thumbnailUrl: p.thumbnailUrl ?? null,
      aspectRatio: p.aspectRatio,
      durationSec: p.durationSec,
      resolution: p.resolution,
      supportedResolutions: caps.allowedQualities,
      supportedDurations: caps.allowedDurations,
      availableCombos,
      // Preset-first metadata (PR #23).
      lockedDurationSec: caps.lockedDurationSec,
      allowedQualities: caps.allowedQualities,
      allowedAspectRatios: caps.allowedAspectRatios,
      qualityLocked: caps.qualityLocked,
      aspectLocked: caps.aspectLocked,
      durationLabel: caps.durationLabel,
      qualityLabel: caps.qualityLabel,
      aspectLabel: caps.aspectLabel,
      // PR 34: surface the seed's `referenceMode` so the SSR card grid can
      // render the "Ref mode" badge without waiting for `/api/presets`.
      referenceMode: p.referenceMode === "reference_images" ? "reference_images" : "first_frame",
    };
  });
}
