import * as Radix from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

export function Checkbox({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Radix.Root>) {
  return (
    <Radix.Root
      className={cn(
        "grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-md border border-white/15 bg-white/5 transition-colors",
        "data-[state=checked]:border-violet-glow data-[state=checked]:bg-violet-glow data-[state=checked]:text-ink-950",
        className,
      )}
      {...props}
    >
      <Radix.Indicator>
        <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
      </Radix.Indicator>
    </Radix.Root>
  );
}
