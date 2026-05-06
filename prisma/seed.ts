import { PrismaClient } from "@prisma/client";
import { PRESETS, SEEDANCE_DEFAULT_MODEL } from "../src/lib/server/presets-source";

const prisma = new PrismaClient();

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
        generateAudio: p.generateAudio ?? false,
        motionNotes: p.motionNotes ?? null,
        modelId: p.modelId ?? SEEDANCE_DEFAULT_MODEL,
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
        generateAudio: p.generateAudio ?? false,
        motionNotes: p.motionNotes ?? null,
        modelId: p.modelId ?? SEEDANCE_DEFAULT_MODEL,
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
