"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { PresetCard, type PresetSummary } from "./PresetCard";

export function PresetSheet({
  open,
  presets,
  selectedId,
  onSelect,
  onClose,
}: {
  open: boolean;
  presets: PresetSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 transition",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preset-sheet-title"
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/70 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 mx-auto flex max-h-[88vh] w-full max-w-3xl flex-col rounded-t-3xl bg-ink-900 shadow-sheet ring-soft",
          "transition-transform duration-300 ease-out",
          open ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="px-5 pt-3 pb-1">
          <div className="mx-auto h-1 w-10 rounded-full bg-ink-600" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pb-3">
          <div>
            <h2 id="preset-sheet-title" className="heading-display text-[20px] tracking-tight text-ink-50">
              SEEDANCE 2.0 VFX PRESETS
            </h2>
            <p className="mt-1 text-[13px] text-ink-300">
              Apply cinematic looks, effects, and scene styles in seconds.
            </p>
            <CapabilityLegend presets={presets} />
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink-800 text-ink-200 ring-soft hover:bg-ink-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {presets.map((p) => (
              <PresetCard key={p.id} preset={p} selected={selectedId === p.id} onSelect={onSelect} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Display-only capability legend (PR 5). Reads each preset's
 * `supportedResolutions` / `supportedDurations` from `/api/presets` and
 * renders the union as a single subtitle under the sheet header. The
 * underlying picker doesn't exist yet — that lands in PR 6.
 *
 * Renders nothing if every visible preset only declares its baseline render
 * setting (i.e. nothing extra to advertise yet).
 */
function CapabilityLegend({ presets }: { presets: PresetSummary[] }) {
  if (presets.length === 0) return null;
  const resSet = new Set<string>();
  const durSet = new Set<number>();
  for (const p of presets) {
    for (const r of p.supportedResolutions ?? []) resSet.add(r);
    for (const d of p.supportedDurations ?? []) durSet.add(d);
  }
  const resolutionsList = Array.from(resSet).sort(compareResolution);
  const durationsList = Array.from(durSet).sort((a, b) => a - b);
  const hasExtraResolutions =
    resolutionsList.length > 1 ||
    presets.some((p) => !(p.supportedResolutions ?? []).includes(p.resolution));
  const hasExtraDurations =
    durationsList.length > 1 ||
    presets.some((p) => !(p.supportedDurations ?? []).includes(p.durationSec));
  if (!hasExtraResolutions && !hasExtraDurations) return null;
  return (
    <p className="mt-2 text-[12px] leading-snug text-ink-400">
      Quality picker for {resolutionsList.join(" · ")} × {durationsList.map((d) => `${d}s`).join(" · ")}{" "}
      arrives next.
    </p>
  );
}

const RESOLUTION_RANK: Record<string, number> = { "480p": 0, "720p": 1, "1080p": 2 };
function compareResolution(a: string, b: string): number {
  return (RESOLUTION_RANK[a] ?? 99) - (RESOLUTION_RANK[b] ?? 99);
}
