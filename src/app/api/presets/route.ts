import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import {
  parseSupportedDurations,
  parseSupportedResolutions,
} from "@/lib/server/preset-capabilities";
import { PROVIDER_VERIFIED_COMBOS } from "@/lib/server/jobs/verified-combos";
import {
  computeCost,
  isDuration,
  isResolution,
  type Duration,
  type Resolution,
} from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.preset.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      title: true,
      subtitle: true,
      thumbnailUrl: true,
      aspectRatio: true,
      durationSec: true,
      resolution: true,
      supportedResolutions: true,
      supportedDurations: true,
      generateAudio: true,
      sortOrder: true,
    },
  });
  const presets = rows.map((p) => {
    const baselineRes: Resolution = isResolution(p.resolution) ? p.resolution : "720p";
    const baselineDur: Duration = isDuration(p.durationSec) ? p.durationSec : 5;
    const allowedQualities = parseSupportedResolutions(p.supportedResolutions, baselineRes);
    const allowedDurations = parseSupportedDurations(p.supportedDurations, baselineDur);
    // Picker source-of-truth: the supported × verified intersection, with the
    // exact cost we'll debit at submit. UI must still sort defensively (rule
    // from PR 6 spec: never assume product order from the wire).
    const availableCombos = PROVIDER_VERIFIED_COMBOS.filter(
      (c) =>
        allowedQualities.includes(c.resolution) && allowedDurations.includes(c.durationSec),
    ).map((c) => ({
      resolution: c.resolution,
      durationSec: c.durationSec,
      creditsCost: computeCost({ resolution: c.resolution, durationSec: c.durationSec }),
    }));
    // Preset-first metadata (PR #23). The DB doesn't carry these as separate
    // columns; we derive them from the existing storage so the wire format
    // stays byte-faithful with `presets-static.ts`. The `lockedDurationSec`
    // field is the truthful "this preset is fixed-duration by design" signal:
    // when the seed wrote `supportedDurations="5"` for a preset with
    // `lockedDurationSec: 5`, this derivation recovers it from the single-
    // element CSV. (Conversely, a preset with multiple allowed durations
    // exposes `lockedDurationSec: null` and the picker renders a row.)
    const lockedDurationSec = allowedDurations.length === 1 ? allowedDurations[0] : null;
    const qualityLocked = allowedQualities.length === 1;
    const allowedAspectRatios = [p.aspectRatio];
    const aspectLocked = true;
    const durationLabel = `${lockedDurationSec ?? allowedDurations[0] ?? baselineDur}s`;
    const qualityLabel = qualityLocked ? allowedQualities[0] : "Multiple";
    const aspectLabel = p.aspectRatio;
    return {
      id: p.id,
      title: p.title,
      subtitle: p.subtitle,
      thumbnailUrl: p.thumbnailUrl,
      aspectRatio: p.aspectRatio,
      durationSec: baselineDur,
      resolution: baselineRes,
      supportedResolutions: allowedQualities,
      supportedDurations: allowedDurations,
      availableCombos,
      lockedDurationSec,
      allowedQualities,
      allowedAspectRatios,
      qualityLocked,
      aspectLocked,
      durationLabel,
      qualityLabel,
      aspectLabel,
      generateAudio: p.generateAudio,
      sortOrder: p.sortOrder,
    };
  });
  return NextResponse.json({ presets });
}
