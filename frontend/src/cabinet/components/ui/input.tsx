import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const controlBase = "input-glass";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input ref={ref} className={cn(controlBase, invalid && "border-red-400/50 focus:shadow-[0_0_0_3px_rgba(248,113,113,0.18)]", className)} {...props} />
  ),
);
Input.displayName = "Input";

/** Нативный select в стилистике Input (стрелку браузера не скрываем) */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <select ref={ref} className={cn(controlBase, invalid && "border-red-400/50", className)} {...props} />
  ),
);
Select.displayName = "Select";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <textarea ref={ref} className={cn(controlBase, "min-h-20 resize-none", invalid && "border-red-400/50", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

/** Label + контрол + текст ошибки */
export function Field({
  label,
  error,
  className,
  children,
}: {
  label?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-2 block text-sm font-bold">{label}</span>}
      {children}
      {error && <span className="mt-2 block text-sm text-red-400">{error}</span>}
    </label>
  );
}
