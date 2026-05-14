import Link from "next/link";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  withHeader = true,
  className,
}: {
  children: ReactNode;
  withHeader?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative flex min-h-screen flex-col bg-ink-950", className)}>
      {withHeader ? <AppHeader /> : null}
      <main className="flex-1">{children}</main>
    </div>
  );
}

function AppHeader() {
  return (
    <header className="pt-safe">
      <div className="px-safe mx-auto flex w-full max-w-3xl items-center justify-between py-3 md:max-w-4xl md:py-5 lg:max-w-5xl">
        <Link href="/" className="flex items-center gap-2 md:gap-3">
          <Logo />
          <span className="heading-display text-[15px] tracking-tight text-ink-100 md:text-xl lg:text-2xl">
            drip
          </span>
        </Link>
        <Link
          href="/history"
          className="rounded-full bg-ink-800 px-3 py-1.5 text-xs font-medium text-ink-200 ring-soft hover:bg-ink-700 md:px-5 md:py-2.5 md:text-sm"
        >
          My videos
        </Link>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-accent text-accent-ink ring-soft md:h-10 md:w-10 md:rounded-2xl"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 md:h-6 md:w-6" fill="currentColor">
        <path d="M12 3.5c2.5 4 4.5 6.4 4.5 9.4a4.5 4.5 0 1 1-9 0c0-3 2-5.4 4.5-9.4Z" />
      </svg>
    </span>
  );
}
