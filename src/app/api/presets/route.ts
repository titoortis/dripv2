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
    const supportedResolutions = parseSupportedResolutions(p.supportedResolutions, baselineRes);
    const supportedDurations = parseSupportedDurations(p.supportedDurations, baselineDur);
    // Picker source-of-truth: the supported × verified intersection, with the
    // exact cost we'll debit at submit. UI must still sort defensively (rule
    // from PR 6 spec: never assume product order from the wire).
    const availableCombos = PROVIDER_VERIFIED_COMBOS.filter(
      (c) =>
        supportedResolutions.includes(c.resolution) && supportedDurations.includes(c.durationSec),
    ).map((c) => ({
      resolution: c.resolution,
      durationSec: c.durationSec,
      creditsCost: computeCost({ resolution: c.resolution, durationSec: c.durationSec }),
    }));
    return {
      id: p.id,
      title: p.title,
      subtitle: p.subtitle,
      thumbnailUrl: p.thumbnailUrl,
      aspectRatio: p.aspectRatio,
      durationSec: baselineDur,
      resolution: baselineRes,
      supportedResolutions,
      supportedDurations,
      availableCombos,
      generateAudio: p.generateAudio,
      sortOrder: p.sortOrder,
    };
  });
  return NextResponse.json({ presets });
}
