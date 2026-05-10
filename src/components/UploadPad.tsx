"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type UploadedSource = {
  id: string;
  publicUrl: string;
  mimeType: string;
  bytes: number;
};

export function UploadPad({
  value,
  onChange,
  disabled = false,
  disabledMessage,
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
    <div className="w-full">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          inputRef.current?.click();
        }}
        disabled={disabled}
        className={cn(
          "relative flex h-[180px] w-full items-center justify-center overflow-hidden rounded-2xl bg-ink-800 ring-soft sm:h-[220px]",
          !disabled && "transition hover:bg-ink-700",
          disabled && "cursor-not-allowed opacity-70",
          busy && "opacity-80",
        )}
        aria-label="Upload your photo"
      >
        {hasMedia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Your photo" className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-ink-300">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
            </svg>
            <div className="text-[12.5px] font-medium text-ink-200">Tap to upload your photo</div>
            <div className="text-[10.5px] text-ink-400">JPEG, PNG, or WebP · up to 12 MB</div>
          </div>
        )}

        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          </div>
        ) : null}
      </button>

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

      <div className="mt-2 flex items-center justify-between text-xs">
        {disabled ? (
          <span className="text-ink-400">
            {disabledMessage ?? "Photo upload is unavailable right now."}
          </span>
        ) : error ? (
          <span className="text-danger">{error}</span>
        ) : hasMedia ? (
          <button
            type="button"
            onClick={clear}
            className="text-ink-300 underline-offset-4 hover:text-ink-100"
          >
            Replace photo
          </button>
        ) : (
          <span className="text-ink-400">One clear, well-lit portrait works best.</span>
        )}
      </div>
    </div>
  );
}
