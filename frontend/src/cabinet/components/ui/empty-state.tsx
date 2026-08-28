import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { IconTile } from "./icon-tile";

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
      <IconTile size="lg" className="h-16 w-16 rounded-2xl">
        <Icon className="h-7 w-7" />
      </IconTile>
      <h2 className="mt-5 text-xl font-extrabold">{title}</h2>
      {description && <p className="mt-2 max-w-sm text-sm leading-relaxed text-fog-500">{description}</p>}
      {children && <div className="mt-5 flex flex-col items-center gap-2">{children}</div>}
    </div>
  );
}
