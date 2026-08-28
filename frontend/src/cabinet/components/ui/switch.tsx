import * as Radix from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";

export function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof Radix.Root>) {
  return (
    <Radix.Root
      className={cn(
        "relative h-7 w-12 shrink-0 cursor-pointer rounded-full border border-white/12 bg-white/8 transition-colors",
        "data-[state=checked]:border-violet-glow/60 data-[state=checked]:bg-violet-glow/70",
        className,
      )}
      {...props}
    >
      <Radix.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-6" />
    </Radix.Root>
  );
}
