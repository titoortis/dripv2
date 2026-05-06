import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";

export default function Home() {
  return (
    <AppShell>
      <section className="px-safe pb-safe relative flex min-h-[calc(100svh-64px)] flex-col">
        <Hero />
        <div className="mt-auto pb-6 pt-8">
          <Link href="/create">
            <Button block size="lg">
              Create video
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </Button>
          </Link>
          <p className="mt-3 text-center text-[12px] text-ink-400">
            Upload a photo. Pick a preset. Get a video.
          </p>
        </div>
      </section>
    </AppShell>
  );
}

function Hero() {
  return (
    <div className="relative flex flex-1 flex-col items-stretch pt-6">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 18%, rgba(214,242,74,0.18) 0%, rgba(214,242,74,0.0) 60%), radial-gradient(80% 60% at 50% 90%, rgba(140,90,255,0.18) 0%, rgba(140,90,255,0.0) 60%)",
          }}
        />
      </div>

      <div className="flex-1">
        <div className="rounded-3xl bg-ink-900/60 p-5 ring-soft">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
            Seedance 2.0
          </div>
          <h1 className="mt-2 heading-display text-[34px] leading-[1.05] tracking-ultratight text-ink-50">
            Cinematic videos
            <br />
            from one photo.
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-300">
            Tap a trending VFX preset. We do the rest. Vertical, fast, made for your phone.
          </p>
        </div>

        <PreviewGrid />
      </div>
    </div>
  );
}

function PreviewGrid() {
  const tiles = ["iron_hero_v1", "hyperspeed_tunnel_v1", "wings_v1", "earth_orbit_v1"];
  return (
    <div className="mt-5 grid grid-cols-2 gap-3">
      {tiles.map((id) => (
        <div
          key={id}
          aria-hidden
          className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-ink-800 ring-soft"
        >
          <Tile seed={id} />
        </div>
      ))}
    </div>
  );
}

function Tile({ seed }: { seed: string }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const palettes: [string, string, string, string][] = [
    ["#7B8CDE", "#3B0F2D", "#0E0F19", "#0A0B16"],
    ["#9F6CFF", "#FF5A5F", "#10131C", "#070A12"],
    ["#5CE7A0", "#1B9AAA", "#0B1414", "#06090A"],
    ["#FFB74A", "#7B3F00", "#100B07", "#070504"],
  ];
  const p = palettes[h % palettes.length];
  return (
    <div
      className="absolute inset-0"
      style={{
        background: `radial-gradient(120% 90% at 30% 20%, ${p[0]} 0%, transparent 60%),
                     radial-gradient(120% 90% at 80% 70%, ${p[1]} 0%, transparent 55%),
                     linear-gradient(180deg, ${p[2]} 0%, ${p[3]} 100%)`,
      }}
    />
  );
}
