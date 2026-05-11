/**
 * Entitlement wallet — the credit balance per anonymous user.
 *
 * Design notes:
 *   - One whole video = one credit. We do not track partial credits.
 *   - Every change goes through a `JobLedgerEntry` (append-only audit trail).
 *     We never UPDATE ledger rows.
 *   - PR 3 contract: paid-only MVP. There is **no** auto-grant. New users
 *     start at `balance=0` and must purchase a pack (payment integration
 *     is a future PR). PR 2 shipped a transitional `trial=1` auto-grant
 *     that has been intentionally rolled back here.
 *   - `EntitlementWallet.trialGrantedAt` is kept on the schema as a forward
 *     seam (e.g. one-time discount on first paid pack) but is never written
 *     in MVP code paths.
 *   - All multi-step operations run inside `prisma.$transaction` so the
 *     wallet balance and the ledger entry stay in sync, no matter what.
 */

import { prisma } from "./prisma";
import { logEvent } from "./logger";

/**
 * Refund policy taxonomy (decided in PR 4 after live BytePlus validation):
 *
 *   - **user-fault** failures (bad photo, prompt rejected for content policy,
 *     anything coming back as a provider 4xx that's about the input) → no
 *     refund. The user got a real attempt; the credit stays burned.
 *   - **provider-fault** failures (BytePlus 5xx, our own download_failed
 *     pulling the result, succeeded_without_url) → refund.
 *   - **operator-fault** failures (our BytePlus account is misconfigured —
 *     `SetLimitExceeded` from Safe Experience Mode, future similar codes
 *     where the model service refuses our account, not the user's photo)
 *     → refund.
 *   - **internal** failures (`internal_error`, `wall_clock_timeout`,
 *     `missing_api_key` — generation never actually started) → refund.
 *
 * Names below mirror what either our runner or BytePlus puts into
 * `GenerationJob.errorCode`.
 */
const REFUNDABLE_CODES = new Set([
  // internal — generation never actually reached the provider
  "missing_api_key",
  "wall_clock_timeout",
  // provider — Seedance accepted the task but didn't deliver a usable url
  "succeeded_without_url",
  "download_failed",
  "internal_error",
  // operator — our BytePlus account refused the model on us, not the user
  "SetLimitExceeded",
  // PR #29 — provider-backed asset lifecycle failures. From the user's
  // perspective these are internal (we never even got to submit a
  // generation task) and must refund. The `provider_asset_*` codes are
  // emitted by the runner when the reference_images path can't promote
  // a `ProviderAsset` to `active` before the wall-clock deadline.
  "provider_asset_upload_failed",
  "provider_asset_get_failed",
  "provider_asset_storage_fetch_failed",
  "provider_asset_timeout",
]);

function isRefundableErrorCode(code: string | null | undefined): boolean {
  if (!code) return false;
  if (REFUNDABLE_CODES.has(code)) return true;
  // Provider 5xx is provider-fault — refund. Provider 4xx is user-fault — keep burned.
  if (code.startsWith("http_5")) return true;
  return false;
}

/**
 * Ensure the wallet row exists for `userId` with `balance=0`. Idempotent.
 *
 * Safe under concurrent first-visit calls: if two requests both miss the
 * read, only one INSERT wins; the other gets `P2002` and recovers by
 * re-reading.
 */
export async function ensureWallet(userId: string): Promise<{ balance: number }> {
  const existing = await prisma.entitlementWallet.findUnique({ where: { userId } });
  if (existing) return { balance: existing.balance };
  try {
    const created = await prisma.entitlementWallet.create({
      data: { userId, balance: 0 },
    });
    return { balance: created.balance };
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      const recovered = await prisma.entitlementWallet.findUnique({ where: { userId } });
      if (recovered) return { balance: recovered.balance };
    }
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  return code === "P2002";
}

export async function getBalance(userId: string): Promise<number> {
  const wallet = await prisma.entitlementWallet.findUnique({ where: { userId } });
  return wallet?.balance ?? 0;
}

/**
 * Refund one credit to `userId` for `jobId` if and only if:
 *   - the job's errorCode is in the refundable set, AND
 *   - we have not already written a `refund` ledger entry for this jobId.
 *
 * Idempotent. Safe to call from multiple terminal-failure paths in the runner.
 */
export async function maybeRefundJob(jobId: string): Promise<void> {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    // PR 6: refund the exact amount we debited at submit time. `creditsCost`
    // is persisted on the job row so the refund stays correct even if the
    // preset's price ever changes between debit and refund. Falls back to 1
    // for any pre-PR-6 job rows that predate the column (defaulted to 1
    // anyway by the schema).
    select: { id: true, userId: true, errorCode: true, status: true, creditsCost: true },
  });
  if (!job) return;
  if (!job.userId) return; // pre-PR-2 jobs were not debited; nothing to refund.
  if (!isRefundableErrorCode(job.errorCode)) return;

  const refundAmount = Math.max(0, job.creditsCost);
  if (refundAmount === 0) return;

  await prisma.$transaction(async (tx) => {
    const already = await tx.jobLedgerEntry.findFirst({
      where: { jobId, type: "refund" },
    });
    if (already) return;
    await tx.entitlementWallet.update({
      where: { userId: job.userId! },
      data: { balance: { increment: refundAmount } },
    });
    await tx.jobLedgerEntry.create({
      data: {
        userId: job.userId!,
        type: "refund",
        amount: refundAmount,
        reason: job.errorCode ?? "unknown",
        jobId,
      },
    });
    logEvent("wallet_refunded", {
      job_id: jobId,
      user_id: job.userId,
      amount: refundAmount,
      reason: job.errorCode,
    });
  });
}
