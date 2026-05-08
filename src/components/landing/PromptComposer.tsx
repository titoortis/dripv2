"use client";

import { useState } from "react";
import { motion } from "framer-motion";

type ApiResponse =
  | {
      provider: "openai" | "anthropic";
      analysis: string;
      prompt: string;
      settings: {
        aspect_ratio: "9:16" | "16:9" | "1:1" | "4:3" | "3:4";
        duration_seconds: number;
        shot_count: number;
        input_mode: "text-to-video" | "image-to-video" | "multi-image";
      };
    }
  | { error: string; message: string };

export function PromptComposer() {
  const [idea, setIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Extract<ApiResponse, { prompt: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setResult(null);
    setCopied(false);
    setLoading(true);
    try {
      const res = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !("prompt" in data)) {
        const msg =
          "message" in data && typeof data.message === "string"
            ? data.message
            : "Something went wrong.";
        setError(msg);
        return;
      }
      setResult(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Network error. Try again in a moment.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function onCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore — clipboard not available, user can select manually
    }
  }

  function onReset() {
    setResult(null);
    setError(null);
    setCopied(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.3 }}
      className="mx-auto w-full max-w-2xl"
    >
      {!result && (
        <form onSubmit={onSubmit} className="w-full">
          <div className="liquid-glass relative flex items-end gap-2 rounded-2xl px-3 py-2.5">
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              disabled={loading}
              rows={1}
              maxLength={2000}
              placeholder="Опиши идею ролика — соберу под Seedance 2."
              className="block max-h-[160px] min-h-[40px] w-full resize-none bg-transparent px-2 py-1.5 text-base leading-6 text-white placeholder:text-[hsl(0_0%_55%)] focus:outline-none disabled:opacity-60"
            />
            <motion.button
              type="submit"
              disabled={loading || idea.trim().length < 3}
              whileHover={!loading ? { scale: 1.02 } : undefined}
              whileTap={!loading ? { scale: 0.98 } : undefined}
              className="shrink-0 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition disabled:opacity-50"
            >
              {loading ? "…" : "Сделать промпт"}
            </motion.button>
          </div>
          {error && (
            <p className="mt-3 text-sm text-red-300/90" role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      {result && (
        <div className="rounded-2xl bg-[hsl(0_0%_5%)] p-5 ring-1 ring-white/10">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[hsl(0_0%_55%)]">
              Seedance prompt · {result.provider} · {result.settings.aspect_ratio} · {result.settings.duration_seconds}s · {result.settings.input_mode}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCopy}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition hover:opacity-90"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={onReset}
                className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-white/15"
              >
                New idea
              </button>
            </div>
          </div>
          <p className="mb-4 text-left text-[12px] leading-5 text-[hsl(0_0%_70%)]">
            {result.analysis}
          </p>
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-black/40 p-4 text-left text-[13px] leading-6 text-white ring-1 ring-white/5">
            {result.prompt}
          </pre>
        </div>
      )}
    </motion.div>
  );
}
