"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { isMarketingMode } from "@/components/ComingSoon";
import { PresetLauncher } from "@/components/PresetLauncher";
import { PresetPlaceholder, type PresetSummary } from "@/components/PresetCard";
import { getStaticPresetSummaries } from "@/lib/presets-static";

const HERO_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8.mp4";

export default function Home() {
  return (
    <main className="theme-landing min-h-screen overflow-x-hidden">
      <HeroSection />
      <FeaturedPresetSection />
      <TestimonialSection />
    </main>
  );
}

/* ------------------------------------------------------------------ Hero */

function HeroSection() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  const heroY = useTransform(scrollYProgress, [0, 1], [0, -200]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const dashboardY = useTransform(scrollYProgress, [0, 1], [0, -250]);

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen overflow-hidden pb-12 md:pb-16"
    >
      <Navbar />

      <motion.div
        style={{ y: heroY, opacity: heroOpacity }}
        className="relative z-10 mt-8 flex flex-col items-center px-4 text-center md:mt-10"
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0 }}
          className="liquid-glass mb-6 flex items-center gap-2 rounded-lg px-3 py-2"
        >
          <span className="rounded-md bg-white px-2 py-0.5 text-sm font-medium text-black">
            New
          </span>
          <span className="text-sm font-medium text-[hsl(0_0%_65%)]">
            Now powered by Seedance 2.0
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mb-3 text-5xl font-medium leading-tight tracking-[-2px] md:text-7xl md:leading-[1.15]"
        >
          Your Photo.
          <br />
          One <span className="font-serif font-normal italic">Cinematic</span> Short.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mb-5 text-lg font-normal leading-6 opacity-90"
          style={{ color: "hsl(var(--hero-subtitle))" }}
        >
          drip turns one photo into a vertical short with one tap.
          <br />
          No prompts. Just trending VFX presets.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex w-full flex-col items-center gap-3 px-2"
        >
          <Link
            href="/create"
            className="inline-flex items-center justify-center rounded-full bg-white px-7 py-3 text-base font-semibold text-black transition hover:opacity-90"
          >
            Pick a preset
            <svg
              viewBox="0 0 24 24"
              className="ml-2 h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
          <span className="text-[12px] text-[hsl(0_0%_55%)]">
            One photo. One tap. No prompts.
          </span>
        </motion.div>
      </motion.div>

      <DashboardArea dashboardY={dashboardY} />
    </section>
  );
}

function Navbar() {
  return (
    <nav className="relative z-20 flex items-center justify-between px-8 py-4 md:px-28">
      <div className="flex items-center gap-12 md:gap-20">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-xl font-bold tracking-tight">drip</span>
        </Link>
        <div className="hidden items-center gap-1 md:flex">
          <NavLink href="/">Home</NavLink>
          <NavLinkWithChevron href="/create">Presets</NavLinkWithChevron>
          <NavLink href="/history">Showcase</NavLink>
          <NavLink href="https://t.me/" external>
            Telegram
          </NavLink>
        </div>
      </div>
      <Link
        href="/history"
        className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
      >
        My videos
      </Link>
    </nav>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-white text-black"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M12 3.5c2.5 4 4.5 6.4 4.5 9.4a4.5 4.5 0 1 1-9 0c0-3 2-5.4 4.5-9.4Z" />
      </svg>
    </span>
  );
}

function NavLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-[hsl(0_0%_82%)] transition hover:text-white"
    >
      {children}
    </Link>
  );
}

function NavLinkWithChevron({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-[hsl(0_0%_82%)] transition hover:text-white"
    >
      {children}
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </Link>
  );
}

function DashboardArea({ dashboardY }: { dashboardY: MotionValue<number> }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.4 }}
      className="relative mt-6 md:mt-8"
      style={{
        width: "100vw",
        marginLeft: "calc(-50vw + 50%)",
        aspectRatio: "16 / 9",
      }}
    >
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden
        className="absolute inset-0 z-0 h-full w-full object-cover"
      >
        <source src={HERO_VIDEO_URL} type="video/mp4" />
      </video>

      <div className="absolute left-1/2 top-1/2 z-10 w-[90%] max-w-5xl -translate-x-1/2 -translate-y-1/2 mix-blend-luminosity">
        <motion.div style={{ y: dashboardY }}>
          <PresetDeckMock />
        </motion.div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-40 bg-gradient-to-t from-black to-transparent" />
    </motion.div>
  );
}

/* The "dashboard image" — adapted from the SaaS reference into a cinematic
 * preset-deck mock built in CSS so we don't need a static asset. With
 * mix-blend-mode: luminosity it tints to the background video underneath. */
function PresetDeckMock() {
  const cards: Array<{ name: string; bg: string }> = [
    {
      name: "Iron Hero",
      bg: "linear-gradient(180deg, #FFB74A 0%, #7B3F00 60%, #100B07 100%)",
    },
    {
      name: "Hyperspeed",
      bg: "linear-gradient(180deg, #9F6CFF 0%, #FF5A5F 60%, #10131C 100%)",
    },
    {
      name: "Wings",
      bg: "linear-gradient(180deg, #5CE7A0 0%, #1B9AAA 60%, #0B1414 100%)",
    },
    {
      name: "Earth Orbit",
      bg: "linear-gradient(180deg, #7B8CDE 0%, #3B0F2D 60%, #0E0F19 100%)",
    },
    {
      name: "Smoke Sprint",
      bg: "linear-gradient(180deg, #C8C8CF 0%, #3A3A45 60%, #0A0A0B 100%)",
    },
  ];
  return (
    <div className="rounded-2xl bg-[hsl(0_0%_5%)] p-5 ring-1 ring-white/10 shadow-[0_30px_120px_rgba(0,0,0,0.6)]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white text-[10px] font-bold text-black">
            d
          </span>
          <span className="text-sm font-semibold tracking-tight">drip · Pick a preset</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-white/50">
          <span>9:16</span>
          <span>·</span>
          <span>5s</span>
          <span>·</span>
          <span>720p</span>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {cards.map((c) => (
          <div
            key={c.name}
            className="relative aspect-[9/16] overflow-hidden rounded-xl ring-1 ring-white/10"
            style={{ background: c.bg }}
          >
            <div className="absolute inset-x-0 bottom-0 p-3">
              <div className="text-[11px] font-semibold tracking-tight text-white">
                {c.name}
              </div>
              <div className="text-[9px] uppercase tracking-[0.14em] text-white/60">
                VFX preset
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------- Featured preset */

/**
 * "First preset" surface on the homepage. Reads the first preset from the
 * static seed source-of-truth (`getStaticPresetSummaries`) so this section
 * renders identically on any deploy shape — in particular, marketing-mode
 * deploys without a provisioned Postgres, where `/api/presets` 500s on
 * Prisma init. The card is the single big interactive surface for the
 * featured preset; on desktop it scales subtly on hover, on mobile it is
 * tap-affordant (no hover dependency). Clicking opens the Higgs-style
 * `PresetLauncher` overlay over the homepage — we never navigate away.
 *
 * Marketing-mode fallback: if `NEXT_PUBLIC_LAUNCH_MODE=marketing`, the
 * card routes to `/create` instead of opening the launcher (because
 * `/api/jobs` + `/api/uploads` may not be wired in that deploy). `/create`
 * then short-circuits to `<ComingSoon />` — same UX path as the existing
 * "Pick a preset" CTA above.
 *
 * Data source contract: `getStaticPresetSummaries()` returns the same
 * `PresetSummary` shape `/api/presets` returns, derived from the same
 * `PRESETS` constant the seed reads. Live-mode `/create` still queries
 * the API for any user-customized rows; that path is unchanged.
 */
function FeaturedPresetSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const preset = useMemo<PresetSummary | null>(
    () => getStaticPresetSummaries()[0] ?? null,
    [],
  );

  function handleOpen() {
    if (isMarketingMode()) {
      router.push("/create");
      return;
    }
    setOpen(true);
  }

  return (
    <section className="px-6 pb-24 pt-8 md:px-28 md:pb-32">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[hsl(0_0%_60%)]">
            Featured preset
          </span>
          <h2 className="text-3xl font-medium leading-tight tracking-[-1px] md:text-5xl md:leading-[1.1]">
            Start with{" "}
            <span className="font-serif font-normal italic">Iron Hero</span>
          </h2>
          <p className="max-w-md text-[14px] leading-6 text-[hsl(0_0%_65%)]">
            Tap the card. Drop a portrait. We&rsquo;ll suit you up.
          </p>
        </div>

        {preset ? (
          <FeaturedPresetCard preset={preset} onOpen={handleOpen} />
        ) : (
          <div className="rounded-3xl border border-white/10 bg-black/40 px-6 py-8 text-sm text-[hsl(0_0%_65%)]">
            Presets are warming up. Try refreshing in a moment.
          </div>
        )}
      </div>

      <PresetLauncher open={open} preset={preset} onClose={() => setOpen(false)} />
    </section>
  );
}

function FeaturedPresetCard({
  preset,
  onOpen,
}: {
  preset: PresetSummary;
  onOpen: () => void;
}) {
  return (
    <div className="group relative w-full max-w-md">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${preset.title} launcher`}
        className="relative block aspect-[9/16] w-full overflow-hidden rounded-3xl bg-black ring-1 ring-white/10 transition duration-300 ease-out will-change-transform md:hover:-translate-y-1 md:hover:scale-[1.02] md:hover:ring-white/30 md:hover:shadow-[0_30px_120px_rgba(0,0,0,0.6)]"
      >
        {/* Visual */}
        {preset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preset.thumbnailUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out md:group-hover:scale-[1.04]"
          />
        ) : (
          <div className="absolute inset-0 transition-transform duration-500 ease-out md:group-hover:scale-[1.04]">
            <PresetPlaceholder seed={preset.id} />
          </div>
        )}

        {/* Bottom gradient + meta */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/60 to-transparent p-5 text-left">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
                Seedance 2.0
              </div>
              <div className="mt-1 truncate text-[20px] font-semibold leading-tight tracking-tight text-white">
                {preset.title}
              </div>
              {preset.subtitle ? (
                <div className="mt-0.5 truncate text-[12px] text-white/70">
                  {preset.subtitle}
                </div>
              ) : null}
            </div>
            <div className="shrink-0">
              <PlayBadge />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-white/70">
            <MetaPill>{preset.aspectRatio}</MetaPill>
            <MetaPill>{`${preset.durationSec}s`}</MetaPill>
            <MetaPill>{preset.resolution}</MetaPill>
            {preset.availableCombos[0] ? (
              <MetaPill>
                {`${preset.availableCombos[0].creditsCost} ${
                  preset.availableCombos[0].creditsCost === 1 ? "credit" : "credits"
                }`}
              </MetaPill>
            ) : null}
          </div>
        </div>

        {/* Top-right hint chip — visible always so the card looks tappable on mobile too */}
        <div className="pointer-events-none absolute right-4 top-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium text-white backdrop-blur transition group-hover:bg-white/25">
            Tap to launch
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </span>
        </div>
      </button>
    </div>
  );
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/85 ring-1 ring-white/10">
      {children}
    </span>
  );
}

function PlayBadge() {
  return (
    <span
      aria-hidden
      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-black ring-1 ring-white/30 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition group-hover:scale-105"
    >
      <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor">
        <path d="M8 5v14l11-7L8 5z" />
      </svg>
    </span>
  );
}

/* ----------------------------------------------------------- Testimonial */

const TESTIMONIAL_TEXT =
  "drip turned my lunch break into a viral 5-second short. I uploaded one photo, picked a preset, and shipped a video before my coffee was ready. This is what creator tools should feel like — pure execution, zero prompt-engineering tax.";

function TestimonialSection() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end center"],
  });

  const words = TESTIMONIAL_TEXT.split(" ");

  return (
    <section className="flex min-h-screen items-center px-8 py-24 md:px-28 md:py-32">
      <div
        ref={containerRef}
        className="mx-auto flex max-w-3xl flex-col items-start gap-10"
      >
        <QuoteSymbol />
        <p className="flex flex-wrap text-4xl font-medium leading-[1.2] md:text-5xl">
          {words.map((w, i) => (
            <Word
              key={`${w}-${i}`}
              word={w}
              index={i}
              total={words.length}
              progress={scrollYProgress}
            />
          ))}
          <span className="ml-2 text-[hsl(0_0%_65%)]">”</span>
        </p>
        <Author />
      </div>
    </section>
  );
}

function Word({
  word,
  index,
  total,
  progress,
}: {
  word: string;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const start = index / total;
  const end = (index + 1) / total;
  const opacity = useTransform(progress, [start, end], [0.2, 1]);
  const color = useTransform(
    progress,
    [start, end],
    ["hsl(0 0% 35%)", "hsl(0 0% 100%)"],
  );
  return (
    <motion.span style={{ opacity, color }} className="mr-[0.3em]">
      {word}
    </motion.span>
  );
}

function QuoteSymbol() {
  return (
    <svg
      viewBox="0 0 56 40"
      aria-hidden
      className="h-10 w-14 text-white"
      fill="currentColor"
    >
      <path d="M0 40V22.4C0 14.4 1.6 8.5 4.8 4.8 8 1.6 12 0 16.8 0v8.8c-2.4 0-4.4 0.8-6 2.4-1.6 1.6-2.4 3.7-2.4 6.4H16V40H0zm32 0V22.4c0-8 1.6-13.9 4.8-17.6C40 1.6 44 0 48.8 0v8.8c-2.4 0-4.4 0.8-6 2.4-1.6 1.6-2.4 3.7-2.4 6.4H48V40H32z" />
    </svg>
  );
}

function Author() {
  return (
    <div className="flex items-center gap-4">
      <Avatar />
      <div>
        <div className="text-base font-semibold leading-7 text-white">Nika Libman</div>
        <div className="text-sm font-normal leading-5 text-[hsl(0_0%_65%)]">
          Creator · 2.4M followers
        </div>
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <span
      aria-hidden
      className="relative h-14 w-14 overflow-hidden rounded-full border-[3px] border-white"
      style={{
        background:
          "radial-gradient(120% 90% at 30% 25%, #FFB74A 0%, transparent 55%), radial-gradient(120% 90% at 75% 75%, #9F6CFF 0%, transparent 50%), linear-gradient(180deg, #1B1B22 0%, #0A0A0B 100%)",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 70%, rgba(255,255,255,0.18) 0%, transparent 70%)",
        }}
      />
    </span>
  );
}
