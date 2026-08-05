import {
  AlertCircle,
  CreditCard,
  Gift,
  MessagesSquare,
  Send,
  ShieldCheck,
  Ticket,
  User,
  UserPlus,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { fmtMsk } from "@/lib/datetime";
import type { TimelineEvent } from "@/lib/admin-extras-api";
import { cn } from "@/lib/utils";

const KIND_META: Record<TimelineEvent["kind"], { color: string; Icon: typeof User }> = {
  registered: { color: "text-emerald-500", Icon: UserPlus },
  payment_paid: { color: "text-emerald-500", Icon: CreditCard },
  payment_failed: { color: "text-rose-500", Icon: AlertCircle },
  payment_refunded: { color: "text-violet-500", Icon: CreditCard },
  broadcast: { color: "text-sky-500", Icon: Send },
  ticket_opened: { color: "text-amber-500", Icon: Ticket },
  ticket_message: { color: "text-amber-500", Icon: MessagesSquare },
  gift: { color: "text-pink-500", Icon: Gift },
  admin_action: { color: "text-foreground", Icon: ShieldCheck },
};

const STAT_LABELS: Record<string, string> = {
  totalPayments: "Платежей",
  paidPayments: "Оплачено",
  totalTickets: "Тикетов",
  totalBroadcasts: "Рассылок",
  totalAdminActions: "Действий админа",
};

export function ClientTimeline({
  events,
  stats,
  compact = false,
}: {
  events: TimelineEvent[];
  stats?: Record<string, number>;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-3">
      {stats && (
        <Card className="bg-background/60 border-white/10 rounded-2xl p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            {Object.entries(stats).map(([key, value]) => (
              <div key={key} className="rounded-xl border border-white/10 bg-foreground/[0.03] p-2 text-center">
                <div className="text-lg font-bold tabular-nums">{value}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{STAT_LABELS[key] ?? key}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="min-w-0 bg-background/60 border-white/10 rounded-2xl p-3 sm:p-4">
        <h3 className="mb-3 text-sm font-semibold">Timeline ({events.length})</h3>
        {events.length === 0 ? (
          <p className="py-6 text-center text-xs italic text-muted-foreground">Событий пока нет</p>
        ) : (
          <ol className={cn("relative ml-3 border-l-2 border-white/10", compact ? "space-y-2.5" : "space-y-3")}>
            {events.map((event, index) => {
              const meta = KIND_META[event.kind] ?? KIND_META.admin_action;
              const Icon = meta.Icon;
              return (
                <li key={`${event.ts}:${event.kind}:${index}`} className="min-w-0 pl-5">
                  <div className={cn("absolute -left-[11px] mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white/10 bg-background", meta.color)}>
                    <Icon className="h-3 w-3" />
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-muted-foreground">{fmtMsk(event.ts)}</div>
                  <div className="break-words text-sm font-medium text-foreground">{event.title}</div>
                  {event.detail && <div className="mt-0.5 break-words text-xs text-muted-foreground">{event.detail}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
