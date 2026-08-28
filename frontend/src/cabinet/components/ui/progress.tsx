import { motion } from "framer-motion";
import { cn } from "../../lib/cn";

export function Progress({
  value,
  max = 100,
  tone = "default",
  className,
}: {
  value: number;
  max?: number;
  tone?: "default" | "amber";
  className?: string;
}) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-white/8 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]", className)}
    >
      <motion.div
        className={cn(
          "h-full rounded-full",
          tone === "default" && "bg-gradient-to-r from-accent-500 via-accent-400 to-mint-400 shadow-[0_0_12px_rgba(77,124,254,0.55)]",
          tone === "amber" && "bg-gradient-to-r from-amber-glow to-amber-500 shadow-[0_0_12px_rgba(255,181,69,0.5)]",
        )}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        // spring вместо линейного tween: заполнение доезжает без рывков при частых обновлениях
        transition={{ type: "spring", stiffness: 110, damping: 20, mass: 0.9 }}
      />
    </div>
  );
}
