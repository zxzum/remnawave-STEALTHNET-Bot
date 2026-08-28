import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

export const buttonVariants = cva(
  // press-анимация + focus-ring + фиксированный размер иконок внутри
  "relative inline-flex cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap font-bold transition-all duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400",
  {
    variants: {
      // primary/ghost/success опираются на существующие CSS-классы (light sweep, glow)
      variant: {
        primary: "btn-primary",
        secondary:
          "glass text-fog-100 hover:bg-white/8 hover:border-white/20",
        ghost: "btn-ghost",
        outline: "border border-white/14 bg-transparent text-fog-100 hover:bg-white/6",
        destructive: "border border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
        success: "btn-success",
        link: "text-fog-400 hover:text-fog-100",
      },
      size: {
        sm: "h-9 rounded-xl px-3 text-xs",
        md: "h-11 rounded-2xl px-4 text-sm",
        lg: "h-12 rounded-2xl px-5 text-sm",
        icon: "h-9 w-9 rounded-xl p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Спиннер внутри + блокировка повторных кликов */
  loading?: boolean;
  /** Текст на время загрузки (иначе остаётся children) */
  loadingText?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, loadingText, disabled, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" />}
      {loading && loadingText ? loadingText : children}
    </button>
  ),
);
Button.displayName = "Button";
