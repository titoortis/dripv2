"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";

type Item = {
  id: string;
  status: string;
  preset: { id: string; title: string; subtitle: string | null; aspectRatio: string };
  sourceImage: { id: string; publicUrl: string };
  resultVideo: { id: string; publicUrl: string; lastFrameUrl: string | null } | null;
  createdAt: string;
};

export default function HistoryPage() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((j: { jobs: Item[] }) => setItems(j.jobs))
      .catch(() => setItems([]));
  }, []);

  return (
    <AppShell>
      <div className="px-safe pb-safe pt-2">
        <h1 className="heading-display mb-3 text-[22px] tracking-tight text-ink-50">My videos</h1>

        {items === null ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[9/16] animate-pulse rounded-2xl bg-ink-800 ring-soft"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {items.map((j) => (
              <Link
                key={j.id}
                href={`/jobs/${j.id}`}
                className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-ink-800 ring-soft"
              >
                <Thumb item={j} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2.5">
                  <div className="text-[12px] font-semibold text-white">{j.preset.title}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-300">
                    {j.status}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Thumb({ item }: { item: Item }) {
  if (item.resultVideo?.publicUrl) {
    return (
      <video
        src={item.resultVideo.publicUrl}
        muted
        loop
        playsInline
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  if (item.sourceImage?.publicUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={item.sourceImage.publicUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover blur-[1px] scale-105 opacity-80"
      />
    );
  }
  return null;
}

function Empty() {
  return (
    <div className="rounded-3xl bg-ink-900 p-6 text-center ring-soft">
      <Chip>No videos yet</Chip>
      <p className="mt-3 text-[13px] text-ink-300">
        Upload a photo and pick a preset — your videos will appear here.
      </p>
      <div className="mt-5">
        <Link href="/create">
          <Button block size="lg">
            Create video
          </Button>
        </Link>
      </div>
    </div>
  );
}
