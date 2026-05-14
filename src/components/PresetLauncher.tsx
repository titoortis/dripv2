"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import {
  PresetPlaceholder,
  type AvailableCombo,
  type PresetSummary,
} from "@/components/PresetCard";
import { type UploadedSource } from "@/components/UploadPad";
import { cn } from "@/lib/utils";

/**
 * Higgs-style launch overlay for the homepage's first preset card.
 *
 * Behavior contract:
 *  - Mobile (<sm): bottom sheet, slides up.
 *  - Desktop (≥sm): centered modal.
 *  - ESC closes. Click on the backdrop closes. Body scroll locked while open.
 *  - Initial focus lands on the close button (so screen-reader users know
 *    where they are; full focus-trap is intentionally out of scope for v1).
 *  - Reuses the same defensive picker derivations as `/create`: never assume
 *    `availableCombos` is sorted, never let the chosen pair drift outside
 *    the verified set.
 *  - Generation submits the same `{presetId, sourceImageId, resolution,
 *    durationSec}` body as `/create`. The secondary reference slot is
 *    visible but non-interactive (comingSoon), matching `/create`'s
 *    truthful approach — no upload, no state, no API call.
 */
export function PresetLauncher({
  open,
  preset,
  onClose,
}: {
  open: boolean;
  preset: PresetSummary | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [primary, setPrimary] = useState<UploadedSource | null>(null);
  const [chosenResolution, setChosenResolution] = useState<string | null>(null);
  const [chosenDuration, setChosenDuration] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Reset state when the preset changes / the overlay is (re)opened. We do
  // this on `open` going true so closing-and-reopening clears any stale
  // error from the prior attempt.
  useEffect(() => {
    if (!open || !preset) return;
    setError(null);
    setSubmitting(false);
    if (preset.availableCombos.length === 0) {
      setChosenResolution(null);
      setChosenDuration(null);
      return;
    }
    const baseline = preset.availableCombos.find(
      (c) => c.resolution === preset.resolution && c.durationSec === preset.durationSec,
    );
    const fallback = baseline ?? preset.availableCombos[0];
    setChosenResolution(fallback.resolution);
    setChosenDuration(fallback.durationSec);
  }, [open, preset]);

  // ESC + body-lock + initial focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Defer focus until after the AnimatePresence enter so the element is
    // actually mounted and visible.
    const t = window.setTimeout(() => closeRef.current?.focus(), 60);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  // Wallet balance only matters once the overlay is open. Lazy-load.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/wallet", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { balance: number } | null) => {
        if (!alive || !j) return;
        setBalance(j.balance);
      })
      .catch(() => {
        /* swallow; CTA still renders, the credits hint just won't appear */
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // Defensive picker derivations. Mirrors `/create` rule: never assume the
  // API normalized — re-sort everything coming off the wire.
  const availableResolutions = useMemo<string[]>(() => {
    if (!preset) return [];
    return Array.from(new Set(preset.availableCombos.map((c) => c.resolution))).sort(
      compareResolution,
    );
  }, [preset]);

  const availableDurationsForResolution = useMemo<number[]>(() => {
    if (!preset) return [];
    return Array.from(
      new Set(
        preset.availableCombos
          .filter((c) => (chosenResolution ? c.resolution === chosenResolution : true))
          .map((c) => c.durationSec),
      ),
    ).sort((a, b) => a - b);
  }, [preset, chosenResolution]);

  const chosenCombo = useMemo<AvailableCombo | null>(() => {
    if (!preset || chosenResolution === null || chosenDuration === null) return null;
    return (
      preset.availableCombos.find(
        (c) => c.resolution === chosenResolution && c.durationSec === chosenDuration,
      ) ?? null
    );
  }, [preset, chosenResolution, chosenDuration]);

  // Snap-back: if the chosen resolution stops pairing with the chosen
  // duration (future combo expansion), pick the first valid duration.
  useEffect(() => {
    if (!preset || chosenResolution === null) return;
    const valid = preset.availableCombos.some(
      (c) => c.resolution === chosenResolution && c.durationSec === chosenDuration,
    );
    if (valid) return;
    const firstForRes = preset.availableCombos.find((c) => c.resolution === chosenResolution);
    if (firstForRes) setChosenDuration(firstForRes.durationSec);
  }, [preset, chosenResolution, chosenDuration]);

  const requiredCredits = chosenCombo?.creditsCost ?? null;
  const outOfCredits =
    balance !== null && requiredCredits !== null && balance < requiredCredits;
  const canGenerate =
    Boolean(primary?.id && preset?.id && chosenCombo) && !submitting && !outOfCredits;

  async function generate() {
    if (!preset || !primary || !chosenCombo) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: preset.id,
          sourceImageId: primary.id,
          resolution: chosenCombo.resolution,
          durationSec: chosenCombo.durationSec,
        }),
      });
      if (res.status === 402) {
        const j = (await res.json().catch(() => null)) as { balance?: number } | null;
        if (typeof j?.balance === "number") setBalance(j.balance);
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { job: { id: string } };
      router.push(`/jobs/${j.job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start generation");
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && preset ? (
        <motion.div
          key="launcher"
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="launcher-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            tabIndex={-1}
            style={{ minHeight: "100%" }}
          />
          <motion.div
            className={cn(
              "pb-safe relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-ink-900 ring-soft shadow-sheet",
              "sm:max-h-[88vh] sm:rounded-3xl",
            )}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.8 }}
          >
            <Hero preset={preset} onClose={onClose} closeRef={closeRef} />
            <div className="flex-1 overflow-y-auto px-5 pt-4">
              <ReferencesBlock
                primary={primary}
                onPrimary={setPrimary}
              />
              <SettingsBlock
                preset={preset}
                availableResolutions={availableResolutions}
                availableDurationsForResolution={availableDurationsForResolution}
                chosenResolution={chosenResolution}
                chosenDuration={chosenDuration}
                onChangeResolution={setChosenResolution}
                onChangeDuration={setChosenDuration}
              />
            </div>
            <Footer
              primary={primary}
              chosenCombo={chosenCombo}
              outOfCredits={outOfCredits}
              requiredCredits={requiredCredits}
              submitting={submitting}
              error={error}
              canGenerate={canGenerate}
              onGenerate={generate}
            />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ----------------------------------------------------------- subcomponents */

function Hero({
  preset,
  onClose,
  closeRef,
}: {
  preset: PresetSummary;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement>;
}) {
  return (
    <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden bg-ink-950 sm:aspect-[21/9]">
      {preset.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preset.thumbnailUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <PresetPlaceholder seed={preset.id} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/30 to-transparent" />
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-black/70"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div className="absolute inset-x-0 bottom-0 px-5 pb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
          Seedance 2.0 · Preset
        </div>
        <h2
          id="launcher-title"
          className="heading-display mt-1 text-[26px] leading-tight text-white sm:text-[30px]"
        >
          {preset.title}
        </h2>
        {preset.subtitle ? (
          <p className="mt-1 text-[13px] text-white/75">{preset.subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

function ReferencesBlock({
  primary,
  onPrimary,
}: {
  primary: UploadedSource | null;
  onPrimary: (next: UploadedSource | null) => void;
}) {
  return (
    <section className="mb-5">
      <SectionLabel>References</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <RefSlot
          label="Character sheet"
          hint="Your face/identity. Required."
          required
          value={primary}
          onChange={onPrimary}
        />
        <ComingSoonSlot />
      </div>
      <p className="mt-2 text-[11px] text-ink-400">
        Primary reference becomes your character. Secondary slot arrives with
        character support.
      </p>
    </section>
  );
}

function RefSlot({
  label,
  hint,
  required,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  required: boolean;
  value: UploadedSource | null;
  onChange: (next: UploadedSource | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const localPreview = URL.createObjectURL(file);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return localPreview;
      });
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `Upload failed: HTTP ${res.status}`);
      }
      const j = (await res.json()) as { sourceImage: UploadedSource };
      onChange(j.sourceImage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      onChange(null);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const hasMedia = value && previewUrl;

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl bg-ink-800 transition hover:bg-ink-700",
          hasMedia ? "ring-2 ring-accent" : "ring-soft",
          busy && "opacity-80",
        )}
        aria-label={`Upload ${label}`}
      >
        {hasMedia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 px-3 text-center">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 text-ink-300"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
            </svg>
            <div className="text-[12px] font-semibold text-ink-100">{label}</div>
            <div className="text-[10px] leading-tight text-ink-400">{hint}</div>
            <div className="mt-0.5 text-[9px] text-ink-500">JPEG, PNG, or WebP · up to 12 MB</div>
          </div>
        )}
        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          </div>
        ) : null}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : hasMedia ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-ink-300 underline-offset-4 hover:text-ink-100"
            >
              Replace
            </button>
            <span className="text-ink-600" aria-hidden>·</span>
            <button
              type="button"
              onClick={clear}
              className="text-ink-300 underline-offset-4 hover:text-ink-100"
            >
              Remove
            </button>
          </span>
        ) : (
          <span className="text-ink-400">{required ? "Required" : "Optional"}</span>
        )}
      </div>
    </div>
  );
}

/** Static coming-soon slot for the secondary reference. Matches the
 *  `comingSoon` treatment on `/create`'s `UploadPad`: visible but
 *  non-interactive, no file input, no state, no API call. */
function ComingSoonSlot() {
  return (
    <div>
      <div
        role="img"
        className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-ink-600 bg-ink-800 opacity-70"
        aria-label="Optional secondary reference — arrives with character support"
      >
        <span
          aria-hidden="true"
          className="absolute left-2 top-2 z-10 rounded-full bg-ink-700/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-200"
        >
          Optional
        </span>
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 z-10 rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-accent"
        >
          Soon
        </span>
        <div className="flex flex-col items-center gap-1 px-3 text-center text-ink-400">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zm3 5h8m-8 4h8m-8 4h5" />
          </svg>
          <div className="text-[11px] font-medium text-ink-300">Style or pet ref</div>
          <div className="text-[10px] leading-tight text-ink-500">Arrives with character support</div>
        </div>
      </div>
      <div className="mt-1.5 text-[11px] text-ink-500">
        Optional
      </div>
    </div>
  );
}

function SettingsBlock({
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
  const noCombos = preset.availableCombos.length === 0;
  return (
    <section className="mb-4">
      <SectionLabel>Settings</SectionLabel>
      <div className="grid gap-2">
        <SettingRow label="Aspect">
          <Pill active>{preset.aspectRatio}</Pill>
        </SettingRow>
        <SettingRow label="Length">
          {noCombos ? (
            <span className="text-[12px] text-ink-400">Live-verified lengths arrive soon.</span>
          ) : (
            availableDurationsForResolution.map((d) => (
              <Pill
                key={d}
                active={chosenDuration === d}
                onClick={() => onChangeDuration(d)}
              >
                {`${d}s`}
              </Pill>
            ))
          )}
        </SettingRow>
        <SettingRow label="Quality">
          {noCombos ? (
            <span className="text-[12px] text-ink-400">Live-verified qualities arrive soon.</span>
          ) : (
            availableResolutions.map((r) => (
              <Pill
                key={r}
                active={chosenResolution === r}
                onClick={() => onChangeResolution(r)}
              >
                {r}
              </Pill>
            ))
          )}
        </SettingRow>
      </div>
    </section>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Pill({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  if (!onClick) {
    return (
      <span
        className={cn(
          "rounded-full px-3 py-1 text-[12px] ring-soft",
          active
            ? "bg-accent text-accent-ink font-semibold"
            : "bg-ink-800 text-ink-100",
        )}
      >
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-3 py-1 text-[12px] ring-soft transition",
        active
          ? "bg-accent text-accent-ink font-semibold"
          : "bg-ink-800 text-ink-100 hover:bg-ink-700",
      )}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-300">
      {children}
    </h3>
  );
}

function Footer({
  primary,
  chosenCombo,
  outOfCredits,
  requiredCredits,
  submitting,
  error,
  canGenerate,
  onGenerate,
}: {
  primary: UploadedSource | null;
  chosenCombo: AvailableCombo | null;
  outOfCredits: boolean;
  requiredCredits: number | null;
  submitting: boolean;
  error: string | null;
  canGenerate: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="border-t border-white/5 bg-ink-900 px-5 pb-4 pt-3">
      {chosenCombo ? (
        <div className="mb-2 flex items-center gap-2">
          <Chip>{`${chosenCombo.creditsCost} ${
            chosenCombo.creditsCost === 1 ? "credit" : "credits"
          }`}</Chip>
          <Chip>{chosenCombo.resolution}</Chip>
          <Chip>{`${chosenCombo.durationSec}s`}</Chip>
        </div>
      ) : null}
      {error ? <div className="mb-2 text-[12px] text-danger">{error}</div> : null}
      <Button block size="lg" disabled={!canGenerate} onClick={onGenerate}>
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
      <p className="mt-2 text-center text-[11px] text-ink-400">
        {outOfCredits && requiredCredits !== null
          ? `Need ${requiredCredits} ${
              requiredCredits === 1 ? "credit" : "credits"
            } — top-up arrives with pricing packs.`
          : !canGenerate && !submitting
            ? primary
              ? chosenCombo
                ? "Ready when you are."
                : "More qualities arrive as we live-verify."
              : "Upload a character sheet to continue."
            : "Verified-combo gate active. Display matches the credits we’ll debit."}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

const RESOLUTION_RANK: Record<string, number> = { "480p": 0, "720p": 1, "1080p": 2 };
function compareResolution(a: string, b: string): number {
  return (RESOLUTION_RANK[a] ?? 99) - (RESOLUTION_RANK[b] ?? 99);
}
