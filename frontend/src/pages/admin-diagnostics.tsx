/**
 * Diagnostics: health checks (postgres/remna/bot/disk/ram/uptime), cron-monitor,
 * logs viewer + кнопка «Logout all admins».
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, RefreshCw, Activity, Clock, FileText, ShieldOff, Play, CheckCircle2, AlertTriangle, XCircle, MinusCircle } from "lucide-react";
import { diagnosticsApi, adminSecurityApi, type HealthResponse, type CronEntry } from "@/lib/admin-extras-api";
import { fmtMsk } from "@/lib/datetime";

const STATUS_META = {
  ok: { cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30", icon: CheckCircle2, label: "OK" },
  warn: { cls: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30", icon: AlertTriangle, label: "WARN" },
  error: { cls: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30", icon: XCircle, label: "ERROR" },
  skip: { cls: "text-slate-500 dark:text-slate-400 bg-slate-500/10 border-slate-500/20", icon: MinusCircle, label: "skip" },
};

export function AdminDiagnosticsPage() {
  const { state } = useAuth();
  const token = state.accessToken;

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [crons, setCrons] = useState<CronEntry[]>([]);
  const [squadTraffic, setSquadTraffic] = useState<{ state: { lastSucceededAt: string | null; durationMs: number | null; changedCount: number; lastError: string | null; observeOnly: boolean } | null; quotas: { active: number; exhausted: number; configErrors: number } } | null>(null);
  const [logs, setLogs] = useState("");
  const [logsFilter, setLogsFilter] = useState("");
  const [logsLines, setLogsLines] = useState(200);
  const [loading, setLoading] = useState({ health: false, crons: false, logs: false });
  const [triggeringCron, setTriggeringCron] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    if (!token) return;
    setLoading((l) => ({ ...l, health: true }));
    try {
      setHealth(await diagnosticsApi.health(token));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading((l) => ({ ...l, health: false }));
    }
  }, [token]);

  const loadCrons = useCallback(async () => {
    if (!token) return;
    setLoading((l) => ({ ...l, crons: true }));
    try {
      const r = await diagnosticsApi.crons(token);
      setCrons(r.items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading((l) => ({ ...l, crons: false }));
    }
  }, [token]);

  const loadLogs = useCallback(async () => {
    if (!token) return;
    setLoading((l) => ({ ...l, logs: true }));
    try {
      const r = await diagnosticsApi.logs(token, { lines: logsLines, filter: logsFilter || undefined });
      setLogs(r.text);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading((l) => ({ ...l, logs: false }));
    }
  }, [token, logsLines, logsFilter]);

  const loadSquadTraffic = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("/api/admin/diagnostics/squad-traffic", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Diagnostics request failed: ${response.status}`);
      setSquadTraffic(await response.json());
    } catch (e) {
      setError(String(e));
    }
  }, [token]);

  useEffect(() => { void loadHealth(); void loadCrons(); void loadSquadTraffic(); }, [loadHealth, loadCrons, loadSquadTraffic]);

  const triggerCron = async (name: string) => {
    if (!token) return;
    if (!confirm(`Запустить cron-задачу «${name}» прямо сейчас?`)) return;
    setTriggeringCron(name);
    try {
      await diagnosticsApi.triggerCron(token, name);
      await loadCrons();
    } catch (e) {
      alert(`Ошибка: ${e}`);
    } finally {
      setTriggeringCron(null);
    }
  };

  const handleLogoutAll = async () => {
    if (!token) return;
    const reason = prompt("Зачем (для аудит-лога):", "manual logout-all");
    if (reason === null) return;
    const incMe = confirm("Включая ВАС? OK = включая (вы тоже разлогинитесь). Cancel = только остальные админы.");
    try {
      const r = await adminSecurityApi.logoutAll(token, { includingMe: incMe, reason: reason || undefined });
      alert(r.message);
      if (incMe) {
        // Если включили себя, refresh-токен у нас тоже инвалидирован — на следующий API-call мы получим 401.
        window.location.reload();
      }
    } catch (e) {
      alert(`Ошибка: ${e}`);
    }
  };

  return (
    <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-violet-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-violet-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <Activity className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">Диагностика</h1>
            <p className="text-sm text-muted-foreground mt-1">Health-проверки, cron-монитор и логи API-контейнера.</p>
          </div>
        </div>
        <Button onClick={handleLogoutAll} variant="outline" size="sm" className="gap-1.5 rounded-xl text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/10">
          <ShieldOff className="h-4 w-4" />
          Разлогинить всех админов
        </Button>
      </div>

      {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-md px-4 py-3 text-sm text-red-500 dark:text-red-400">{error}</div> : null}

      {/* Health */}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" /> Health
              {health ? (
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_META[health.overallStatus].cls}`}>
                  {STATUS_META[health.overallStatus].label}
                </span>
              ) : null}
            </h2>
            <Button onClick={loadHealth} variant="ghost" size="sm" disabled={loading.health} className="gap-1">
              {loading.health ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {health ? (
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {health.checks.map((c) => {
                const meta = STATUS_META[c.status];
                const Icon = meta.icon;
                return (
                  <div key={c.name} className={`rounded-lg border p-3 ${meta.cls}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span className="text-sm font-semibold">{c.name}</span>
                      </div>
                      <span className="text-[10px] font-mono opacity-60">{c.durationMs ?? "—"}ms</span>
                    </div>
                    {c.detail ? <div className="mt-1 text-xs opacity-80">{c.detail}</div> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-20 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Squad traffic accounting</h2>
            <Button onClick={loadSquadTraffic} variant="ghost" size="sm"><RefreshCw className="h-3.5 w-3.5" /></Button>
          </div>
          {squadTraffic ? <div className="grid gap-2 text-sm md:grid-cols-4">
            <div>Active: <b>{squadTraffic.quotas.active}</b></div><div>Exhausted: <b>{squadTraffic.quotas.exhausted}</b></div><div>Config errors: <b>{squadTraffic.quotas.configErrors}</b></div>
            <div>{squadTraffic.state?.observeOnly ? "Observe-only" : "Enforcement enabled"} · changed: <b>{squadTraffic.state?.changedCount ?? 0}</b></div>
          </div> : <div className="text-sm text-muted-foreground">Loading worker diagnostics…</div>}
          {squadTraffic?.state?.lastError ? <div className="mt-2 text-xs text-red-500">{squadTraffic.state.lastError}</div> : null}
        </CardContent>
      </Card>

      {/* Cron monitor */}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" /> Cron-задачи ({crons.length})
            </h2>
            <Button onClick={loadCrons} variant="ghost" size="sm" disabled={loading.crons} className="gap-1">
              {loading.crons ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {crons.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Реестр пуст. Cron-задачи начнут регистрироваться после следующей итерации (registerCron в каждом scheduler-файле).
            </div>
          ) : (
            <div className="divide-y">
              {crons.map((c) => {
                const lastRun = c.recent[0];
                return (
                  <div key={c.name} className="flex items-center gap-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{c.name}</span>
                        {c.running ? <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 text-[10px]"><Loader2 className="h-3 w-3 animate-spin" /> running</span> : null}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{c.cron}</span>
                        {c.nextRunAt ? <span className="ml-2">next: {fmtMsk(c.nextRunAt)}</span> : null}
                        {c.description ? <span className="ml-2">— {c.description}</span> : null}
                      </div>
                      {lastRun ? (
                        <div className="mt-0.5 text-[11px] flex items-center gap-2">
                          {lastRun.ok ? (
                            <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> OK</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400 inline-flex items-center gap-1"><XCircle className="h-3 w-3" /> ERROR</span>
                          )}
                          <span className="text-muted-foreground">{new Date(lastRun.startedAt).toLocaleTimeString("ru", { timeZone: "Europe/Moscow" })} · {lastRun.durationMs}ms</span>
                          {lastRun.error ? <span className="text-muted-foreground truncate">{lastRun.error.slice(0, 60)}</span> : null}
                        </div>
                      ) : null}
                    </div>
                    {c.canTrigger ? (
                      <Button onClick={() => triggerCron(c.name)} disabled={c.running || triggeringCron === c.name} variant="outline" size="sm" className="gap-1.5">
                        {triggeringCron === c.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        Run now
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Logs viewer */}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" /> Логи API
            </h2>
            <div className="flex items-center gap-2">
              <div>
                <Label className="text-[10px] uppercase">Lines</Label>
                <Input type="number" value={logsLines} onChange={(e) => setLogsLines(Number(e.target.value) || 200)} className="h-8 w-20 text-xs" />
              </div>
              <div>
                <Label className="text-[10px] uppercase">Filter (regex)</Label>
                <Input value={logsFilter} onChange={(e) => setLogsFilter(e.target.value)} placeholder="error|webhook" className="h-8 w-48 text-xs" />
              </div>
              <Button onClick={loadLogs} variant="outline" size="sm" disabled={loading.logs} className="gap-1.5 mt-4">
                {loading.logs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Tail
              </Button>
            </div>
          </div>
          <Textarea readOnly value={logs} rows={20} className="font-mono text-[11px] leading-relaxed" placeholder="Нажми «Tail» чтобы получить последние строки логов api-контейнера." />
        </CardContent>
      </Card>
    </div>
  );
}
