import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { getSessionId } from "@/lib/server/session";
import { startPoller } from "@/lib/server/jobs/poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  startPoller();

  const sessionId = getSessionId();
  const job = await prisma.generationJob.findUnique({
    where: { id: ctx.params.id },
    include: {
      preset: {
        select: {
          id: true,
          title: true,
          subtitle: true,
          aspectRatio: true,
          durationSec: true,
          resolution: true,
          referenceMode: true,
        },
      },
      resultVideo: { select: { id: true, publicUrl: true, lastFrameUrl: true } },
      sourceImage: { select: { id: true, publicUrl: true } },
    },
  });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (sessionId && job.sessionId !== sessionId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      providerStatus: job.providerStatus,
      errorCode: job.errorCode,
      errorReason: job.errorReason,
      // PR 6: chosen quality + debited cost surfaced from the job row so the
      // UI shows what we *actually* rendered/charged, not the preset baseline.
      resolution: job.resolution,
      durationSec: job.durationSec,
      creditsCost: job.creditsCost,
      // PR 34: provider-side content-slot label actually used for the source
      // image. Null while the job is queued, or on jobs that failed before
      // the runner reached the uploading transition (e.g. `missing_api_key`).
      role: job.role,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      preset: job.preset,
      sourceImage: job.sourceImage,
      resultVideo: job.resultVideo,
    },
  });
}
