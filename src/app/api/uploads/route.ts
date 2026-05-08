import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { storage } from "@/lib/server/storage";
import { prisma } from "@/lib/server/prisma";
import { getOrCreateSessionId } from "@/lib/server/session";
import { logEvent } from "@/lib/server/logger";
import { clientIp, consume } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

// 10 uploads per minute per session, with bursts up to 6.
const SESSION_LIMIT = { capacity: 6, refillPerSec: 10 / 60 } as const;
// 30 uploads per minute per IP, with bursts up to 12 (covers shared NATs).
const IP_LIMIT = { capacity: 12, refillPerSec: 30 / 60 } as const;

export async function POST(req: Request) {
  // ensure session cookie exists for downstream history
  const sessionId = getOrCreateSessionId();

  const ip = clientIp(req);
  const ipResult = consume(`uploads:ip:${ip}`, IP_LIMIT);
  const sessionResult = ipResult.ok
    ? consume(`uploads:session:${sessionId}`, SESSION_LIMIT)
    : ipResult;
  if (!ipResult.ok || !sessionResult.ok) {
    const retryAfter = Math.max(ipResult.retryAfter, sessionResult.retryAfter);
    logEvent("rate_limited", {
      route: "POST /api/uploads",
      ip,
      session_id: sessionId,
      reason: !ipResult.ok ? "ip" : "session",
    });
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${Math.floor(MAX_BYTES / (1024 * 1024))} MB)` },
      { status: 413 },
    );
  }
  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED.has(contentType)) {
    return NextResponse.json(
      { error: "unsupported image type; use jpeg, png, or webp" },
      { status: 415 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const key = `images/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
  const stored = await storage().put({ key, body: buf, contentType });

  const row = await prisma.sourceImage.create({
    data: {
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      mimeType: contentType,
      bytes: stored.bytes,
    },
  });

  return NextResponse.json({
    sourceImage: {
      id: row.id,
      publicUrl: row.publicUrl,
      mimeType: row.mimeType,
      bytes: row.bytes,
    },
  });
}
