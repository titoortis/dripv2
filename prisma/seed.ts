import { PrismaClient } from "@prisma/client";
import {
  PRESETS,
  SEEDANCE_DEFAULT_MODEL,
  resolvePresetCapabilities,
  type PresetSeed,
} from "../src/lib/server/presets-source";

const prisma = new PrismaClient();

// CSV serialization for SQLite. The DB column is `String`; clients receive a
// parsed array via `/api/presets`. The CSV value is sourced via
// `resolvePresetCapabilities` so the storage row matches the picker's
// authoring-time intent (PR #23): a preset with `lockedDurationSec: 5`
// stores `supportedDurations="5"` and a preset with
// `allowedQualities: ["720p"]` stores `supportedResolutions="720p"`. The
// server-side gate at `/api/jobs` keys off these CSVs, so the lock is a
// real server enforcement, not just a UI signal.
//
// PR 6: explicitly sort resolutions by product rank, not lexicographically.
// (Bare `.sort()` on `["480p","720p","1080p"]` returns `["1080p","480p","720p"]`
// because '1' < '4' < '7' ASCII-wise.) UI consumers re-sort defensively so
// this is normalization, not a contract — but a normalized wire keeps the
// raw API output truthful when scanned by hand.
const RESOLUTION_RANK: Record<string, number> = { "480p": 0, "720p": 1, "1080p": 2 };
function resolutionsCsv(p: PresetSeed): string {
  const { allowedQualities } = resolvePresetCapabilities(p);
  return allowedQualities
    .slice()
    .sort((a, b) => (RESOLUTION_RANK[a] ?? 99) - (RESOLUTION_RANK[b] ?? 99))
    .join(",");
}
function durationsCsv(p: PresetSeed): string {
  const { allowedDurations } = resolvePresetCapabilities(p);
  return allowedDurations.slice().sort((a, b) => a - b).join(",");
}

async function main() {
  const ids = new Set<string>();

  for (const p of PRESETS) {
    ids.add(p.id);
    await prisma.preset.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        title: p.title,
        subtitle: p.subtitle ?? null,
        thumbnailUrl: p.thumbnailUrl ?? null,
        promptTemplate: p.promptTemplate,
        aspectRatio: p.aspectRatio,
        durationSec: p.durationSec,
        resolution: p.resolution,
        supportedResolutions: resolutionsCsv(p),
        supportedDurations: durationsCsv(p),
        generateAudio: p.generateAudio ?? false,
        motionNotes: p.motionNotes ?? null,
        modelId: p.modelId ?? SEEDANCE_DEFAULT_MODEL,
        referenceMode: p.referenceMode ?? "first_frame",
        transformPromptTemplate: p.transformPromptTemplate ?? null,
        referenceSheetPromptTemplate: p.referenceSheetPromptTemplate ?? null,
        isActive: p.isActive ?? true,
        sortOrder: p.sortOrder,
      },
      update: {
        title: p.title,
        subtitle: p.subtitle ?? null,
        thumbnailUrl: p.thumbnailUrl ?? null,
        promptTemplate: p.promptTemplate,
        aspectRatio: p.aspectRatio,
        durationSec: p.durationSec,
        resolution: p.resolution,
        supportedResolutions: resolutionsCsv(p),
        supportedDurations: durationsCsv(p),
        generateAudio: p.generateAudio ?? false,
        motionNotes: p.motionNotes ?? null,
        modelId: p.modelId ?? SEEDANCE_DEFAULT_MODEL,
        referenceMode: p.referenceMode ?? "first_frame",
        transformPromptTemplate: p.transformPromptTemplate ?? null,
        referenceSheetPromptTemplate: p.referenceSheetPromptTemplate ?? null,
        isActive: p.isActive ?? true,
        sortOrder: p.sortOrder,
      },
    });
  }

  // Soft-deactivate presets that no longer appear in the source file.
  const stale = await prisma.preset.findMany({ where: { id: { notIn: Array.from(ids) } } });
  if (stale.length > 0) {
    await prisma.preset.updateMany({
      where: { id: { in: stale.map((s) => s.id) } },
      data: { isActive: false },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${ids.size} presets (deactivated ${stale.length} stale ones).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
