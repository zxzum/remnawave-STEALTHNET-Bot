import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface OptionCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** Бейдж в правом верхнем углу, напр. «−33%» */
  badge?: ReactNode;
  glow?: "blue" | "violet";
}

/** Компактная карточка выбора (длительность, устройство, метод) */
export const OptionCard = forwardRef<HTMLButtonElement, OptionCardProps>(
  ({ selected, badge, glow = "blue", className, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        // живость: лёгкий подъём на hover (2px) и возврат в прижатое состояние на press
        "relative cursor-pointer rounded-2xl border p-3 text-center transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
        selected
          ? glow === "blue"
            ? "border-accent-400/60 bg-accent-500/15 shadow-neon-blue hover:border-accent-400 hover:bg-accent-500/20"
            : "border-violet-glow/60 bg-violet-glow/12 shadow-[0_0_24px_-6px_rgba(176,124,255,0.6)] hover:border-violet-glow hover:bg-violet-glow/16"
          : "border-white/8 bg-white/3 hover:border-white/20 hover:bg-white/6",
        className,
      )}
      {...props}
    >
      {badge != null && (
        <span className="absolute -top-2 right-2 rounded-full border border-mint-400/40 bg-ink-950 px-1.5 py-0.5 text-[10px] font-extrabold text-mint-400">
          {badge}
        </span>
      )}
      {children}
    </button>
  ),
);
OptionCard.displayName = "OptionCard";
