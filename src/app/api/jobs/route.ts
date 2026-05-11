import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requestHash } from "@/lib/server/jobs/hash";
import { getOrCreateSessionId } from "@/lib/server/session";
import { startPoller } from "@/lib/server/jobs/poller";
import { logEvent } from "@/lib/server/logger";
import { clientIp, consume } from "@/lib/server/rate-limit";
import { getOrCreateUser } from "@/lib/server/users";
import { ensureWallet } from "@/lib/server/wallet";
import {
  computeCost,
  isDuration,
  isResolution,
  type Duration,
  type Resolution,
} from "@/lib/pricing";
import { isComboVerified } from "@/lib/server/jobs/verified-combos";
import {
  parseSupportedDurations,
  parseSupportedResolutions,
} from "@/lib/server/preset-capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PR 6: `resolution` / `durationSec` are optional on the wire so any pre-PR-6
// client (which only sends `presetId` + `sourceImageId`) still works — the
// server falls back to the preset baseline. New clients always send the user's
// picker selection. Both paths flow through the same gate + pricing path
// below; the API never trusts the client to compute cost.
const CreateBody = z.object({
  presetId: z.string().min(1),
  sourceImageId: z.string().min(1),
  resolution: z.enum(["480p", "720p", "1080p"]).optional(),
  durationSec: z.union([z.literal(5), z.literal(10), z.literal(15)]).optional(),
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

  // Resolve the anonymous user and ensure the wallet row exists. New users
  // start at balance=0 — paid-only MVP, no trial grant (PR 3 retraction).
  const user = await getOrCreateUser(sessionId);
  await ensureWallet(user.id);

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

  // PR 6 quality resolution + gate. Three checks, in order, every miss is a
  // 400 with a discriminator the UI can show:
  //   1. vocabulary check (handled by zod above; falls through to the preset
  //      baseline when omitted);
  //   2. preset-supported check — the chosen combo must appear in the preset's
  //      `supportedResolutions` × `supportedDurations` set;
  //   3. provider-verified check — the chosen combo must be in
  //      `PROVIDER_VERIFIED_COMBOS` (PR 4 today proved 720p × 5s only).
  //
  // Runtime guard on the preset fallback path. `preset.resolution` /
  // `preset.durationSec` are Prisma `String` / `Int`, but the rest of the
  // route treats them as members of the locked `Resolution` / `Duration`
  // vocabulary. A bad preset row (seed bug, future hand-edit, schema-only
  // migration that didn't normalize legacy data) would otherwise reach
  // `computeCost` and throw — turning an operator-side data problem into a
  // confused 500 with a stack trace. We catch it here, log a structured
  // event, and return a typed discriminator so the issue is observable and
  // actionable.
  if (!isResolution(preset.resolution) || !isDuration(preset.durationSec)) {
    logEvent("preset_quality_invalid", {
      route: "POST /api/jobs",
      preset_id: preset.id,
      preset_resolution: preset.resolution,
      preset_duration_sec: preset.durationSec,
    });
    return NextResponse.json(
      { error: "preset_quality_invalid" },
      { status: 500 },
    );
  }
  const baselineRes: Resolution = preset.resolution;
  const baselineDur: Duration = preset.durationSec;
  const chosenResolution: Resolution = parsed.data.resolution ?? baselineRes;
  const chosenDuration: Duration = parsed.data.durationSec ?? baselineDur;
  const supportedResolutions = parseSupportedResolutions(preset.supportedResolutions, baselineRes);
  const supportedDurations = parseSupportedDurations(preset.supportedDurations, baselineDur);
  if (
    !supportedResolutions.includes(chosenResolution) ||
    !supportedDurations.includes(chosenDuration)
  ) {
    return NextResponse.json(
      {
        error: "quality_not_supported_by_preset",
        supportedResolutions,
        supportedDurations,
      },
      { status: 400 },
    );
  }
  if (!isComboVerified({ resolution: chosenResolution, durationSec: chosenDuration })) {
    logEvent("quality_gate_blocked", {
      route: "POST /api/jobs",
      session_id: sessionId,
      user_id: user.id,
      preset_id: preset.id,
      resolution: chosenResolution,
      duration_sec: chosenDuration,
    });
    return NextResponse.json(
      {
        error: "verification_pending",
        message:
          "This quality is not live-verified yet. Pick a different one or wait for the next drop.",
      },
      { status: 400 },
    );
  }

  // Pricing-at-submit. Single source of truth shared with the UI's live cost
  // preview — both call sites import `computeCost` from `@/lib/pricing`.
  // Display-must-match-charged: the number we debit below is exactly the
  // number the picker showed.
  const creditsCost = computeCost({
    resolution: chosenResolution,
    durationSec: chosenDuration,
  });

  // Hash includes the *chosen* resolution / durationSec, not the preset
  // baseline. Two submits at different qualities for the same preset+image
  // hash differently — they're different jobs, debited at their own prices.
  // Pre-PR-6 jobs that ran at the preset baseline still hash identically
  // because the chosen values default to the baseline when omitted.
  //
  // PR #29: `referenceMode` participates in the hash too, but is omitted
  // from the canonical string when it equals the `"first_frame"` default —
  // see `requestHash` doc. That keeps pre-PR-29 hashes byte-stable.
  const presetReferenceMode =
    preset.referenceMode === "reference_images" ? "reference_images" : "first_frame";
  const hash = requestHash({
    presetId: preset.id,
    sourceImageId: image.id,
    modelId: preset.modelId,
    ratio: preset.aspectRatio,
    resolution: chosenResolution,
    durationSec: chosenDuration,
    generateAudio: preset.generateAudio,
    promptTemplate: preset.promptTemplate,
    referenceMode: presetReferenceMode,
  });

  // Idempotency: same session + same normalized inputs → return the existing
  // job and DO NOT debit again. The original POST already debited.
  const existing = await prisma.generationJob.findUnique({
    where: { sessionId_requestHash: { sessionId, requestHash: hash } },
  });
  if (existing) {
    return NextResponse.json({ job: serialize(existing) });
  }

  // New job. Atomic: re-read balance, create job, debit, write ledger entry.
  // We do NOT start the runner inside the tx so the row-locks stay short.
  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.entitlementWallet.findUnique({ where: { userId: user.id } });
    if (!wallet || wallet.balance < creditsCost) {
      return {
        kind: "no_credits" as const,
        balance: wallet?.balance ?? 0,
        required: creditsCost,
      };
    }
    const created = await tx.generationJob.create({
      data: {
        sessionId,
        userId: user.id,
        presetId: preset.id,
        sourceImageId: image.id,
        providerModelId: preset.modelId,
        requestHash: hash,
        status: "queued",
        resolution: chosenResolution,
        durationSec: chosenDuration,
        creditsCost,
      },
    });
    await tx.entitlementWallet.update({
      where: { userId: user.id },
      data: { balance: { decrement: creditsCost } },
    });
    await tx.jobLedgerEntry.create({
      data: {
        userId: user.id,
        type: "debit",
        amount: creditsCost,
        reason: "generation",
        jobId: created.id,
      },
    });
    return { kind: "ok" as const, job: created, remaining: wallet.balance - creditsCost };
  });

  if (result.kind === "no_credits") {
    logEvent("no_credits", {
      route: "POST /api/jobs",
      user_id: user.id,
      session_id: sessionId,
      balance: result.balance,
      required: result.required,
    });
    return NextResponse.json(
      { error: "no_credits", balance: result.balance, required: result.required },
      { status: 402 },
    );
  }

  return NextResponse.json(
    { job: serialize(result.job), balance: result.remaining, creditsCost },
    { status: 201 },
  );
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

function serialize(job: {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  resolution: string;
  durationSec: number;
  creditsCost: number;
}) {
  return {
    id: job.id,
    status: job.status,
    resolution: job.resolution,
    durationSec: job.durationSec,
    creditsCost: job.creditsCost,
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
    // PR 6: chosen quality + debited cost are pulled from the job row, not
    // the preset, so what the user sees on `/jobs/[id]` and `/history`
    // matches what we actually charged.
    resolution: job.resolution,
    durationSec: job.durationSec,
    creditsCost: job.creditsCost,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    preset: job.preset,
    sourceImage: job.sourceImage,
    resultVideo: job.resultVideo,
  };
}
