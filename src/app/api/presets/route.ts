import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";

export const dynamic = "force-dynamic";

const RESOLUTION_VOCAB: ReadonlySet<string> = new Set(["480p", "720p", "1080p"]);
const DURATION_VOCAB: ReadonlySet<number> = new Set([5, 10, 15]);

// Parse the CSV strings produced by the seed back into typed arrays. Unknown
// values are dropped silently — the seed is the source of truth and any drift
// would be a seed bug, not something to fail open to clients on.
function parseResolutions(csv: string, fallback: string): string[] {
  const raw = csv.split(",").map((s) => s.trim()).filter((s) => RESOLUTION_VOCAB.has(s));
  return raw.length > 0 ? raw : [fallback];
}
function parseDurations(csv: string, fallback: number): number[] {
  const raw = csv
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && DURATION_VOCAB.has(n));
  return raw.length > 0 ? raw : [fallback];
}

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
  const presets = rows.map((p) => ({
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    thumbnailUrl: p.thumbnailUrl,
    aspectRatio: p.aspectRatio,
    durationSec: p.durationSec,
    resolution: p.resolution,
    supportedResolutions: parseResolutions(p.supportedResolutions, p.resolution),
    supportedDurations: parseDurations(p.supportedDurations, p.durationSec),
    generateAudio: p.generateAudio,
    sortOrder: p.sortOrder,
  }));
  return NextResponse.json({ presets });
}
