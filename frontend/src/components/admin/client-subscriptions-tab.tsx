/**
 * T-subscription-remna (14.05.2026)
 *
 * Содержимое вкладки «Подписки» в карточке клиента. Грузит список ВСЕХ подписок
 * клиента (primary + secondary) через GET /admin/clients/:id/subscriptions
 * и для каждой подписки рисует раскрывающийся блок с <SubscriptionRemnaPanel>.
 *
 * Каждая подписка управляется независимо — лимиты, сквады, действия — всё
 * per-subscription.
 */
import { useState, useEffect, useCallback } from "react";
import { api, type AdminClientSubscriptionItem, type TariffRecord } from "@/lib/api";
import { SubscriptionRemnaPanel } from "./subscription-remna-panel";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { fmtMsk, fmtMskDate } from "@/lib/datetime";

interface Props {
  clientId: string;
  token: string;
  tariffs?: TariffRecord[];
  refreshKey?: number;
  onChanged?: () => void;
}

export function ClientSubscriptionsTab({ clientId, token, tariffs = [], refreshKey = 0, onChanged }: Props) {
  const [items, setItems] = useState<AdminClientSubscriptionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [remnaSquads, setRemnaSquads] = useState<{ uuid: string; name?: string }[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getClientSubscriptionsList(token, clientId);
      setItems(res.items);
      setExpanded((current) => {
        const ids = new Set(res.items.map((item) => item.id));
        const kept = new Set([...current].filter((id) => ids.has(id)));
        const primary = res.items.find((item) => item.isPrimary);
        return kept.size > 0 || !primary ? kept : new Set([primary.id]);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки подписок");
    } finally {
      setLoading(false);
    }
  }, [clientId, token]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  useEffect(() => {
    // Грузим сквады один раз для всех подписок (один и тот же набор).
    api
      .getRemnaSquadsInternal(token)
      .then((raw: unknown) => {
        const res = raw as { response?: { internalSquads?: { uuid: string; name?: string }[] } };
        const arr = res?.response?.internalSquads ?? (Array.isArray(raw) ? (raw as { uuid: string; name?: string }[]) : []);
        setRemnaSquads(Array.isArray(arr) ? arr : []);
      })
      .catch(() => setRemnaSquads([]));
  }, [token]);

  function toggle(subId: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(subId)) n.delete(subId);
      else n.add(subId);
      return n;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка подписок…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/[0.06] p-4 text-sm text-destructive">
        ⚠️ {error}
        <Button size="sm" variant="ghost" className="ml-2" onClick={reload}>
          Повторить
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        У клиента нет подписок.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((sub) => {
        const isOpen = expanded.has(sub.id);
        return (
          <div
            key={sub.id}
            className="rounded-2xl border border-white/10 bg-foreground/[0.02] dark:bg-white/[0.02] overflow-hidden"
          >
            <button
              onClick={() => toggle(sub.id)}
              className="flex w-full flex-col items-start justify-between gap-2 px-3 py-3 text-left transition-colors hover:bg-white/[0.04] sm:flex-row sm:items-center sm:px-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={
                      sub.isPrimary
                        ? "inline-flex items-center rounded-full bg-primary/10 border border-primary/30 px-2 py-0.5 text-[11px] font-semibold text-primary"
                        : "inline-flex items-center rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                    }
                  >
                    {sub.isPrimary ? "Главная" : `#${sub.subscriptionIndex}`}
                  </span>
                  <span className="text-sm font-medium truncate">
                  {sub.tariffName ?? "— без тарифа —"}
                </span>
                  {sub.isTrial && <span className="text-[11px] text-violet-400">trial</span>}
                  {sub.giftStatus && (
                    <span className="text-[11px] text-amber-400">🎁 {sub.giftStatus}</span>
                  )}
                  {sub.autoRenewEnabled && (
                    <span className="text-[11px] text-green-400">🔄 auto-renew</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 pl-7 text-xs text-muted-foreground sm:shrink-0 sm:pl-0">
                {sub.expireAt && (
                  <span title={`Истекает: ${fmtMsk(sub.expireAt)}`}>
                    до {fmtMskDate(sub.expireAt)}
                  </span>
                )}
                {!sub.remnawaveUuid && (
                  <span className="text-yellow-400" title="Подписка не привязана к Remna">
                    ⚠️ нет Remna
                  </span>
                )}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-white/5 p-4 bg-background/40">
                <SubscriptionRemnaPanel
                  subscription={sub}
                  token={token}
                  remnaSquads={remnaSquads}
                  tariffs={tariffs}
              onChanged={() => {
                onChanged?.();
              }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
