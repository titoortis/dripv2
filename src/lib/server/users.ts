import { prisma } from "./prisma";
import type { User } from "@prisma/client";

/**
 * Get-or-create the anonymous User for the given browser sessionId.
 *
 * Idempotent. Safe under concurrent calls thanks to the unique constraint on
 * `User.sessionId` — a racing INSERT will throw `P2002` and we recover by
 * re-reading. Most callers will hit the read path on the second request.
 */
export async function getOrCreateUser(sessionId: string): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { sessionId } });
  if (existing) return existing;
  try {
    return await prisma.user.create({ data: { sessionId } });
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      const recovered = await prisma.user.findUnique({ where: { sessionId } });
      if (recovered) return recovered;
    }
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  return code === "P2002";
}
