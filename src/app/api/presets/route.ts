import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const presets = await prisma.preset.findMany({
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
      generateAudio: true,
      sortOrder: true,
    },
  });
  return NextResponse.json({ presets });
}
