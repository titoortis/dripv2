"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { StatusLine } from "@/components/StatusLine";

type JobView = {
  id: string;
  status: string;
  providerStatus?: string | null;
  errorCode?: string | null;
  errorReason?: string | null;
  preset: {
    id: string;
    title: string;
    subtitle: string | null;
    aspectRatio: string;
    durationSec: number;
    resolution: string;
  };
  sourceImage: { id: string; publicUrl: string };
  resultVideo: { id: string; publicUrl: string; lastFrameUrl: string | null } | null;
};

const TERMINAL = new Set(["completed", "failed", "cancelled", "expired"]);

export default function JobPage({ params }: { params: { id: string } }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${params.id}`, { cache: "no-store" });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error || `HTTP ${res.status}`);
        }
        const j = (await res.json()) as { job: JobView };
        if (cancelled) return;
        setJob(j.job);
        setError(null);
        if (TERMINAL.has(j.job.status)) {
          stoppedRef.current = true;
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Network error");
      }
      if (!cancelled && !stoppedRef.current) {
        timer = setTimeout(tick, 3000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [params.id]);

  if (!job) {
    return (
      <AppShell>
        <div className="px-safe pt-6 text-ink-300">{error ?? "Loading…"}</div>
      </AppShell>
    );
  }

  if (job.status === "completed" && job.resultVideo) {
    return <ResultView job={job} />;
  }

  if (job.status === "failed" || job.status === "expired" || job.status === "cancelled") {
    return <FailedView job={job} />;
  }

  return <ProcessingView job={job} />;
}

function ProcessingView({ job }: { job: JobView }) {
  return (
    <AppShell>
      <div className="px-safe pb-safe relative pt-2">
        <h1 className="heading-display mb-2 text-[22px] tracking-tight text-ink-50">Generating</h1>
        <p className="mb-4 text-[13px] text-ink-300">
          {job.preset.title}
          {job.preset.subtitle ? ` · ${job.preset.subtitle}` : ""}
        </p>

        <div className="relative mx-auto aspect-[9/16] w-full overflow-hidden rounded-3xl bg-ink-800 ring-soft">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={job.sourceImage.publicUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover blur-md scale-110"
          />
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full border-2 border-white/10" />
              <div className="absolute inset-0 h-16 w-16 animate-spin rounded-full border-2 border-transparent border-t-accent" />
            </div>
            <div className="text-[13px] text-ink-200">
              {labelFor(job.status)}
              {job.providerStatus ? ` · ${job.providerStatus}` : ""}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Chip>{job.preset.durationSec}s</Chip>
          <Chip>{job.preset.aspectRatio}</Chip>
          <Chip>{job.preset.resolution}</Chip>
        </div>

        <div className="mt-5">
          <StatusLine status={job.status} />
        </div>

        <p className="mt-6 text-center text-[12px] text-ink-400">
          You can leave this screen — your video will be saved to{" "}
          <Link className="text-ink-200 underline" href="/history">
            My videos
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}

function ResultView({ job }: { job: JobView }) {
  const url = job.resultVideo!.publicUrl;
  return (
    <AppShell>
      <div className="px-safe pb-[120px] pt-2">
        <h1 className="heading-display mb-3 text-[22px] tracking-tight text-ink-50">Ready</h1>

        <div className="overflow-hidden rounded-3xl bg-black ring-soft">
          <video
            className="aspect-[9/16] h-full w-full object-cover"
            src={url}
            autoPlay
            playsInline
            loop
            muted
            controls
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Chip>{job.preset.durationSec}s</Chip>
          <Chip>{job.preset.aspectRatio}</Chip>
          <Chip>{job.preset.resolution}</Chip>
          <span className="ml-auto truncate text-[12px] text-ink-300">{job.preset.title}</span>
        </div>
      </div>

      <div
        className="pb-safe fixed inset-x-0 bottom-0 z-40 mx-auto max-w-3xl"
        style={{ pointerEvents: "none" }}
      >
        <div
          className="mx-3 my-3 flex flex-col gap-2 rounded-3xl bg-ink-900/85 p-3 ring-soft glass"
          style={{ pointerEvents: "auto" }}
        >
          <ShareRow url={url} />
          <Link href="/create">
            <Button block variant="secondary">
              Try another preset
            </Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function ShareRow({ url }: { url: string }) {
  const onShare = async () => {
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ url, title: "drip", text: "Made with drip" });
        return;
      }
    } catch {
      /* fall through to download */
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = "drip.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <Button block size="lg" onClick={onShare}>
      Save / Share
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
      </svg>
    </Button>
  );
}

function FailedView({ job }: { job: JobView }) {
  const reason = job.errorReason ?? "Generation failed.";
  return (
    <AppShell>
      <div className="px-safe pb-safe pt-6">
        <div className="rounded-3xl bg-ink-900 p-5 ring-soft">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-danger">
            {job.status === "expired"
              ? "Timed out"
              : job.status === "cancelled"
                ? "Cancelled"
                : "Failed"}
          </div>
          <h1 className="heading-display mt-1 text-[22px] tracking-tight text-ink-50">
            {job.preset.title}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-300">{reason}</p>
          {job.errorCode ? (
            <p className="mt-2 text-[11px] text-ink-400">code: {job.errorCode}</p>
          ) : null}

          <div className="mt-6 grid gap-2">
            <Link href="/create">
              <Button block size="lg">
                Try another preset
              </Button>
            </Link>
            <Link href="/history">
              <Button block variant="secondary">
                Go to My videos
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function labelFor(status: string) {
  switch (status) {
    case "queued":
      return "Queued";
    case "uploading":
      return "Preparing";
    case "submitted":
      return "Submitted";
    case "processing":
      return "Generating";
    default:
      return "Working";
  }
}
