import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Chip({
  children,
  icon,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-200 ring-soft",
        className,
      )}
    >
      {icon ? <span className="text-ink-300">{icon}</span> : null}
      {children}
    </span>
  );
}
