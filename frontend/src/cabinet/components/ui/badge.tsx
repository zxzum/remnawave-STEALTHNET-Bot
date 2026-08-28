import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Badge({
  variant = "default",
  fluid,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "amber" | "mint" | "violet";
  fluid?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-bold tracking-wide",
        variant === "default" && "border border-white/10 bg-white/5 text-fog-300",
        variant === "amber" && "border border-amber-glow/30 bg-amber-glow/10 text-amber-glow",
        variant === "mint" && "border border-mint-400/30 bg-mint-500/10 text-mint-400",
        variant === "violet" && "border border-violet-glow/30 bg-violet-glow/12 text-violet-glow",
        fluid && "w-full min-w-0 justify-center whitespace-normal",
        className,
      )}
      {...props}
    />
  );
}
