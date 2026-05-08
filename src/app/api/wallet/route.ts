import { NextResponse } from "next/server";
import { getOrCreateSessionId } from "@/lib/server/session";
import { getOrCreateUser } from "@/lib/server/users";
import { ensureWalletAndTrial, getBalance } from "@/lib/server/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only wallet view for the current anonymous user.
 *
 * Side-effect: creates the User row and grants the trial credit on first
 * call. This is intentional — visiting /create or any wallet-aware screen
 * should be enough to "claim" the trial; the user does not have to attempt
 * a generation first.
 */
export async function GET() {
  const sessionId = getOrCreateSessionId();
  const user = await getOrCreateUser(sessionId);
  await ensureWalletAndTrial(user.id);
  const balance = await getBalance(user.id);
  return NextResponse.json({ balance });
}
