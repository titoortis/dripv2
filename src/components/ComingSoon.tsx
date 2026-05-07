"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";

/**
 * Rendered on /create, /jobs/[id] and /history when
 * NEXT_PUBLIC_LAUNCH_MODE=marketing. The marketing landing is live;
 * the generation pipeline (Postgres + S3 + ARK_API_KEY) is provisioned
 * separately. No DB or storage calls happen in this mode.
 */
export function ComingSoon({
  title = "Coming soon",
  subtitle = "We are rolling out the generation pipeline. Drop your handle to be one of the first to try it.",
  cta = "Back to home",
}: {
  title?: string;
  subtitle?: string;
  cta?: string;
}) {
  return (
    <AppShell>
      <div className="px-safe pb-safe pt-10">
        <div className="mx-auto max-w-md rounded-3xl bg-ink-900 p-8 text-center ring-soft">
          <Chip>Drip · early access</Chip>
          <h1 className="heading-display mt-5 text-[28px] tracking-tight text-ink-50">
            {title}
          </h1>
          <p className="mt-3 text-[14px] leading-6 text-ink-300">{subtitle}</p>
          <div className="mt-6">
            <Link href="/">
              <Button block size="lg">
                {cta}
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-[11px] text-ink-400">
            Powered by BytePlus Seedance 2.0
          </p>
        </div>
      </div>
    </AppShell>
  );
}

export function isMarketingMode(): boolean {
  return process.env.NEXT_PUBLIC_LAUNCH_MODE === "marketing";
}
