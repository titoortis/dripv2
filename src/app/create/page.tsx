"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { isMarketingMode } from "@/components/ComingSoon";
import { PresetCard, type PresetSummary, type AvailableCombo } from "@/components/PresetCard";
import { PresetSheet } from "@/components/PresetSheet";
import { UploadPad, type UploadedSource } from "@/components/UploadPad";
import { getStaticPresetSummaries } from "@/lib/presets-static";

// PR 6 spec rule: never assume product order from the wire. Sort defensively
// in every UI consumer — this rank table mirrors the seed-side normalization
// at `prisma/seed.ts` so even if the API drifts, the picker buttons render in
// product order.
const RESOLUTION_RANK: Record<string, number> = { "480p": 0, "720p": 1, "1080p": 2 };
function compareResolution(a: string, b: string): number {
  return (RESOLUTION_RANK[a] ?? 99) - (RESOLUTION_RANK[b] ?? 99);
}

export default function CreatePage() {
  return <CreatePageInner />;
}

function CreatePageInner() {
  const router = useRouter();
  const marketingMode = isMarketingMode();
  // Static seed is the SSR-safe initial value: same source-of-truth that
  // populates the DB via `pnpm db:seed`. In marketing mode it's the only
  // source — `/api/presets` requires a provisioned DB and 500s on prod.
  // In live mode it's the cushion before the network refresh lands, and
  // the fallback if the refresh fails. Either way we never flash the
  // "No presets yet — run pnpm db:seed" developer state to a real user.
  const initialPresets = useMemo(() => getStaticPresetSummaries(), []);
  const [presets, setPresets] = useState<PresetSummary[]>(initialPresets);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPresets[0]?.id ?? null,
  );
  const [source, setSource] = useState<UploadedSource | null>(null);
  // PR-A: secondary slot is now interactive. The id is held locally to surface
  // a real preview + Remove control but is intentionally NOT sent to
  // `/api/jobs` — `secondarySource.id` does not appear in the submit body,
  // does not participate in `requestHash`, and does not gate `canGenerate`.
  // PR-B will thread it through the job row + hash + stage-1 runtime branch.
  const [secondarySource, setSecondarySource] = useState<UploadedSource | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  // PR 6 picker state. Both default to the selected preset's first available
  // combo on preset switch (see effect below). They never go stale relative
  // to the preset because the combos are scoped per-preset.
  const [chosenResolution, setChosenResolution] = useState<string | null>(null);
  const [chosenDuration, setChosenDuration] = useState<number | null>(null);

  // Live preset refresh — best-effort, only in non-marketing mode. If it
  // fails, we keep the static seed (no empty state, no developer message).
  // If the live response has a different set of presets, we snap the
  // selection to the new first preset only when the previously-selected
  // id is gone from the live set.
  useEffect(() => {
    if (marketingMode) return;
    let alive = true;
    fetch("/api/presets")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { presets: PresetSummary[] } | null) => {
        if (!alive || !j || !Array.isArray(j.presets) || j.presets.length === 0) {
          return;
        }
        setPresets(j.presets);
        setSelectedId((prev) =>
          prev && j.presets.some((p) => p.id === prev) ? prev : j.presets[0]?.id ?? null,
        );
      })
      .catch(() => {
        /* swallow; static seed stays in place */
      });
    return () => {
      alive = false;
    };
  }, [marketingMode]);

  useEffect(() => {
    if (marketingMode) return;
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
  }, [marketingMode]);

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
  // PR-B: presets that opt into the reference-sheet stage need both
  // upload slots populated before the submit body is valid. For every
  // legacy preset (every preset today) `requiresOutfit` is false and
  // the gating reduces back to the PR-A primary-only rule.
  const needsOutfit = Boolean(selected?.requiresOutfit);
  const canGenerate =
    !marketingMode &&
    Boolean(source?.id && selected?.id && chosenCombo) &&
    (!needsOutfit || Boolean(secondarySource?.id)) &&
    !submitting &&
    !outOfCredits;

  async function generate() {
    if (marketingMode) return;
    if (!source || !selected || !chosenCombo) return;
    if (needsOutfit && !secondarySource) return;
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
          // PR-B: only send `outfitSourceImageId` when the preset opts
          // into the reference-sheet stage. For every legacy preset
          // (every preset today) the field is omitted and the request
          // body is byte-identical to pre-PR-B submits.
          ...(needsOutfit && secondarySource
            ? { outfitSourceImageId: secondarySource.id }
            : {}),
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
      <div className="px-safe mx-auto w-full max-w-3xl pb-[180px] pt-1.5 md:max-w-4xl md:pb-[200px] md:pt-6 lg:max-w-5xl">
        <h1 className="heading-display mb-2 text-[15px] tracking-tight text-ink-50 md:mb-5 md:text-3xl lg:text-4xl">
          Create video
        </h1>
        {marketingMode ? <MarketingModeBanner /> : <WalletBanner balance={balance} />}

        <section aria-labelledby="references-heading">
          <div className="mb-2 md:mb-4">
            <h2
              id="references-heading"
              className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-200 md:text-xs"
            >
              References
            </h2>
            <p className="text-[10.5px] leading-snug text-ink-400 md:mt-1 md:text-sm md:leading-relaxed">
              Primary reference becomes your character. Optional secondary slot accepts a
              second selfie or an outfit photo.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 md:gap-4">
            <UploadPad
              value={source}
              onChange={setSource}
              label="Primary"
              helperIdle="Character sheet works best."
              disabled={marketingMode}
              disabledMessage={
                marketingMode
                  ? "Upload arrives with the next drop."
                  : undefined
              }
            />
            {/* PR-A: secondary slot is interactive and writes a `SourceImage`
                row through the existing `/api/uploads` pipeline. The id is
                held in client state only — it is NOT sent to `/api/jobs`,
                does not participate in `requestHash`, and does not gate
                Generate. PR-B threads the id into the job row + hash + the
                stage-1 reference-sheet runtime branch. */}
            <UploadPad
              value={secondarySource}
              onChange={setSecondarySource}
              label={needsOutfit ? "Outfit" : "Optional"}
              helperIdle={
                needsOutfit
                  ? "Outfit reference. Required for this preset."
                  : "Second selfie or outfit reference."
              }
              disabled={marketingMode}
              disabledMessage={
                marketingMode
                  ? "Upload arrives with the next drop."
                  : undefined
              }
            />
          </div>
        </section>

        <section className="mt-4 md:mt-8">
          <div className="mb-2 flex items-end justify-between md:mb-4">
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-200 md:text-xs">
                Preset library
              </h2>
              <p className="text-[10.5px] leading-snug text-ink-400 md:mt-1 md:text-sm md:leading-relaxed">
                Each preset ships its own prompt, duration, and quality. Custom prompt editing arrives later.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="text-[11px] font-semibold text-accent underline-offset-4 hover:underline md:text-sm"
            >
              Browse all
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
        className="pb-safe fixed inset-x-0 bottom-0 z-40 mx-auto max-w-3xl md:max-w-4xl lg:max-w-5xl"
        style={{ pointerEvents: "none" }}
      >
        <div
          className="mx-2 my-2 rounded-2xl bg-ink-900/85 p-2.5 ring-soft glass md:mx-4 md:my-4 md:rounded-3xl md:p-4"
          style={{ pointerEvents: "auto" }}
        >
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
            <PresetMetaStrip
              preset={selected}
              chosenCombo={chosenCombo}
              chosenDuration={chosenDuration}
              chosenResolution={chosenResolution}
            />
          ) : null}
          {error ? (
            <div className="mb-1.5 px-1 text-[11px] text-danger md:mb-3 md:text-sm">{error}</div>
          ) : null}
          <Button
            block
            size="lg"
            disabled={!canGenerate}
            onClick={generate}
            className="md:py-5 md:text-[19px]"
          >
            {marketingMode
              ? "Generation arrives with the next drop"
              : submitting
                ? "Starting…"
                : outOfCredits
                  ? "Out of credits"
                  : chosenCombo
                    ? `Generate · ${chosenCombo.creditsCost} ${
                        chosenCombo.creditsCost === 1 ? "credit" : "credits"
                      }`
                    : "Generate"}
            {!marketingMode && !submitting && !outOfCredits && (
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 md:h-6 md:w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            )}
          </Button>
          {marketingMode ? (
            <p className="mt-1.5 text-center text-[10.5px] leading-snug text-ink-400 md:mt-3 md:text-sm">
              Preset prompt is included. Duration is preset-defined. Generation arrives with the next drop.
            </p>
          ) : outOfCredits && requiredCredits !== null ? (
            <p className="mt-1.5 text-center text-[10.5px] leading-snug text-ink-400 md:mt-3 md:text-sm">
              {`Need ${requiredCredits} ${
                requiredCredits === 1 ? "credit" : "credits"
              } — top-up arrives with pricing packs.`}
            </p>
          ) : !canGenerate && !submitting ? (
            <p className="mt-1.5 text-center text-[10.5px] leading-snug text-ink-400 md:mt-3 md:text-sm">
              {source
                ? selected && selected.availableCombos.length === 0
                  ? "More qualities arrive as we live-verify."
                  : "Pick a preset to continue. Preset prompt and duration are included."
                : "Upload a photo to continue. Preset prompt and duration are included."}
            </p>
          ) : (
            <p className="mt-1.5 text-center text-[10.5px] leading-snug text-ink-400 md:mt-3 md:text-sm">
              Preset prompt is included. Duration is preset-defined. Custom prompt editing arrives later.
            </p>
          )}
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

/**
 * Marketing-mode banner shown at the top of `/create` when the live
 * generation pipeline (Postgres + S3 + ARK_API_KEY) isn't provisioned.
 * Spells out which actions are unavailable so users see the preset library
 * without thinking the disabled state is a bug. Mirrors the visual
 * language of `WalletBanner` so the page rhythm doesn't shift between
 * modes.
 */
function MarketingModeBanner() {
  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 ring-soft">
      <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
        Preview
      </div>
      <div className="flex-1 text-[12px] text-ink-200">
        Upload and generation arrive with the next drop. Browse the preset library below.
      </div>
    </div>
  );
}

function WalletBanner({ balance }: { balance: number | null }) {
  if (balance === null) return null;
  if (balance >= 1) {
    const label = balance === 1 ? "1 credit" : `${balance} credits`;
    return (
      <div className="mb-3 flex items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 ring-soft md:mb-6 md:gap-4 md:px-6 md:py-4">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent md:text-sm">
          Credits
        </div>
        <div className="flex-1 text-[12px] text-ink-200 md:text-base">
          {label} available. Pick a preset and quality.
        </div>
      </div>
    );
  }
  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 ring-soft md:mb-6 md:gap-4 md:px-6 md:py-4">
      <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-danger md:text-sm">
        Out of credits
      </div>
      <div className="flex-1 text-[12px] text-ink-200 md:text-base">
        Pricing packs land soon.
      </div>
    </div>
  );
}

/**
 * Conditional picker: only renders a row for an axis that has more than one
 * real option. The product rule (PR #23) is *no selector for any axis with
 * only one real option* — a single-button row is a fake choice and reads as
 * a dev playground.
 *
 *   - quality row appears only when `availableResolutions.length > 1`. Today
 *     every preset declares a single allowed quality, so the quality row
 *     never shows.
 *   - duration row appears only when the preset is **not** locked-duration
 *     **and** more than one duration is available for the chosen quality.
 *     Today every preset declares `lockedDurationSec`, so the duration row
 *     never shows either.
 *
 * When both axes are single-option, the picker collapses to nothing and
 * `<PresetMetaStrip>` is the entire quality surface. As axes gain real
 * choices via newly verified provider combos, the corresponding row
 * reappears for that axis only — no schema change needed, no UI redesign
 * needed.
 *
 * Display matches charge: the credits read from the exact `availableCombos`
 * row this picker selects (or the only row, when locked), so what the user
 * sees is exactly what the server will debit.
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
      <div className="mb-1.5 px-1 text-[10.5px] text-ink-400 md:mb-3 md:text-sm">
        Live-verified qualities arrive soon for this preset.
      </div>
    );
  }
  const showQualityRow = availableResolutions.length > 1;
  const showDurationRow =
    preset.lockedDurationSec === null && availableDurationsForResolution.length > 1;
  if (!showQualityRow && !showDurationRow) return null;
  return (
    <div className="mb-1.5 grid gap-1 px-1 md:mb-3 md:gap-3">
      {showQualityRow ? (
        <PickerRow
          label="Quality"
          items={availableResolutions}
          chosen={chosenResolution}
          onPick={onChangeResolution}
          renderLabel={(r) => r}
        />
      ) : null}
      {showDurationRow ? (
        <PickerRow
          label="Length"
          items={availableDurationsForResolution}
          chosen={chosenDuration}
          onPick={onChangeDuration}
          renderLabel={(d) => `${d}s`}
        />
      ) : null}
    </div>
  );
}

/**
 * Locked meta strip — single low-contrast line that surfaces the preset's
 * intent as non-interactive metadata: title, duration, quality, aspect,
 * credits cost. Replaces the older `<Chip>` row to make the bottom CTA feel
 * productized instead of like a chip soup.
 *
 * The strip is always rendered while a preset is selected; it serves as
 * the truth-in-advertising line for what Generate will submit. When an
 * axis is locked (e.g. duration), the strip is the only place that value
 * appears — the picker doesn't render a row for it.
 */
function PresetMetaStrip({
  preset,
  chosenCombo,
  chosenDuration,
  chosenResolution,
}: {
  preset: PresetSummary;
  chosenCombo: AvailableCombo | null;
  chosenDuration: number | null;
  chosenResolution: string | null;
}) {
  const dur = chosenDuration ?? preset.lockedDurationSec ?? preset.durationSec;
  const res = chosenResolution ?? preset.resolution;
  const aspect = preset.aspectRatio;
  const cost = chosenCombo?.creditsCost ?? null;
  const refMode = preset.referenceMode === "reference_images";
  return (
    <>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[10.5px] text-ink-300 md:mb-3 md:gap-x-3 md:gap-y-1 md:text-sm">
        <span className="truncate font-medium text-ink-100 md:text-base">{preset.title}</span>
        <span aria-hidden className="text-ink-500">·</span>
        <span>{`${dur}s`}</span>
        <span aria-hidden className="text-ink-500">·</span>
        <span>{res}</span>
        <span aria-hidden className="text-ink-500">·</span>
        <span>{aspect}</span>
        {cost !== null ? (
          <>
            <span aria-hidden className="text-ink-500">·</span>
            <span>{`${cost} ${cost === 1 ? "credit" : "credits"}`}</span>
          </>
        ) : null}
      </div>
      {refMode ? (
        <p className="mb-1.5 px-1 text-[10.5px] leading-snug text-ink-300 md:mb-3 md:text-sm md:leading-relaxed">
          <span className="font-semibold text-ink-100">Reference mode:</span>{" "}
          your photo is used as a character-consistency reference rather than the
          opening frame.
        </p>
      ) : null}
    </>
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
    <div className="flex items-center gap-2 md:gap-4">
      <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400 md:w-20 md:text-xs">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5 md:gap-2">
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
                  ? "rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-accent-ink ring-soft md:px-5 md:py-2 md:text-base"
                  : "rounded-full bg-ink-800 px-3 py-1 text-[12px] text-ink-100 ring-soft hover:bg-ink-700 md:px-5 md:py-2 md:text-base"
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
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-4 md:gap-3 lg:grid-cols-5 lg:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-ink-800 ring-soft" />
        ))}
      </div>
    );
  }
  if (presets.length === 0) {
    return (
      <div className="rounded-xl bg-ink-800 p-4 text-[12px] text-ink-300 ring-soft">
        No presets yet. Add some in <code className="text-ink-100">src/lib/server/presets-source.ts</code> and run{" "}
        <code className="text-ink-100">pnpm db:seed</code>.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-4 md:gap-3 lg:grid-cols-5 lg:gap-4">
      {presets.map((p) => (
        <PresetCard key={p.id} preset={p} selected={selectedId === p.id} onSelect={onSelect} />
      ))}
    </div>
  );
}
