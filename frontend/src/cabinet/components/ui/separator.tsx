import { cn } from "../../lib/cn";

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-white/8", className)} />;
}
