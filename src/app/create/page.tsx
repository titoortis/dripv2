"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { ComingSoon, isMarketingMode } from "@/components/ComingSoon";
import { PresetCard, type PresetSummary } from "@/components/PresetCard";
import { PresetSheet } from "@/components/PresetSheet";
import { UploadPad, type UploadedSource } from "@/components/UploadPad";

export default function CreatePage() {
  if (isMarketingMode()) {
    return (
      <ComingSoon
        title="Cinematic generation lands soon"
        subtitle="Upload, presets, and Seedance 2.0 generation are queued behind the rollout. The waitlist opens with the next drop."
      />
    );
  }
  return <CreatePageInner />;
}

function CreatePageInner() {
  const router = useRouter();
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<UploadedSource | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/presets")
      .then((r) => r.json())
      .then((j: { presets: PresetSummary[] }) => {
        if (!alive) return;
        setPresets(j.presets);
        if (j.presets[0]) setSelectedId(j.presets[0].id);
      })
      .catch(() => {
        /* swallow; UI shows empty state below */
      })
      .finally(() => alive && setPresetsLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/wallet", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { balance: number } | null) => {
        if (!alive || !j) return;
        setBalance(j.balance);
      })
      .catch(() => {
        /* swallow; banner just won't render */
      });
    return () => {
      alive = false;
    };
  }, []);

  const selected = useMemo(
    () => presets.find((p) => p.id === selectedId) ?? null,
    [presets, selectedId],
  );

  const outOfCredits = balance !== null && balance < 1;
  const canGenerate = Boolean(source?.id && selected?.id) && !submitting && !outOfCredits;

  async function generate() {
    if (!source || !selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId: selected.id, sourceImageId: source.id }),
      });
      if (res.status === 402) {
        const j = (await res.json().catch(() => null)) as { balance?: number } | null;
        if (typeof j?.balance === "number") setBalance(j.balance);
        setError(null); // banner handles this state
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { job: { id: string }; balance?: number };
      if (typeof j.balance === "number") setBalance(j.balance);
      router.push(`/jobs/${j.job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start generation");
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="px-safe pb-[140px] pt-2">
        <h1 className="heading-display mb-3 text-[22px] tracking-tight text-ink-50">Create video</h1>
        <WalletBanner balance={balance} />
        <UploadPad value={source} onChange={setSource} />

        <section className="mt-6">
          <div className="mb-2 flex items-end justify-between">
            <div>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-200">
                Discover presets
              </h2>
              <p className="text-[12px] text-ink-400">Seedance 2.0</p>
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="text-[12px] font-semibold text-accent underline-offset-4 hover:underline"
            >
              Explore all
            </button>
          </div>
          <PresetStrip
            loading={presetsLoading}
            presets={presets}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </section>
      </div>

      {/* Sticky bottom CTA */}
      <div
        className="pb-safe fixed inset-x-0 bottom-0 z-40 mx-auto max-w-3xl"
        style={{ pointerEvents: "none" }}
      >
        <div className="mx-3 my-3 rounded-3xl bg-ink-900/85 p-3 ring-soft glass" style={{ pointerEvents: "auto" }}>
          {selected ? (
            <div className="mb-2 flex items-center gap-2 px-1">
              <Chip>{selected.durationSec}s</Chip>
              <Chip>{selected.aspectRatio}</Chip>
              <Chip>{selected.resolution}</Chip>
              <span className="ml-auto truncate text-[12px] text-ink-300">{selected.title}</span>
            </div>
          ) : null}
          {error ? <div className="mb-2 px-1 text-[12px] text-danger">{error}</div> : null}
          <Button block size="lg" disabled={!canGenerate} onClick={generate}>
            {submitting ? "Starting…" : outOfCredits ? "Out of credits" : "Generate"}
            {!submitting && !outOfCredits && (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            )}
          </Button>
          {outOfCredits ? (
            <p className="mt-2 text-center text-[11px] text-ink-400">
              Pricing packs land soon.
            </p>
          ) : !canGenerate && !submitting ? (
            <p className="mt-2 text-center text-[11px] text-ink-400">
              {source ? "Pick a preset to continue." : "Upload a photo to continue."}
            </p>
          ) : null}
        </div>
      </div>

      <PresetSheet
        open={sheetOpen}
        presets={presets}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </AppShell>
  );
}

function WalletBanner({ balance }: { balance: number | null }) {
  if (balance === null) return null;
  if (balance >= 1) {
    const label = balance === 1 ? "1 video" : `${balance} videos`;
    return (
      <div className="mb-3 flex items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 ring-soft">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
          Credits
        </div>
        <div className="flex-1 text-[12px] text-ink-200">
          {label} ready to use. Pick a preset.
        </div>
      </div>
    );
  }
  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 ring-soft">
      <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-danger">
        Out of credits
      </div>
      <div className="flex-1 text-[12px] text-ink-200">
        Pricing packs land soon.
      </div>
    </div>
  );
}

function PresetStrip({
  presets,
  selectedId,
  onSelect,
  loading,
}: {
  presets: PresetSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-[9/16] animate-pulse rounded-2xl bg-ink-800 ring-soft" />
        ))}
      </div>
    );
  }
  if (presets.length === 0) {
    return (
      <div className="rounded-2xl bg-ink-800 p-5 text-sm text-ink-300 ring-soft">
        No presets yet. Add some in <code className="text-ink-100">src/lib/server/presets-source.ts</code> and run{" "}
        <code className="text-ink-100">pnpm db:seed</code>.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {presets.slice(0, 6).map((p) => (
        <PresetCard key={p.id} preset={p} selected={selectedId === p.id} onSelect={onSelect} />
      ))}
    </div>
  );
}
