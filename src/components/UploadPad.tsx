"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type UploadedSource = {
  id: string;
  publicUrl: string;
  mimeType: string;
  bytes: number;
};

/**
 * A single reference-photo slot.
 *
 * The component is used twice on `/create` (PR #24): a primary slot that talks
 * to `/api/uploads` and threads the resulting `sourceImageId` into the job
 * submit, and an optional secondary slot that is intentionally non-interactive
 * today. The secondary slot is rendered with `comingSoon={true}`: it shows the
 * "Soon" affordance and the same muted dashed-ring styling the marketing-mode
 * disable uses, but unlike `disabled` it explicitly performs **no upload,
 * no state mutation, no API call** — the design contract is that secondary
 * support arrives with the character system, and we surface that honestly
 * instead of collecting input that won't be used.
 *
 * Back-compat: every prop except `value` / `onChange` is optional, and the
 * defaults match the previous single-slot behavior so the component still
 * drops in for any caller that doesn't need the two-slot rhythm.
 */
export function UploadPad({
  value,
  onChange,
  disabled = false,
  disabledMessage,
  label,
  helperIdle,
  comingSoon = false,
  comingSoonMessage,
}: {
  value: UploadedSource | null;
  onChange: (next: UploadedSource | null) => void;
  /**
   * When true, the pad is non-interactive: clicks no-op, the file picker
   * cannot open, and `disabledMessage` (if provided) replaces the helper
   * line. Used by `/create` in marketing mode where `/api/uploads` isn't
   * provisioned, so we surface the unavailability honestly instead of
   * letting the user upload into a 500.
   */
  disabled?: boolean;
  disabledMessage?: string;
  /**
   * Small label pill rendered in the pad's upper-left. Used to disambiguate
   * the two slots ("Primary" vs "Optional"). Omit for the legacy single-slot
   * layout.
   */
  label?: string;
  /**
   * Helper line shown below the pad in idle state (no upload yet, not
   * disabled, not coming-soon). Falls back to the legacy "One clear, well-lit
   * portrait works best." line.
   */
  helperIdle?: string;
  /**
   * When true, the pad is rendered in the "arrives later" presentation:
   * muted dashed ring, "Soon" pill in the upper-right, no file input wired,
   * no `/api/uploads` call. This is **not** the same as `disabled`: a
   * coming-soon slot never accepts input regardless of mode (marketing or
   * live), and is explicitly not part of the submit payload. See PR #24.
   */
  comingSoon?: boolean;
  comingSoonMessage?: string;
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
  // `comingSoon` always wins over `disabled`: the slot is intentionally
  // non-interactive regardless of mode. The button still renders so the
  // product surface is visible.
  const interactive = !comingSoon && !disabled;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => {
          if (!interactive) return;
          inputRef.current?.click();
        }}
        disabled={!interactive}
        className={cn(
          "relative flex h-[160px] w-full items-center justify-center overflow-hidden rounded-2xl bg-ink-800 sm:h-[200px]",
          comingSoon
            ? "border border-dashed border-ink-600 opacity-70"
            : hasMedia
              ? "ring-2 ring-accent"
              : "ring-soft",
          interactive && "transition hover:bg-ink-700",
          disabled && !comingSoon && "cursor-not-allowed opacity-70",
          comingSoon && "cursor-not-allowed",
          busy && "opacity-80",
        )}
        aria-label={
          comingSoon
            ? "Optional secondary reference — arrives with character support"
            : "Upload your photo"
        }
        aria-disabled={!interactive}
      >
        {label ? (
          <span
            aria-hidden="true"
            className="absolute left-2 top-2 z-10 rounded-full bg-ink-700/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-200"
          >
            {label}
          </span>
        ) : null}
        {comingSoon ? (
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 z-10 rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-accent"
          >
            Soon
          </span>
        ) : null}

        {hasMedia && !comingSoon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Your photo" className="h-full w-full object-cover" />
        ) : comingSoon ? (
          <div className="flex flex-col items-center gap-1 px-3 text-center text-ink-400">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zm3 5h8m-8 4h8m-8 4h5" />
            </svg>
            <div className="text-[11px] font-medium text-ink-300">Optional secondary</div>
            <div className="text-[10px] leading-snug text-ink-500">Pet or style ref</div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-ink-300">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
            </svg>
            <div className="text-[12px] font-medium text-ink-200">Tap to upload</div>
            <div className="text-[10px] text-ink-400">JPEG, PNG, or WebP · up to 12 MB</div>
          </div>
        )}

        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          </div>
        ) : null}
      </button>

      {!comingSoon ? (
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      ) : null}

      <div className="mt-1.5 flex items-center justify-between text-[10.5px] leading-snug">
        {comingSoon ? (
          <span className="text-ink-500">
            {comingSoonMessage ?? "Arrives with character support."}
          </span>
        ) : disabled ? (
          <span className="text-ink-400">
            {disabledMessage ?? "Photo upload is unavailable right now."}
          </span>
        ) : error ? (
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
          <span className="text-ink-400">
            {helperIdle ?? "One clear, well-lit portrait works best."}
          </span>
        )}
      </div>
    </div>
  );
}
