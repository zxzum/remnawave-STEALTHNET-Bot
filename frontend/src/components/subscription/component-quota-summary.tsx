import type { ComponentQuota } from "@/lib/api";
import { cn } from "@/lib/utils";

function bytes(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatGb(value: number): string {
  return `${(value / (1024 ** 3)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ГБ`;
}

export function ComponentQuotaSummary({ quotas, stealth = false }: { quotas: ComponentQuota[]; stealth?: boolean }) {
  if (!quotas.length) return null;
  return (
    <div className="space-y-2">
      {quotas.map((quota) => {
        const limit = bytes(quota.limitBytes);
        const used = Math.min(limit, bytes(quota.usedBytes));
        const remaining = bytes(quota.remainingBytes);
        const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
        return (
          <div key={quota.key} className={cn(
            "rounded-2xl border p-3.5",
            stealth ? "border-white/[0.08] bg-zinc-900/60" : "border-slate-200/60 bg-white/50 dark:border-white/10 dark:bg-white/[0.03]",
          )}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold">{quota.displayName}</span>
              <span className={cn("text-xs", remaining === 0 ? "text-amber-500" : stealth ? "text-zinc-300" : "text-muted-foreground")}>
                Осталось {formatGb(remaining)}
              </span>
            </div>
            <div className={cn("mt-2 h-1.5 overflow-hidden rounded-full", stealth ? "bg-white/10" : "bg-slate-200 dark:bg-white/10")}>
              <div className={cn("h-full rounded-full", remaining === 0 ? "bg-amber-500" : stealth ? "bg-saccent-500" : "bg-primary")} style={{ width: `${percent}%` }} />
            </div>
            <div className={cn("mt-2 flex flex-wrap justify-between gap-2 text-[11px]", stealth ? "text-zinc-500" : "text-muted-foreground")}>
              <span>Использовано {formatGb(used)} из {formatGb(limit)}</span>
              {quota.nextResetAt && <span>Сброс {new Date(quota.nextResetAt).toLocaleDateString("ru-RU")}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
