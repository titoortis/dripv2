import { NextResponse } from "next/server";
import { tickFromCron } from "@/lib/server/jobs/poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron-style entry point. Idempotent. Returns counts of work touched.
 * Useful for serverless deploys where the long-lived in-process poller
 * is disabled.
 */
export async function POST() {
  const result = await tickFromCron();
  return NextResponse.json(result);
}

export async function GET() {
  const result = await tickFromCron();
  return NextResponse.json(result);
}
