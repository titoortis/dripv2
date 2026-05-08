"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { ComingSoon, isMarketingMode } from "@/components/ComingSoon";
import { PresetCard, type PresetSummary, type AvailableCombo } from "@/components/PresetCard";
import { PresetSheet } from "@/components/PresetSheet";
import { UploadPad, type UploadedSource } from "@/components/UploadPad";

// PR 6 spec rule: never assume product order from the wire. Sort defensively
// in every UI consumer — this rank table mirrors the seed-side normalization
// at `prisma/seed.ts` so even if the API drifts, the picker buttons render in
// product order.
const RESOLUTION_RANK: Record<string, number> = { "480p": 0, "720p": 1, "1080p": 2 };
function compareResolution(a: string, b: string): number {
  return (RESOLUTION_RANK[a] ?? 99) - (RESOLUTION_RANK[b] ?? 99);
}

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
  // PR 6 picker state. Both default to the selected preset's first available
  // combo on preset switch (see effect below). They never go stale relative
  // to the preset because the combos are scoped per-preset.
  const [chosenResolution, setChosenResolution] = useState<string | null>(null);
  const [chosenDuration, setChosenDuration] = useState<number | null>(null);

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

  // Defensive picker derivations. We re-sort everything coming off the wire
  // (rule from PR 6 spec) and never assume the API normalized for us.
  const availableResolutions = useMemo<string[]>(() => {
    if (!selected) return [];
    const set = new Set(selected.availableCombos.map((c) => c.resolution));
    return Array.from(set).sort(compareResolution);
  }, [selected]);

  // Durations valid for the *currently chosen* resolution. If no resolution
  // is chosen yet, returns durations across all available combos so the row
  // can still render disabled buttons.
  const availableDurationsForResolution = useMemo<number[]>(() => {
    if (!selected) return [];
    const set = new Set(
      selected.availableCombos
        .filter((c) => (chosenResolution ? c.resolution === chosenResolution : true))
        .map((c) => c.durationSec),
    );
    return Array.from(set).sort((a, b) => a - b);
  }, [selected, chosenResolution]);

  // The single combo we'll submit (if both axes are chosen and the pair is
  // actually in `availableCombos`). Cost is read straight off the same row,
  // not recomputed in the UI — display-must-match-charged.
  const chosenCombo = useMemo<AvailableCombo | null>(() => {
    if (!selected || chosenResolution === null || chosenDuration === null) return null;
    return (
      selected.availableCombos.find(
        (c) => c.resolution === chosenResolution && c.durationSec === chosenDuration,
      ) ?? null
    );
  }, [selected, chosenResolution, chosenDuration]);

  // When the preset changes, reset the picker to the new preset's baseline
  // combo if it's available, otherwise the first available combo. This keeps
  // the picker honest — never leaves a stale (resolution, duration) selected
  // for a preset that doesn't expose it.
  useEffect(() => {
    if (!selected || selected.availableCombos.length === 0) {
      setChosenResolution(null);
      setChosenDuration(null);
      return;
    }
    const baseline = selected.availableCombos.find(
      (c) => c.resolution === selected.resolution && c.durationSec === selected.durationSec,
    );
    const fallback = baseline ?? selected.availableCombos[0];
    setChosenResolution(fallback.resolution);
    setChosenDuration(fallback.durationSec);
  }, [selected]);

  // If the chosen resolution stops pairing with the chosen duration (e.g.
  // future combo expansion), snap duration to the first valid one.
  useEffect(() => {
    if (!selected || chosenResolution === null) return;
    const valid = selected.availableCombos.some(
      (c) => c.resolution === chosenResolution && c.durationSec === chosenDuration,
    );
    if (valid) return;
    const firstForRes = selected.availableCombos.find((c) => c.resolution === chosenResolution);
    if (firstForRes) setChosenDuration(firstForRes.durationSec);
  }, [selected, chosenResolution, chosenDuration]);

  const requiredCredits = chosenCombo?.creditsCost ?? null;
  const outOfCredits =
    balance !== null && requiredCredits !== null && balance < requiredCredits;
  const canGenerate =
    Boolean(source?.id && selected?.id && chosenCombo) && !submitting && !outOfCredits;

  async function generate() {
    if (!source || !selected || !chosenCombo) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: selected.id,
          sourceImageId: source.id,
          resolution: chosenCombo.resolution,
          durationSec: chosenCombo.durationSec,
        }),
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
            <QualityPicker
              preset={selected}
              availableResolutions={availableResolutions}
              availableDurationsForResolution={availableDurationsForResolution}
              chosenResolution={chosenResolution}
              chosenDuration={chosenDuration}
              onChangeResolution={setChosenResolution}
              onChangeDuration={setChosenDuration}
            />
          ) : null}
          {selected ? (
            <div className="mb-2 flex items-center gap-2 px-1">
              <Chip>{chosenDuration ?? selected.durationSec}s</Chip>
              <Chip>{selected.aspectRatio}</Chip>
              <Chip>{chosenResolution ?? selected.resolution}</Chip>
              {chosenCombo ? (
                <Chip>{`${chosenCombo.creditsCost} ${
                  chosenCombo.creditsCost === 1 ? "credit" : "credits"
                }`}</Chip>
              ) : null}
              <span className="ml-auto truncate text-[12px] text-ink-300">{selected.title}</span>
            </div>
          ) : null}
          {error ? <div className="mb-2 px-1 text-[12px] text-danger">{error}</div> : null}
          <Button block size="lg" disabled={!canGenerate} onClick={generate}>
            {submitting
              ? "Starting…"
              : outOfCredits
                ? "Out of credits"
                : chosenCombo
                  ? `Generate · ${chosenCombo.creditsCost} ${
                      chosenCombo.creditsCost === 1 ? "credit" : "credits"
                    }`
                  : "Generate"}
            {!submitting && !outOfCredits && (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            )}
          </Button>
          {outOfCredits && requiredCredits !== null ? (
            <p className="mt-2 text-center text-[11px] text-ink-400">
              {`Need ${requiredCredits} ${
                requiredCredits === 1 ? "credit" : "credits"
              } — top-up arrives with pricing packs.`}
            </p>
          ) : !canGenerate && !submitting ? (
            <p className="mt-2 text-center text-[11px] text-ink-400">
              {source
                ? selected && selected.availableCombos.length === 0
                  ? "More qualities arrive as we live-verify."
                  : "Pick a preset to continue."
                : "Upload a photo to continue."}
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
    const label = balance === 1 ? "1 credit" : `${balance} credits`;
    return (
      <div className="mb-3 flex items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 ring-soft">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
          Credits
        </div>
        <div className="flex-1 text-[12px] text-ink-200">
          {label} available. Pick a preset and quality.
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

/**
 * Two-row picker: resolution buttons (sorted by product rank) and duration
 * buttons (sorted numerically). Buttons that don't appear in
 * `availableCombos` for the selected preset are *not rendered at all* —
 * showing them disabled would mislead users about which qualities are
 * actually shippable today (only 720p × 5s is verified at PR 6 merge time).
 *
 * Display matches charge: the credits chip in the bottom CTA reads from the
 * exact `availableCombos` row this picker selects, so what the button says
 * is exactly what the server will debit.
 */
function QualityPicker({
  preset,
  availableResolutions,
  availableDurationsForResolution,
  chosenResolution,
  chosenDuration,
  onChangeResolution,
  onChangeDuration,
}: {
  preset: PresetSummary;
  availableResolutions: string[];
  availableDurationsForResolution: number[];
  chosenResolution: string | null;
  chosenDuration: number | null;
  onChangeResolution: (r: string) => void;
  onChangeDuration: (d: number) => void;
}) {
  if (preset.availableCombos.length === 0) {
    return (
      <div className="mb-2 px-1 text-[11px] text-ink-400">
        Live-verified qualities arrive soon for this preset.
      </div>
    );
  }
  return (
    <div className="mb-2 grid gap-1.5 px-1">
      <PickerRow
        label="Quality"
        items={availableResolutions}
        chosen={chosenResolution}
        onPick={onChangeResolution}
        renderLabel={(r) => r}
      />
      <PickerRow
        label="Length"
        items={availableDurationsForResolution}
        chosen={chosenDuration}
        onPick={onChangeDuration}
        renderLabel={(d) => `${d}s`}
      />
    </div>
  );
}

function PickerRow<T extends string | number>({
  label,
  items,
  chosen,
  onPick,
  renderLabel,
}: {
  label: string;
  items: T[];
  chosen: T | null;
  onPick: (v: T) => void;
  renderLabel: (v: T) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((v) => {
          const active = chosen === v;
          return (
            <button
              key={String(v)}
              type="button"
              onClick={() => onPick(v)}
              aria-pressed={active}
              className={
                active
                  ? "rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-accent-ink ring-soft"
                  : "rounded-full bg-ink-800 px-3 py-1 text-[12px] text-ink-100 ring-soft hover:bg-ink-700"
              }
            >
              {renderLabel(v)}
            </button>
          );
        })}
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
