"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        disableVerticalSwipes?: () => void;
        themeParams?: Record<string, string>;
        colorScheme?: "light" | "dark";
        viewportHeight?: number;
        initData?: string;
        platform?: string;
      };
    };
  }
}

/**
 * Bridges the page to Telegram WebApp when present. Outside Telegram this is
 * a noop, so the same UI also runs as a normal mobile web app.
 */
export function TelegramBoot() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      tg.disableVerticalSwipes?.();
      document.documentElement.setAttribute("data-telegram", "true");
      const t = tg.themeParams ?? {};
      // best-effort: feed Telegram theme into our css vars
      if (t.bg_color) document.documentElement.style.setProperty("--tg-bg", hexToRgb(t.bg_color));
      if (t.secondary_bg_color)
        document.documentElement.style.setProperty("--tg-surface", hexToRgb(t.secondary_bg_color));
      if (t.text_color) document.documentElement.style.setProperty("--tg-text", hexToRgb(t.text_color));
    } catch {
      /* ignore */
    }
  }, []);

  return null;
}

function hexToRgb(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return "10 10 11";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}
