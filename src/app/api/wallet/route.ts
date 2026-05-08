import { NextResponse } from "next/server";
import { getOrCreateSessionId } from "@/lib/server/session";
import { getOrCreateUser } from "@/lib/server/users";
import { ensureWallet, getBalance } from "@/lib/server/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only wallet view for the current anonymous user.
 *
 * Side-effect: creates the User and EntitlementWallet rows on first call.
 * New users start at `balance=0` (paid-only MVP — no trial grant; the
 * transitional PR 2 auto-grant was rolled back in PR 3).
 */
export async function GET() {
  const sessionId = getOrCreateSessionId();
  const user = await getOrCreateUser(sessionId);
  await ensureWallet(user.id);
  const balance = await getBalance(user.id);
  return NextResponse.json({ balance });
}
