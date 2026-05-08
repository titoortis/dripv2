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

const REFUNDABLE_CODES = new Set([
  "missing_api_key",
  "wall_clock_timeout",
  "succeeded_without_url",
  "download_failed",
  "internal_error",
]);

/** Provider 5xx is also our fault — refund. Provider 4xx is the user's photo, do NOT refund. */
function isRefundableErrorCode(code: string | null | undefined): boolean {
  if (!code) return false;
  if (REFUNDABLE_CODES.has(code)) return true;
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
    select: { id: true, userId: true, errorCode: true, status: true },
  });
  if (!job) return;
  if (!job.userId) return; // pre-PR-2 jobs were not debited; nothing to refund.
  if (!isRefundableErrorCode(job.errorCode)) return;

  await prisma.$transaction(async (tx) => {
    const already = await tx.jobLedgerEntry.findFirst({
      where: { jobId, type: "refund" },
    });
    if (already) return;
    await tx.entitlementWallet.update({
      where: { userId: job.userId! },
      data: { balance: { increment: 1 } },
    });
    await tx.jobLedgerEntry.create({
      data: {
        userId: job.userId!,
        type: "refund",
        amount: 1,
        reason: job.errorCode ?? "unknown",
        jobId,
      },
    });
    logEvent("wallet_refunded", {
      job_id: jobId,
      user_id: job.userId,
      reason: job.errorCode,
    });
  });
}
