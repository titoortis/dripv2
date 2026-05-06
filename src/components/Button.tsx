import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "md" | "lg";
  block?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", block, ...props },
  ref,
) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-tight transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";
  const sizes = {
    md: "px-5 py-3 text-[15px]",
    lg: "px-6 py-4 text-[17px]",
  } as const;
  const variants: Record<Variant, string> = {
    primary:
      "bg-accent text-accent-ink hover:bg-accent-hover ring-soft shadow-[0_8px_24px_rgba(214,242,74,0.18)]",
    secondary: "bg-ink-800 text-ink-100 hover:bg-ink-700 ring-soft",
    ghost: "bg-transparent text-ink-200 hover:bg-ink-800",
  };
  return (
    <button
      ref={ref}
      className={cn(base, sizes[size], variants[variant], block && "w-full", className)}
      {...props}
    />
  );
});
