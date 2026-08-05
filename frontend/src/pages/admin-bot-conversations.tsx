/**
 * Bot conversation viewer (pragmatic).
 *
 * Слева — список клиентов с TG-аккаунтами + поиск. Справа — timeline
 * взаимодействий (регистрация, оплаты, рассылки, тикеты, gift, admin actions).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  MessageSquare, Loader2, Search, RefreshCw, User, Send, CreditCard,
  Ticket, AlertCircle, Mail,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { botConversationsApi, type BotConversationListItem, type TimelineEvent } from "@/lib/admin-extras-api";
import { ClientTimeline } from "@/components/admin/client-timeline";

export function AdminBotConversationsPage() {
  const { state } = useAuth();
  const [items, setItems] = useState<BotConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ client: Record<string, unknown>; events: TimelineEvent[]; stats: Record<string, number> } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  const load = useCallback(async () => {
    if (!state.accessToken) return;
    const requestId = ++listRequest.current;
    setLoading(true);
    setErr(null);
    try {
      const r = await botConversationsApi.list(state.accessToken, { q: search, limit: 100 });
      if (requestId === listRequest.current) setItems(Array.isArray(r?.items) ? r.items : []);
    } catch (e) {
      if (requestId === listRequest.current) setErr(e instanceof Error ? e.message : "load error");
    } finally {
      if (requestId === listRequest.current) setLoading(false);
    }
  }, [state.accessToken, search]);

  useEffect(() => { load(); }, [load]);

  async function selectClient(id: string) {
    if (!state.accessToken) return;
    const requestId = ++detailRequest.current;
    setActiveId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const r = await botConversationsApi.detail(state.accessToken, id);
      if (requestId === detailRequest.current) setDetail(r);
    } catch (e) {
      if (requestId === detailRequest.current) setErr(e instanceof Error ? e.message : "detail error");
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  }

  return (
    <div className="w-full space-y-4 px-4 sm:px-6 md:px-8 pt-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-violet-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">Активность клиентов</h1>
            <p className="text-sm text-muted-foreground mt-1">Timeline всех событий по клиенту: оплаты, рассылки, тикеты, действия админа</p>
          </div>
        </div>
      </div>

      {err && (
        <Card className="p-3 bg-rose-500/10 border-rose-500/30 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
          <p className="text-xs text-rose-500">{err}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* LEFT: list */}
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-3 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] overflow-y-auto">
          <div className="flex items-center gap-1 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput.trim()); }}
                placeholder="@username, TG id, email"
                className="pl-9 h-9 text-xs"
              />
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSearch(searchInput.trim())} className="h-9 px-2"><Search className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={() => load()} className="h-9 px-2"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></Button>
          </div>

          {loading && items.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-4">{search ? "Ничего не найдено" : "Нет клиентов"}</p>
          ) : (
            <div className="space-y-1.5">
              {items.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectClient(c.id)}
                  className={cn(
                    "w-full text-left rounded-xl p-2.5 transition",
                    c.id === activeId
                      ? "bg-primary/15 border border-primary/30"
                      : "hover:bg-foreground/[0.04] border border-transparent",
                    c.isBlocked && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center text-[10px] shrink-0",
                      c.isBlocked ? "bg-rose-500/15 text-rose-500" : "bg-primary/10 text-primary",
                    )}>
                      <User className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 text-xs">
                        <span className="font-medium truncate">
                          {c.telegramUsername ? `@${c.telegramUsername}` : c.email ?? c.telegramId ?? c.id.slice(0, 10)}
                        </span>
                        {c.telegramUnreachable && <Mail className="h-3 w-3 text-amber-500" />}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-2.5 mt-0.5">
                        <span title="Платежей" className="inline-flex items-center gap-1"><CreditCard className="h-3 w-3" />{c.counts.payments}</span>
                        <span title="Тикетов" className="inline-flex items-center gap-1"><Ticket className="h-3 w-3" />{c.counts.tickets}</span>
                        <span title="Рассылок" className="inline-flex items-center gap-1"><Send className="h-3 w-3" />{c.counts.broadcasts}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* RIGHT: timeline */}
        {!activeId ? (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-12 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Выберите клиента слева чтобы увидеть его активность</p>
          </Card>
        ) : detailLoading ? (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-12 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </Card>
        ) : detail ? (
          <div className="space-y-3">
            <ClientTimeline events={detail.events} stats={detail.stats} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
