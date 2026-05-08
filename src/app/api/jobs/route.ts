import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requestHash } from "@/lib/server/jobs/hash";
import { getOrCreateSessionId } from "@/lib/server/session";
import { startPoller } from "@/lib/server/jobs/poller";
import { logEvent } from "@/lib/server/logger";
import { clientIp, consume } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateBody = z.object({
  presetId: z.string().min(1),
  sourceImageId: z.string().min(1),
});

// 6 jobs per minute per session, with bursts up to 3.
const SESSION_LIMIT = { capacity: 3, refillPerSec: 6 / 60 } as const;
// 20 jobs per minute per IP, with bursts up to 8.
const IP_LIMIT = { capacity: 8, refillPerSec: 20 / 60 } as const;

export async function POST(req: Request) {
  startPoller();

  const sessionId = getOrCreateSessionId();

  const ip = clientIp(req);
  const ipResult = consume(`jobs:ip:${ip}`, IP_LIMIT);
  const sessionResult = ipResult.ok
    ? consume(`jobs:session:${sessionId}`, SESSION_LIMIT)
    : ipResult;
  if (!ipResult.ok || !sessionResult.ok) {
    const retryAfter = Math.max(ipResult.retryAfter, sessionResult.retryAfter);
    logEvent("rate_limited", {
      route: "POST /api/jobs",
      ip,
      session_id: sessionId,
      reason: !ipResult.ok ? "ip" : "session",
    });
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const [preset, image] = await Promise.all([
    prisma.preset.findUnique({ where: { id: parsed.data.presetId } }),
    prisma.sourceImage.findUnique({ where: { id: parsed.data.sourceImageId } }),
  ]);
  if (!preset || !preset.isActive) {
    return NextResponse.json({ error: "preset not found" }, { status: 404 });
  }
  if (!image) {
    return NextResponse.json({ error: "source image not found" }, { status: 404 });
  }

  const hash = requestHash({
    presetId: preset.id,
    sourceImageId: image.id,
    modelId: preset.modelId,
    ratio: preset.aspectRatio,
    resolution: preset.resolution,
    durationSec: preset.durationSec,
    generateAudio: preset.generateAudio,
    promptTemplate: preset.promptTemplate,
  });

  // Idempotency: same session + same normalized inputs → return existing job.
  const existing = await prisma.generationJob.findUnique({
    where: { sessionId_requestHash: { sessionId, requestHash: hash } },
  });
  if (existing) {
    return NextResponse.json({ job: serialize(existing) });
  }

  const job = await prisma.generationJob.create({
    data: {
      sessionId,
      presetId: preset.id,
      sourceImageId: image.id,
      providerModelId: preset.modelId,
      requestHash: hash,
      status: "queued",
    },
  });

  return NextResponse.json({ job: serialize(job) }, { status: 201 });
}

export async function GET() {
  const sessionId = getOrCreateSessionId();
  const jobs = await prisma.generationJob.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      preset: { select: { id: true, title: true, subtitle: true, aspectRatio: true } },
      resultVideo: { select: { id: true, publicUrl: true, lastFrameUrl: true } },
      sourceImage: { select: { id: true, publicUrl: true } },
    },
  });
  return NextResponse.json({ jobs: jobs.map(serializeFull) });
}

function serialize(job: { id: string; status: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

type FullJob = Awaited<ReturnType<typeof prisma.generationJob.findMany>>[number] & {
  preset: { id: string; title: string; subtitle: string | null; aspectRatio: string };
  resultVideo: { id: string; publicUrl: string; lastFrameUrl: string | null } | null;
  sourceImage: { id: string; publicUrl: string };
};

function serializeFull(job: FullJob) {
  return {
    id: job.id,
    status: job.status,
    providerStatus: job.providerStatus,
    errorCode: job.errorCode,
    errorReason: job.errorReason,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    preset: job.preset,
    sourceImage: job.sourceImage,
    resultVideo: job.resultVideo,
  };
}
