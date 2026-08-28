import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/** Плитка под иконку — база всех иконочных кружков кабинета */
export function IconTile({
  size = "md",
  tone = "default",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  size?: "sm" | "md" | "lg";
  tone?: "default" | "violet" | "mint" | "amber";
}) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center border",
        size === "sm" && "h-9 w-9 rounded-xl",
        size === "md" && "h-11 w-11 rounded-xl",
        size === "lg" && "h-12 w-12 rounded-2xl",
        tone === "default" && "icon-tile",
        tone === "violet" && "border-violet-glow/30 bg-violet-glow/12 text-violet-glow",
        tone === "mint" && "border-mint-400/25 bg-mint-500/12 text-mint-400",
        tone === "amber" && "border-amber-glow/30 bg-amber-glow/12 text-amber-glow",
        className,
      )}
      {...props}
    />
  );
}
