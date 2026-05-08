/**
 * Entitlement wallet — the credit balance per anonymous user.
 *
 * Design notes:
 *   - One whole video = one credit. We do not track partial credits.
 *   - Every change goes through a `JobLedgerEntry` (append-only audit trail).
 *     We never UPDATE ledger rows.
 *   - Trial grant is gated on `EntitlementWallet.trialGrantedAt` so a user
 *     gets exactly one trial across all sessions on the same browser.
 *   - All multi-step operations run inside `prisma.$transaction` so the
 *     wallet balance and the ledger entry stay in sync, no matter what.
 */

import { prisma } from "./prisma";
import { logEvent } from "./logger";

const MVP_TRIAL_AMOUNT = 1;

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
 * Ensure the wallet row exists and grant the first-visit trial credit if
 * we haven't yet. Idempotent.
 */
export async function ensureWalletAndTrial(userId: string): Promise<{ balance: number }> {
  const existing = await prisma.entitlementWallet.findUnique({ where: { userId } });
  if (existing && existing.trialGrantedAt) {
    return { balance: existing.balance };
  }

  return prisma.$transaction(async (tx) => {
    const inside = await tx.entitlementWallet.findUnique({ where: { userId } });
    if (inside && inside.trialGrantedAt) {
      return { balance: inside.balance };
    }

    const wallet = inside
      ? await tx.entitlementWallet.update({
          where: { userId },
          data: {
            balance: { increment: MVP_TRIAL_AMOUNT },
            trialGrantedAt: new Date(),
          },
        })
      : await tx.entitlementWallet.create({
          data: {
            userId,
            balance: MVP_TRIAL_AMOUNT,
            trialGrantedAt: new Date(),
          },
        });

    await tx.jobLedgerEntry.create({
      data: {
        userId,
        type: "grant",
        amount: MVP_TRIAL_AMOUNT,
        reason: "trial",
        jobId: null,
      },
    });

    logEvent("wallet_trial_granted", { user_id: userId, amount: MVP_TRIAL_AMOUNT });
    return { balance: wallet.balance };
  });
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
