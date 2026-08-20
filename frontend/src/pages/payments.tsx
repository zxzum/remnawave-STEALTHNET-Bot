import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { api, type PaymentLogItem, type PaymentLogDetail, type PaymentsLogResponse } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/glass-select";
import { toast } from "@/components/ui/toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard, Search, RefreshCw, X, ChevronDown, Copy, Check,
  Filter, User, Package, Hash, CalendarDays, DollarSign, Globe, Smartphone, Bot, CircleCheck, CircleX, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMskShort } from "@/lib/datetime";

function fmtDate(s: string | null) {
  if (!s) return "—";
  try {
    return fmtMskShort(s);
  } catch {
    return s;
  }
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
}

const PROVIDERS: { value: string; label: string }[] = [
  { value: "", label: "Все провайдеры" },
  { value: "platega", label: "Platega" },
  { value: "yookassa", label: "ЮKassa" },
  { value: "yoomoney", label: "ЮMoney" },
  { value: "heleket", label: "Heleket" },
  { value: "cryptopay", label: "CryptoPay" },
  { value: "lava", label: "Lava" },
  { value: "lavatop", label: "LavaTop" },
  { value: "overpay", label: "Overpay" },
  { value: "balance", label: "Баланс" },
];

const STATUSES: { value: string; label: string }[] = [
  { value: "", label: "Все статусы" },
  { value: "PAID", label: "Подтверждён" },
  { value: "PENDING", label: "Ожидание" },
  { value: "CANCELED", label: "Отменён" },
  { value: "FAILED", label: "Ошибка" },
  { value: "REFUNDED", label: "Возврат" },
];

const SOURCES: { value: string; label: string }[] = [
  { value: "", label: "Все источники" },
  { value: "site", label: "Сайт" },
  { value: "miniapp", label: "Mini-App" },
  { value: "bot", label: "Бот" },
];

function providerLabel(p: string | null) {
  if (!p) return "—";
  const found = PROVIDERS.find((x) => x.value === p);
  if (found && found.value) return found.label;
  if (p === "yoomoney_form") return "ЮMoney";
  return p;
}

function statusBadge(status: string) {
  if (status === "PAID") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/30">
        Подтверждён <CircleCheck className="h-3 w-3" />
      </span>
    );
  }
  if (status === "CANCELED" || status === "FAILED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/30">
        {status === "FAILED" ? "Ошибка" : "Отменён"} <CircleX className="h-3 w-3" />
      </span>
    );
  }
  if (status === "REFUNDED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border bg-violet-500/15 text-violet-500 dark:text-violet-400 border-violet-500/30">
        Возврат
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
      {status === "PENDING" ? "Ожидание" : status} <Clock className="h-3 w-3" />
    </span>
  );
}

function callbackBadge(cb: PaymentLogItem["callback"]) {
  if (cb.status === "success") {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/30">
        Callback успешен
      </span>
    );
  }
  if (cb.status === "failed") {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/30">
        Callback неуспешен
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-white/10">
      Callback не приходил
    </span>
  );
}

function sourceBadge(source: PaymentLogItem["source"]) {
  if (!source) return <span className="text-muted-foreground text-xs">—</span>;
  const map = {
    site: { label: "Сайт", icon: Globe, cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30" },
    miniapp: { label: "Mini-App", icon: Smartphone, cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30" },
    bot: { label: "Бот", icon: Bot, cls: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30" },
  } as const;
  const m = map[source];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border", m.cls)}>
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

function clientDisplay(item: PaymentLogItem): string {
  const c = item.client;
  if (!c) return item.kind === "external" ? "Внешняя (Platega)" : "—";
  if (c.username) return `@${c.username}`;
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (c.telegramId != null) return `TG: ${c.telegramId}`;
  return c.id;
}

function clientSearchQuery(item: PaymentLogItem): string {
  const c = item.client!;
  if (c.username) return c.username;
  if (c.telegramId != null) return String(c.telegramId);
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.id;
}

const initialPageSize = (() => {
  if (typeof window === "undefined") return 20;
  const v = parseInt(new URLSearchParams(window.location.search).get("pageSize") ?? "", 10);
  return [10, 20, 50, 100].includes(v) ? v : 20;
})();

export function PaymentsPage() {
  const { state } = useAuth();
  const token = state.accessToken!;
  const [data, setData] = useState<PaymentsLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [filterProvider, setFilterProvider] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterMethod, setFilterMethod] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, PaymentLogDetail | null>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadRequest = useRef(0);

  // Дебаунс поиска 400мс — как на странице клиентов.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchApplied(search);
      setPage(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    query.set("pageSize", String(pageSize));
    window.history.replaceState(null, "", `${window.location.pathname}?${query.toString()}`);
  }, [pageSize]);

  const load = useCallback(async (silent = false) => {
    const requestId = ++loadRequest.current;
    if (!silent) setLoading(true);
    try {
      const res = await api.getPaymentsLog(token, page, pageSize, {
        search: searchApplied || undefined,
        provider: filterProvider || undefined,
        status: filterStatus || undefined,
        source: filterSource || undefined,
        method: filterMethod || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
      });
      if (requestId !== loadRequest.current) return;
      setData(res);
    } catch (e) {
      if (requestId === loadRequest.current && !silent) {
        toast.error("Не удалось загрузить платежи", e instanceof Error ? e.message : undefined);
      }
    } finally {
      if (requestId === loadRequest.current) setLoading(false);
    }
  }, [token, page, pageSize, searchApplied, filterProvider, filterStatus, filterSource, filterMethod, dateFrom, dateTo]);

  useEffect(() => { void load(); }, [load]);

  async function toggleExpand(item: PaymentLogItem) {
    const key = `${item.kind}:${item.id}`;
    if (expandedId === key) {
      setExpandedId(null);
      return;
    }
    setExpandedId(key);
    if (details[key] !== undefined) return;
    try {
      const d = await api.getPaymentsLogItem(token, item.id, item.kind);
      setDetails((prev) => ({ ...prev, [key]: d }));
    } catch {
      setDetails((prev) => ({ ...prev, [key]: null }));
    }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(key);
    window.setTimeout(() => setCopiedId((cur) => (cur === key ? null : cur)), 2000);
  }

  async function syncPlatega() {
    setSyncing(true);
    try {
      const r = await api.syncPlategaPayments(token);
      toast.success(
        "Platega синхронизирован",
        `Получено: ${r.fetched} · создано: ${r.created} · обновлено: ${r.updated} · сопоставлено: ${r.matched}`
      );
      void load(true);
    } catch (e) {
      toast.error("Ошибка синхронизации Platega", e instanceof Error ? e.message : undefined);
    } finally {
      setSyncing(false);
    }
  }

  const hasFilters = Boolean(searchApplied || filterProvider || filterStatus || filterSource || filterMethod || dateFrom || dateTo);
  const activeFiltersCount = [filterProvider, filterStatus, filterSource, filterMethod, dateFrom, dateTo].filter(Boolean).length;

  function clearFilters() {
    setSearch("");
    setSearchApplied("");
    setFilterProvider("");
    setFilterStatus("");
    setFilterSource("");
    setFilterMethod("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  function pageNumbers(): (number | "…")[] {
    if (totalPages <= 9) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const set = new Set<number>([1, 2, page - 1, page, page + 1, totalPages - 1, totalPages].filter((p) => p >= 1 && p <= totalPages));
    const nums = Array.from(set).sort((a, b) => a - b);
    const out: (number | "…")[] = [];
    for (let i = 0; i < nums.length; i++) {
      if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("…");
      out.push(nums[i]);
    }
    return out;
  }

  return (
    <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-purple-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <CreditCard className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Платежи
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Журнал всех платежей и транзакций Platega</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5 rounded-xl">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span className="hidden sm:inline">Обновить</span>
          </Button>
          <Button variant="outline" size="sm" onClick={syncPlatega} disabled={syncing} className="gap-1.5 rounded-xl">
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            <span className="hidden sm:inline">Синхронизировать Platega</span>
            <span className="sm:hidden">Platega sync</span>
          </Button>
        </div>
      </motion.div>

      {/* Aggregates */}
      {data && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -2 }}>
            <Card className="relative overflow-hidden bg-gradient-to-br from-primary/15 to-primary/5 border border-white/10 rounded-2xl p-4 shadow-lg h-full">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 shrink-0 rounded-xl bg-background/40 backdrop-blur-md border border-white/10 flex items-center justify-center">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">Итого по валютам</p>
                  <div className="flex flex-wrap gap-x-2 mt-0.5">
                    {data.aggregates.byCurrency.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                    {data.aggregates.byCurrency.map((c) => (
                      <span key={c.currency} className="text-sm font-bold tabular-nums">
                        {fmtMoney(c.amount)} <span className="text-[10px] font-normal text-muted-foreground">{c.currency}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} whileHover={{ y: -2 }}>
            <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border border-white/10 rounded-2xl p-4 shadow-lg h-full">
              <p className="text-[11px] text-muted-foreground mb-2">По статусам</p>
              <div className="flex flex-wrap gap-1.5">
                {data.aggregates.byStatus.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                {data.aggregates.byStatus.map((s) => (
                  <span key={s.status} className="inline-flex items-center gap-1">
                    {statusBadge(s.status)}
                    <span className="text-[10px] text-muted-foreground">×{s.count}</span>
                  </span>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>
      )}

      {/* Toolbar */}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-4 shadow-xl space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Заказ, клиент, Telegram, ID транзакции…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
            />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">Найдено записей: <span className="font-semibold text-foreground">{data?.total ?? 0}</span></span>
            <Button
              variant="outline" size="sm"
              onClick={() => setFiltersOpen((v) => !v)}
              className={cn("gap-1.5 rounded-xl", filtersOpen && "border-primary/40 text-primary")}
            >
              <Filter className="h-3.5 w-3.5" />
              Фильтры
              {activeFiltersCount > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {activeFiltersCount}
                </span>
              )}
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", filtersOpen && "rotate-180")} />
            </Button>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 gap-1 text-xs text-muted-foreground rounded-lg">
                <X className="h-3 w-3" /> Сбросить
              </Button>
            )}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {filtersOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-white/5">
                <div className="w-40">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Провайдер</p>
                  <GlassSelect value={filterProvider} onChange={(v) => { setFilterProvider(v); setPage(1); }} options={PROVIDERS} />
                </div>
                <div className="w-40">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Статус</p>
                  <GlassSelect value={filterStatus} onChange={(v) => { setFilterStatus(v); setPage(1); }} options={STATUSES} />
                </div>
                <div className="w-40">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Источник</p>
                  <GlassSelect value={filterSource} onChange={(v) => { setFilterSource(v); setPage(1); }} options={SOURCES} />
                </div>
                <div className="w-40">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Метод</p>
                  <Input
                    placeholder="Карта, СБП…"
                    value={filterMethod}
                    onChange={(e) => { setFilterMethod(e.target.value); setPage(1); }}
                    className="h-9 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10"
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">С даты</p>
                  <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-9 w-[140px] text-xs rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">По дату</p>
                  <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-9 w-[140px] text-xs rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Table */}
      {loading && !data ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-16 shadow-xl flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-primary/60" />
        </Card>
      ) : !data?.items.length ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-16 shadow-xl flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
            <CreditCard className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">Платежи не найдены</p>
          {hasFilters && (
            <Button variant="link" size="sm" className="mt-2 text-primary" onClick={clearFilters}>
              Сбросить фильтры
            </Button>
          )}
        </Card>
      ) : (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Дата и время</th>
                  <th className="px-4 py-3 font-medium">Клиент</th>
                  <th className="px-4 py-3 font-medium">Метод</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Callback</th>
                  <th className="px-4 py-3 font-medium">Источник</th>
                  <th className="px-4 py-3 font-medium text-right">Сумма</th>
                  <th className="px-4 py-3 font-medium">Валюта</th>
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-2 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const key = `${item.kind}:${item.id}`;
                  const expanded = expandedId === key;
                  const detail = details[key];
                  const displayId = item.externalId ?? item.orderId ?? item.id;
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={() => void toggleExpand(item)}
                        className={cn(
                          "border-b border-white/5 cursor-pointer transition-colors hover:bg-white/[0.04]",
                          expanded && "bg-white/[0.04]"
                        )}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDate(item.paidAt ?? item.createdAt)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <User className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className={cn("text-xs font-medium", !item.client && item.kind === "external" && "text-muted-foreground italic")}>
                              {clientDisplay(item)}
                            </span>
                          </div>
                          {item.client?.telegramId != null && (
                            <span className="text-[10px] text-muted-foreground ml-4">ID: {String(item.client.telegramId)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs">
                          {item.method ?? providerLabel(item.provider)}
                          {item.provider && item.method && (
                            <span className="text-[10px] text-muted-foreground ml-1">· {providerLabel(item.provider)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{statusBadge(item.status)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{callbackBadge(item.callback)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{item.kind === "external" ? <span className="text-muted-foreground text-xs">—</span> : sourceBadge(item.source)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-right font-bold tabular-nums">{fmtMoney(item.amount)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{item.currency}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); copyText(displayId, key); }}
                            className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            title="Скопировать ID"
                          >
                            <span className="max-w-[110px] truncate">{displayId}</span>
                            {copiedId === key ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </td>
                        <td className="px-2 py-3">
                          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-white/5 bg-white/[0.02]">
                          <td colSpan={10} className="px-6 py-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-1.5 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground w-28 shrink-0">Order ID:</span>
                                  <span className="font-mono select-all">{item.orderId ?? "—"}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground w-28 shrink-0">External ID:</span>
                                  <span className="font-mono select-all">{item.externalId ?? "—"}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground w-28 shrink-0">Продукт:</span>
                                  <span className="inline-flex items-center gap-1"><Package className="h-3 w-3" /> {item.product || "—"}</span>
                                </div>
                                {item.description && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground w-28 shrink-0">Описание:</span>
                                    <span>{item.description}</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground w-28 shrink-0">Клиент:</span>
                                  {item.client ? (
                                    <Link
                                      to={`/admin/clients?search=${encodeURIComponent(clientSearchQuery(item))}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-primary hover:underline inline-flex items-center gap-1"
                                    >
                                      <User className="h-3 w-3" /> {clientDisplay(item)}
                                    </Link>
                                  ) : (
                                    <span>{item.kind === "external" ? "Внешняя (Platega)" : "—"}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground w-28 shrink-0">Создан:</span>
                                  <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {fmtDate(item.createdAt)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground w-28 shrink-0">Оплачен:</span>
                                  <span>{fmtDate(item.paidAt)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground w-28 shrink-0">Callback:</span>
                                  <span>
                                    {callbackBadge(item.callback)}
                                    {item.callback.at && <span className="text-muted-foreground ml-1.5">{fmtDate(item.callback.at)}</span>}
                                    {item.callback.responseStatus != null && <span className="text-muted-foreground ml-1.5">HTTP {item.callback.responseStatus}</span>}
                                  </span>
                                </div>
                              </div>
                              <div className="text-xs">
                                <p className="text-muted-foreground mb-1.5 inline-flex items-center gap-1"><Hash className="h-3 w-3" /> События callback</p>
                                {detail === undefined ? (
                                  <RefreshCw className="h-4 w-4 animate-spin text-primary/60" />
                                ) : detail === null ? (
                                  <p className="text-muted-foreground">Не удалось загрузить события</p>
                                ) : detail.webhookEvents.length === 0 ? (
                                  <p className="text-muted-foreground">Событий нет</p>
                                ) : (
                                  <div className="space-y-1">
                                    {detail.webhookEvents.map((ev) => (
                                      <div key={ev.id} className="flex items-center gap-2 flex-wrap rounded-lg border border-white/5 bg-foreground/[0.02] dark:bg-white/[0.02] px-2.5 py-1.5">
                                        <span className={cn(
                                          "inline-flex h-1.5 w-1.5 rounded-full",
                                          ev.outcome === "success" ? "bg-emerald-400" : "bg-red-400"
                                        )} />
                                        <span className="font-medium">{ev.provider}</span>
                                        <span className="text-muted-foreground">{ev.outcome}</span>
                                        {ev.responseStatus != null && <span className="text-muted-foreground">HTTP {ev.responseStatus}</span>}
                                        <span className="text-muted-foreground ml-auto">{fmtDate(ev.createdAt)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pagination */}
      {data && (totalPages > 1 || data.total > 0) && (
        <Card className="bg-background/40 backdrop-blur-3xl border-white/10 rounded-[1.5rem] p-3 shadow-xl flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Стр. <span className="font-semibold text-foreground">{page}</span> из {totalPages} · {data.total} записей
            </span>
            <div className="w-28">
              <GlassSelect
                value={String(pageSize)}
                onChange={(v) => { setPageSize(Number(v)); setPage(1); }}
                options={[
                  { value: "10", label: "10 / стр." },
                  { value: "20", label: "20 / стр." },
                  { value: "50", label: "50 / стр." },
                  { value: "100", label: "100 / стр." },
                ]}
              />
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)} className="h-8 px-2 rounded-lg">«</Button>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-8 px-2.5 rounded-lg">‹</Button>
              {pageNumbers().map((p, i) =>
                p === "…" ? (
                  <span key={`e${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPage(p)}
                    className="h-8 min-w-8 px-2 rounded-lg"
                  >
                    {p}
                  </Button>
                )
              )}
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-8 px-2.5 rounded-lg">›</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="h-8 px-2 rounded-lg">»</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
