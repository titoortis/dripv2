"use client";

import { cn } from "@/lib/utils";

/**
 * `(resolution, durationSec)` pairs the picker is allowed to expose for this
 * preset, plus the exact integer credits we'll debit at submit. Computed
 * server-side as `supportedResolutions × supportedDurations ∩
 * PROVIDER_VERIFIED_COMBOS` (see `/api/presets`). The picker iterates this
 * list directly — it does not Cartesian-product the supported axes, which
 * would expose verification-pending combos.
 */
export type AvailableCombo = {
  resolution: string;
  durationSec: number;
  creditsCost: number;
};

export type PresetReferenceMode = "first_frame" | "reference_images";

export type PresetSummary = {
  id: string;
  title: string;
  subtitle?: string | null;
  thumbnailUrl?: string | null;
  aspectRatio: string;
  durationSec: number;
  resolution: string;
  // PR 5 capability seam (kept for diagnostics / future "more qualities soon"
  // hints). Display-only.
  supportedResolutions: string[];
  supportedDurations: number[];
  // PR 6 picker source-of-truth.
  availableCombos: AvailableCombo[];

  // PR #23 preset-first contract. The picker reads `qualityLocked` /
  // `lockedDurationSec` / `aspectLocked` to decide whether to render a
  // selectable row for that axis or surface the value as locked meta.
  // The labels are display-only.
  lockedDurationSec: number | null;
  allowedQualities: string[];
  allowedAspectRatios: string[];
  qualityLocked: boolean;
  aspectLocked: boolean;
  durationLabel: string;
  qualityLabel: string;
  aspectLabel: string;
  // PR 34 disclosure. Which provider-side content slot this preset uses
  // when the kill switch is on at submit time. "reference_images" surfaces
  // a "Ref mode" badge on the card and an informational note on /create.
  // Whether the runtime actually used that slot is captured on the job row
  // (`GenerationJob.role`), not here.
  referenceMode: PresetReferenceMode;
  // PR-B: true when the preset has a non-null
  // `referenceSheetPromptTemplate` server-side — i.e. the runner will run
  // its stage-1 reference-sheet composition. The wire format only carries
  // the boolean (not the full template) because the client only needs to
  // gate the secondary upload slot + the submit payload on this signal.
  // False on every preset today.
  requiresOutfit: boolean;
};

export function PresetCard({
  preset,
  selected,
  onSelect,
}: {
  preset: PresetSummary;
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(preset.id)}
      className={cn(
        "group relative aspect-[3/4] overflow-hidden rounded-xl bg-ink-800 text-left ring-soft",
        "transition focus:outline-none",
        selected && "ring-2 ring-accent",
      )}
      aria-pressed={selected}
    >
      <Thumb preset={preset} />
      {preset.referenceMode === "reference_images" ? <RefModeBadge /> : null}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5 md:p-3.5">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="heading-display truncate text-[12.5px] leading-tight text-white md:text-base lg:text-lg">
              {preset.title}
            </div>
            {preset.subtitle ? (
              <div className="mt-0.5 truncate text-[10.5px] leading-tight text-ink-200 md:mt-1 md:text-sm">
                {preset.subtitle}
              </div>
            ) : null}
          </div>
          {selected ? <SelectedDot /> : null}
        </div>
      </div>
    </button>
  );
}

/**
 * Small top-left badge surfaced on presets that opt in to the
 * reference-image content slot. Display-only — the actual provider role
 * used by a job is recorded on `GenerationJob.role` at submit time.
 */
function RefModeBadge() {
  return (
    <span
      className="absolute left-1.5 top-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-100 ring-soft backdrop-blur"
      title="This preset uses the reference-image content slot for character consistency."
    >
      Ref mode
    </span>
  );
}

function Thumb({ preset }: { preset: PresetSummary }) {
  if (preset.thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={preset.thumbnailUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
      />
    );
  }
  return <PresetPlaceholder seed={preset.id} />;
}

function SelectedDot() {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-ink ring-soft">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3}>
        <path d="M5 12.5L10 17.5L19 7.5" />
      </svg>
    </span>
  );
}

/** Deterministic gradient placeholder so the grid still feels designed
 *  without bundled assets. The seed is the preset id. Exported so the
 *  PresetLauncher overlay (and any future hero surface) renders the exact
 *  same fallback as the card grid for the same preset id. */
export function PresetPlaceholder({ seed }: { seed: string }) {
  const palette = pickPalette(seed);
  return (
    <div
      aria-hidden
      className="absolute inset-0 h-full w-full"
      style={{
        background: `radial-gradient(120% 90% at 30% 20%, ${palette[0]} 0%, transparent 60%),
                     radial-gradient(120% 90% at 80% 70%, ${palette[1]} 0%, transparent 55%),
                     linear-gradient(180deg, ${palette[2]} 0%, ${palette[3]} 100%)`,
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_50%_-20%,rgba(255,255,255,0.06),transparent_50%)]" />
      <div className="absolute inset-0 mix-blend-overlay opacity-40 [background:repeating-linear-gradient(0deg,transparent_0,transparent_3px,rgba(255,255,255,0.04)_3px,rgba(255,255,255,0.04)_4px)]" />
    </div>
  );
}

const PALETTES: [string, string, string, string][] = [
  ["#7B8CDE", "#3B0F2D", "#0E0F19", "#0A0B16"],
  ["#9F6CFF", "#FF5A5F", "#10131C", "#070A12"],
  ["#5CE7A0", "#1B9AAA", "#0B1414", "#06090A"],
  ["#FFB74A", "#7B3F00", "#100B07", "#070504"],
  ["#FF7AC6", "#3D1F4D", "#100B19", "#06040C"],
  ["#46D6E5", "#0B5970", "#06121A", "#04080D"],
  ["#D6F24A", "#3F4612", "#0F1108", "#070803"],
  ["#FF5A5F", "#3D0E12", "#10080A", "#080406"],
  ["#9CB8FF", "#1A2A6C", "#0A1124", "#06091A"],
  ["#F2C7A0", "#5C3A18", "#1A1108", "#0B0704"],
  ["#A6F0C6", "#0F4F3A", "#0A1611", "#06100C"],
  ["#FFA1F0", "#5A1F75", "#160A1F", "#0A0613"],
];

function pickPalette(seed: string): [string, string, string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}
