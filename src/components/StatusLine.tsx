import { cn } from "@/lib/utils";

const ORDER = ["queued", "uploading", "submitted", "processing", "completed"] as const;
type Step = (typeof ORDER)[number];

const LABELS: Record<Step, string> = {
  queued: "Queued",
  uploading: "Preparing",
  submitted: "Submitted",
  processing: "Generating",
  completed: "Ready",
};

export function StatusLine({ status }: { status: string }) {
  if (status === "failed" || status === "expired" || status === "cancelled") {
    return <FailedLine status={status} />;
  }
  const idx = Math.max(0, ORDER.indexOf(status as Step));
  return (
    <ol className="flex items-center justify-between gap-1 text-[11px]">
      {ORDER.map((s, i) => {
        const reached = i <= idx;
        const active = i === idx && s !== "completed";
        return (
          <li key={s} className="flex flex-1 items-center gap-1">
            <span
              className={cn(
                "h-1.5 flex-1 rounded-full",
                reached ? "bg-accent" : "bg-ink-700",
                active && "animate-pulse-soft",
              )}
            />
            <span
              className={cn(
                "whitespace-nowrap font-medium",
                reached ? "text-ink-100" : "text-ink-400",
              )}
            >
              {LABELS[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FailedLine({ status }: { status: string }) {
  const label =
    status === "expired" ? "Timed out" : status === "cancelled" ? "Cancelled" : "Failed";
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="inline-block h-2 w-2 rounded-full bg-danger" />
      <span className="font-medium text-danger">{label}</span>
    </div>
  );
}
