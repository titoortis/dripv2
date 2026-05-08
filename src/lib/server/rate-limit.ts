/**
 * In-memory token-bucket rate limiter.
 *
 * Scope: SINGLE-PROCESS ONLY. Resets on restart. Not horizontally-scaled-
 * serverless ready (Vercel multi-instance, multi-region, etc.). Good enough
 * for one Node service. For multi-instance deploys, swap the backing store
 * for Redis / Upstash without changing the public surface (`consume`).
 *
 * Policy (intentional, not accidental):
 *   - Callers run `consume()` BEFORE input validation. A `400 invalid body`
 *     therefore still consumes a token. This is fail-closed by design — a
 *     burst of malformed requests should be throttled, not amplified by
 *     skipping the limiter on parse errors.
 *   - Per-IP bucket fires before per-session bucket. If IP is denied we
 *     short-circuit and DO NOT debit the session bucket.
 */

import type { NextRequest } from "next/server";

type Bucket = {
  tokens: number;
  updatedAt: number;
};

const buckets: Map<string, Bucket> = new Map();

const SWEEP_AFTER_MS = 5 * 60_000;
let lastSweepAt = 0;

export type RateLimitOptions = {
  /** Bucket capacity (max tokens). Each request consumes one. */
  capacity: number;
  /** Refill rate, tokens per second. */
  refillPerSec: number;
};

export type RateLimitResult = {
  ok: boolean;
  /** Number of seconds the caller should wait before retrying when !ok. */
  retryAfter: number;
  /** Tokens left after this request (0 when !ok). */
  remaining: number;
};

export function consume(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  maybeSweep(now);

  const existing = buckets.get(key);
  const capacity = Math.max(1, opts.capacity);
  const refill = Math.max(0, opts.refillPerSec);

  let tokens: number;
  if (!existing) {
    tokens = capacity;
  } else {
    const elapsedSec = Math.max(0, (now - existing.updatedAt) / 1000);
    tokens = Math.min(capacity, existing.tokens + elapsedSec * refill);
  }

  if (tokens < 1) {
    const need = 1 - tokens;
    const retryAfter = refill > 0 ? Math.ceil(need / refill) : 60;
    buckets.set(key, { tokens, updatedAt: now });
    return { ok: false, retryAfter, remaining: 0 };
  }

  tokens -= 1;
  buckets.set(key, { tokens, updatedAt: now });
  return { ok: true, retryAfter: 0, remaining: Math.floor(tokens) };
}

function maybeSweep(now: number): void {
  if (now - lastSweepAt < SWEEP_AFTER_MS) return;
  lastSweepAt = now;
  const cutoff = now - 30 * 60_000;
  for (const [k, b] of buckets) {
    if (b.updatedAt < cutoff) buckets.delete(k);
  }
}

/**
 * Best-effort client IP extraction. Trusts standard upstream proxy headers
 * (`x-forwarded-for`, `x-real-ip`). Returns "unknown" when none are set so
 * we can still bucket — the per-session bucket compensates.
 */
export function clientIp(req: NextRequest | Request): string {
  const h: Headers = "headers" in req ? req.headers : (req as Request).headers;
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
