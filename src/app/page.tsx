import Link from "next/link";
import { Button } from "@/components/Button";

const DEFAULT_HERO_VIDEO_URL =
  "https://res.cloudinary.com/dfonotyfb/video/upload/v1775585556/dds3_1_rqhg7x.mp4";

export default function Home() {
  const heroVideoUrl = process.env.NEXT_PUBLIC_HERO_VIDEO_URL ?? DEFAULT_HERO_VIDEO_URL;
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-black text-ink-50">
      <HeroBackdrop />
      <BackgroundVideo src={heroVideoUrl} />
      <Overlays />
      <TopBar />
      <Hero />
      <BottomMeta />
    </main>
  );
}

function HeroBackdrop() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 z-0"
      style={{
        background:
          "radial-gradient(70% 50% at 25% 30%, rgba(140,90,255,0.35) 0%, rgba(140,90,255,0) 60%), radial-gradient(60% 50% at 80% 70%, rgba(255,90,95,0.30) 0%, rgba(255,90,95,0) 60%), radial-gradient(80% 60% at 50% 50%, rgba(214,242,74,0.10) 0%, rgba(214,242,74,0) 60%), linear-gradient(180deg, #0A0A0B 0%, #050507 100%)",
      }}
    />
  );
}

function BackgroundVideo({ src }: { src: string }) {
  return (
    <video
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      aria-hidden
      className="absolute inset-0 z-0 h-full w-full object-cover"
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}

function Overlays() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 z-10 bg-gradient-to-b from-black/55 via-black/15 to-black"
      />
      <div
        aria-hidden
        className="absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 60%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 z-10 h-1/3 bg-gradient-to-t from-black to-transparent"
      />
    </>
  );
}

function TopBar() {
  return (
    <header className="pt-safe absolute inset-x-0 top-0 z-30">
      <div className="px-safe mx-auto flex max-w-7xl items-center justify-between py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="heading-display text-[16px] tracking-tight text-ink-50">drip</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/history"
            className="rounded-full bg-white/10 px-3.5 py-2 text-[13px] font-medium text-ink-100 backdrop-blur-md ring-soft hover:bg-white/15"
          >
            My videos
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-accent text-accent-ink ring-soft"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M12 3.5c2.5 4 4.5 6.4 4.5 9.4a4.5 4.5 0 1 1-9 0c0-3 2-5.4 4.5-9.4Z" />
      </svg>
    </span>
  );
}

function Hero() {
  return (
    <section className="pb-safe relative z-20 mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-end px-safe pb-12 pt-32 md:items-start md:justify-center md:pb-24 md:pt-32 lg:pb-28">
      <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent backdrop-blur-md ring-soft">
        <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_12px_rgba(214,242,74,0.9)]" />
        Seedance 2.0 · Cinematic VFX
      </span>

      <h1 className="heading-display mt-5 max-w-[18ch] text-[44px] leading-[0.95] tracking-ultratight text-ink-50 sm:text-[64px] md:mt-6 md:text-[96px] lg:text-[128px] xl:text-[152px]">
        Cinematic videos
        <br className="hidden sm:block" />
        <span className="bg-gradient-to-b from-ink-50 via-ink-100 to-ink-300 bg-clip-text text-transparent">
          {" "}from one photo.
        </span>
      </h1>

      <p className="mt-5 max-w-[42ch] text-[15px] leading-relaxed text-ink-200 md:mt-7 md:text-[17px] lg:max-w-[52ch] lg:text-[19px]">
        Upload one photo. Pick a trending VFX preset.
        We render a vertical short, in seconds, powered by BytePlus Seedance 2.0.
      </p>

      <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center md:mt-9">
        <Link href="/create" className="sm:w-auto">
          <Button block size="lg" className="sm:w-auto sm:px-8">
            Create video
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Button>
        </Link>
        <Link
          href="/history"
          className="inline-flex items-center justify-center rounded-full bg-white/10 px-6 py-4 text-[15px] font-semibold text-ink-100 backdrop-blur-md ring-soft hover:bg-white/15 sm:px-7"
        >
          My videos
        </Link>
      </div>
    </section>
  );
}

function BottomMeta() {
  return (
    <div className="pb-safe pointer-events-none absolute inset-x-0 bottom-0 z-20 hidden md:block">
      <div className="px-safe mx-auto flex max-w-7xl items-center justify-between pb-6 text-[12px] text-ink-300">
        <div className="flex items-center gap-2">
          <Chip>9:16</Chip>
          <Chip>5–10s</Chip>
          <Chip>720p · 1080p</Chip>
        </div>
        <div className="flex items-center gap-2 text-ink-400">
          <span className="h-px w-8 bg-ink-500/60" />
          Powered by BytePlus Seedance 2.0
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-100 backdrop-blur-md ring-soft">
      {children}
    </span>
  );
}
