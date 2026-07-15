/**
 * T-subscription-remna (14.05.2026)
 *
 * Универсальная панель управления Remna user-ом конкретной подписки.
 * Используется в карточке клиента (вкладка «Подписки»), для primary и secondary
 * подписок одинаково. Делит UI на 3 внутренних вкладки:
 *
 *   - 📊 «Обзор»       — данные Remna user + лимиты + кнопка «Применить»
 *   - 🛡️ «Сквады»      — список internalSquads, добавить/убрать у этой подписки
 *   - ⚡ «Действия»    — Отозвать / Disable / Enable / Reset traffic / Refresh / Unlink
 *
 * Все вызовы идут на `/admin/subscriptions/:subId/remna/...`. Если подписка
 * ещё не привязана к Remna (remnawaveUuid=null) — рисуется warning-плашка.
 */
import { useState, useEffect, useCallback } from "react";
import {
  api,
  type AdminClientSubscriptionItem,
  type AdminSubscriptionRemnaResponse,
  type RemnaUserFull,
  type UpdateClientRemnaPayload,
} from "@/lib/api";
import { fmtMsk, isoToMskInputValue, mskInputValueToIso } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Ticket,
  Ban,
  ShieldCheck,
  Wifi,
  RefreshCw,
  Unlink,
  Copy,
  Check,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STRATEGY_LABELS: Record<string, string> = {
  NO_RESET: "Без сброса",
  DAY: "Ежедневно",
  WEEK: "Еженедельно",
  MONTH: "Ежемесячно",
  MONTH_ROLLING: "Скользящий месяц",
};

function formatTrafficBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-white/10 transition-colors"
      title="Скопировать"
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function MiniSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      className="flex h-9 w-full rounded-xl border border-white/10 bg-foreground/[0.04] dark:bg-white/[0.04] hover:bg-black/30 transition-colors px-3 py-1 text-sm shadow-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

interface Props {
  subscription: AdminClientSubscriptionItem;
  token: string;
  remnaSquads: { uuid: string; name?: string }[];
  /** Вызывается после любого действия которое могло изменить состояние подписки/клиента (для refresh parent). */
  onChanged?: () => void;
}

type InnerTab = "overview" | "squads" | "actions";

interface RemnaUserResponseShape {
  response?: RemnaUserFull;
}

function unwrapRemnaUser(raw: unknown): RemnaUserFull | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RemnaUserResponseShape & Partial<RemnaUserFull>;
  if (r.response && typeof r.response === "object") return r.response as RemnaUserFull;
  if ("uuid" in r && typeof (r as RemnaUserFull).uuid === "string") return r as RemnaUserFull;
  return null;
}

export function SubscriptionRemnaPanel({ subscription, token, remnaSquads, onChanged }: Props) {
  const [innerTab, setInnerTab] = useState<InnerTab>("overview");
  const [remnaUser, setRemnaUser] = useState<RemnaUserFull | null>(null);
  const [activeSquads, setActiveSquads] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<UpdateClientRemnaPayload>({});
  const [components, setComponents] = useState<AdminSubscriptionRemnaResponse["components"]>([]);
  const [selectedComponentKey, setSelectedComponentKey] = useState("");
  const [subscriptionUrl, setSubscriptionUrl] = useState(subscription.subscriptionUrl ?? "");
  const [newComponent, setNewComponent] = useState(() => ({
    key: "",
    adminName: "",
    mergeOrder: String(Math.max(0, ...(subscription.components ?? []).map((component) => component.mergeOrder)) + 10),
  }));

  const loadRemna = useCallback(async () => {
    if (!subscription.remnawaveUuid && !subscription.components?.some((component) => component.remnawaveUuid)) {
      setRemnaUser(null);
      setActiveSquads([]);
      return;
    }
    setLoading(true);
    try {
      const raw = await api.getSubscriptionRemna(token, subscription.id);
      setComponents(raw.components);
      setSubscriptionUrl(raw.subscriptionUrl);
      const componentKey = selectedComponentKey
        || raw.components.find((component) => component.required)?.key
        || raw.components[0]?.key
        || "";
      if (componentKey !== selectedComponentKey) setSelectedComponentKey(componentKey);
      const selected = raw.components.find((component) => component.key === componentKey);
      const user = unwrapRemnaUser(selected?.data ?? raw);
      setRemnaUser(user);
      const ids = (user?.activeInternalSquads ?? []).map((s) => s.uuid);
      setActiveSquads(ids);
      if (user) {
        setEditForm({
          trafficLimitBytes: user.trafficLimitBytes ?? 0,
          hwidDeviceLimit: user.hwidDeviceLimit,
          trafficLimitStrategy: user.trafficLimitStrategy as UpdateClientRemnaPayload["trafficLimitStrategy"],
          expireAt: user.expireAt ?? undefined,
        });
      }
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : "Ошибка загрузки"}`);
    } finally {
      setLoading(false);
    }
  }, [selectedComponentKey, subscription.id, subscription.remnawaveUuid, token]);

  useEffect(() => {
    loadRemna();
  }, [loadRemna]);

  async function applyLimits() {
    setSaving(true);
    setActionMsg(null);
    try {
      const payload: UpdateClientRemnaPayload = {};
      if (editForm.trafficLimitBytes !== undefined) payload.trafficLimitBytes = editForm.trafficLimitBytes;
      if (editForm.hwidDeviceLimit !== undefined) payload.hwidDeviceLimit = editForm.hwidDeviceLimit;
      if (editForm.trafficLimitStrategy) payload.trafficLimitStrategy = editForm.trafficLimitStrategy;
      if (editForm.expireAt) payload.expireAt = editForm.expireAt;
      await api.updateSubscriptionRemna(token, subscription.id, payload, selectedComponentKey || undefined);
      setActionMsg("✅ Лимиты применены");
      await loadRemna();
      onChanged?.();
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : "Ошибка"}`);
    } finally {
      setSaving(false);
    }
  }

  async function runAction(successLabel: string, fn: () => Promise<unknown>, refresh = true) {
    setActionMsg(null);
    try {
      const response = await fn();
      const result = response && typeof response === "object"
        ? response as { degraded?: boolean; failures?: Array<{ key: string; error: string }> }
        : null;
      setActionMsg(result?.degraded
        ? `⚠️ ${result.failures?.map((failure) => `${failure.key}: ${failure.error}`).join("; ") || "Часть компонентов ожидает retry"}`
        : `✅ ${successLabel}`);
      if (refresh) await loadRemna();
      onChanged?.();
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : "Ошибка"}`);
    }
  }

  async function squadAdd(uuid: string) {
    await runAction("Сквад добавлен", () => api.subscriptionRemnaSquadAdd(token, subscription.id, uuid, selectedComponentKey || undefined));
    setActiveSquads((prev) => (prev.includes(uuid) ? prev : [...prev, uuid]));
  }

  async function squadRemove(uuid: string) {
    await runAction("Сквад удалён", () => api.subscriptionRemnaSquadRemove(token, subscription.id, uuid, selectedComponentKey || undefined));
    setActiveSquads((prev) => prev.filter((u) => u !== uuid));
  }

  async function addManualComponent() {
    const mergeOrder = Number(newComponent.mergeOrder);
    if (!newComponent.key.trim() || !newComponent.adminName.trim() || !Number.isInteger(mergeOrder)) {
      setActionMsg("❌ Заполните key, название и порядок компонента");
      return;
    }
    await runAction("Ручной компонент добавлен", async () => {
      await api.createSubscriptionManualComponent(token, subscription.id, {
        key: newComponent.key.trim(),
        adminName: newComponent.adminName.trim(),
        mergeOrder,
      });
      setNewComponent({ key: "", adminName: "", mergeOrder: String(mergeOrder + 10) });
    });
  }

  async function deleteManualComponent() {
    const component = components.find((item) => item.key === selectedComponentKey);
    if (!component?.managedManually) return;
    if (!confirm(`Удалить ручной компонент «${component.adminName}»? Его доступ в Remnawave будет удалён.`)) return;
    await runAction("Ручной компонент удалён", () => api.deleteSubscriptionManualComponent(token, subscription.id, component.key));
  }

  // Нет привязки к Remna → плашка.
  if (!subscription.remnawaveUuid && !subscription.components?.some((component) => component.remnawaveUuid)) {
    return (
      <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.06] p-4 text-sm text-yellow-200">
        ⚠️ Эта подписка ещё не привязана к Remna (`remnawaveUuid = null`).
        Купите/активируйте тариф или сделайте «Push в Remna» в массовых операциях клиента.
      </div>
    );
  }

  const trafficUsed = remnaUser?.userTraffic?.usedTrafficBytes ?? 0;
  const trafficLimit = remnaUser?.trafficLimitBytes ?? 0;
  const selectedComponent = components.find((component) => component.key === selectedComponentKey);

  return (
    <div className="space-y-3">
      {subscriptionUrl && (
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-foreground/[0.03] px-3 py-2 text-xs">
          <span className="text-muted-foreground">Объединённая ссылка</span>
          <code className="min-w-0 flex-1 truncate">{subscriptionUrl}</code>
          <CopyButton text={subscriptionUrl} />
        </div>
      )}
      {components.length > 1 && (
        <MiniSelect
          value={selectedComponentKey}
          onChange={setSelectedComponentKey}
          options={components.map((component) => ({
            value: component.key,
            label: `${component.required ? "★ " : ""}${subscription.components?.find((item) => item.key === component.key)?.adminName ?? component.key}${component.error ? " — ошибка" : ""}`,
          }))}
        />
      )}
      <div className="rounded-xl border border-white/10 bg-foreground/[0.03] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium">Ручные компоненты</span>
          {selectedComponent?.managedManually && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-destructive" onClick={deleteManualComponent}>
              <Trash2 className="h-3.5 w-3.5" /> Удалить выбранный
            </Button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_90px_auto]">
          <Input value={newComponent.key} onChange={(e) => setNewComponent((value) => ({ ...value, key: e.target.value }))} placeholder="key, например whitelist" />
          <Input value={newComponent.adminName} onChange={(e) => setNewComponent((value) => ({ ...value, adminName: e.target.value }))} placeholder="Название для админа" />
          <Input type="number" min={1} value={newComponent.mergeOrder} onChange={(e) => setNewComponent((value) => ({ ...value, mergeOrder: e.target.value }))} placeholder="Порядок" />
          <Button variant="outline" size="sm" className="gap-1" onClick={addManualComponent}>
            <Plus className="h-3.5 w-3.5" /> Добавить
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Выберите добавленный компонент выше, затем задайте ему лимиты и сквады.</p>
      </div>
      <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as InnerTab)}>
        <TabsList className="grid grid-cols-3 gap-1 bg-foreground/[0.03] dark:bg-white/[0.03] p-1 rounded-xl border border-white/5">
          <TabsTrigger value="overview" className="text-xs rounded-lg data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            📊 Обзор
          </TabsTrigger>
          <TabsTrigger value="squads" className="text-xs rounded-lg data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            🛡️ Сквады
          </TabsTrigger>
          <TabsTrigger value="actions" className="text-xs rounded-lg data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            ⚡ Действия
          </TabsTrigger>
        </TabsList>

        {/* ─── ОБЗОР: данные Remna + лимиты + Применить ──────────────────── */}
        <TabsContent value="overview" className="mt-3 space-y-4">
          {loading && <p className="text-muted-foreground text-sm">Загрузка данных Remna…</p>}

          {remnaUser && (
            <div className="rounded-2xl bg-gradient-to-br from-background/80 to-background/40 border border-white/10 p-4 space-y-2 text-sm">
              <div className="font-medium text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Данные Remna
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Username</span>
                  <span className="flex items-center gap-1">
                    <code className="text-xs">{remnaUser.username}</code>
                    <CopyButton text={remnaUser.username} />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ID Remna</span>
                  <span className="font-mono text-xs">{remnaUser.id ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">UUID</span>
                  <span className="flex items-center gap-1">
                    <code className="text-[10px]">{remnaUser.uuid.slice(0, 12)}…</code>
                    <CopyButton text={remnaUser.uuid} />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Трафик</span>
                  <span>
                    {formatTrafficBytes(trafficUsed)}
                    {trafficLimit > 0 ? ` / ${formatTrafficBytes(trafficLimit)}` : " (безлимит)"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Стратегия сброса</span>
                  <span>{STRATEGY_LABELS[remnaUser.trafficLimitStrategy] ?? remnaUser.trafficLimitStrategy}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Истекает</span>
                  <span>{fmtMsk(remnaUser.expireAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Создан в Remna</span>
                  <span>{fmtMsk(remnaUser.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Обновлён</span>
                  <span>{fmtMsk(remnaUser.updatedAt)}</span>
                </div>
              </div>
            </div>
          )}

          <div>
            <h3 className="font-semibold mb-3 text-sm">Лимиты и тариф</h3>
            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              <div className="space-y-2">
                <Label>Лимит трафика (ГБ, 0 = без лимита)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={
                    editForm.trafficLimitBytes !== undefined && editForm.trafficLimitBytes > 0
                      ? (editForm.trafficLimitBytes / 1024 ** 3).toFixed(2).replace(/\.?0+$/, "")
                      : editForm.trafficLimitBytes === 0
                      ? "0"
                      : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditForm((f) => ({
                      ...f,
                      trafficLimitBytes:
                        v === ""
                          ? undefined
                          : (() => {
                              const gb = parseFloat(v);
                              return Number.isNaN(gb) ? undefined : Math.round(gb * 1024 ** 3);
                            })(),
                    }));
                  }}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Лимит устройств (HWID)</Label>
                <Input
                  type="number"
                  min={0}
                  value={editForm.hwidDeviceLimit ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      hwidDeviceLimit: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  placeholder="—"
                />
              </div>
              <div className="space-y-2">
                <Label>Сброс трафика</Label>
                <MiniSelect
                  value={editForm.trafficLimitStrategy ?? ""}
                  onChange={(v) =>
                    setEditForm((f) => ({ ...f, trafficLimitStrategy: v as UpdateClientRemnaPayload["trafficLimitStrategy"] }))
                  }
                  options={[
                    { value: "", label: "—" },
                    { value: "NO_RESET", label: "Без сброса" },
                    { value: "DAY", label: "Ежедневно" },
                    { value: "WEEK", label: "Еженедельно" },
                    { value: "MONTH", label: "Ежемесячно" },
                    { value: "MONTH_ROLLING", label: "Скользящий месяц" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label>Дата окончания (МСК)</Label>
                <Input
                  type="datetime-local"
                  value={isoToMskInputValue(editForm.expireAt)}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      expireAt: mskInputValueToIso(e.target.value),
                    }))
                  }
                />
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 rounded-xl border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08]"
              onClick={applyLimits}
              disabled={saving}
            >
              {saving ? "Применяем…" : "Применить лимиты"}
            </Button>
          </div>
        </TabsContent>

        {/* ─── СКВАДЫ ─────────────────────────────────────────────────── */}
        <TabsContent value="squads" className="mt-3">
          {remnaSquads.length === 0 ? (
            <div className="text-sm text-muted-foreground">Сквады Remna не настроены.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {remnaSquads.map((s) => {
                const inSquad = activeSquads.includes(s.uuid);
                return (
                  <span
                    key={s.uuid}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs border transition-colors",
                      inSquad
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-muted border-transparent text-muted-foreground"
                    )}
                  >
                    <span className="font-medium">{s.name || s.uuid.slice(0, 8)}</span>
                    {inSquad ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-destructive text-[11px]"
                        onClick={() => squadRemove(s.uuid)}
                      >
                        Убрать
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-[11px]"
                        onClick={() => squadAdd(s.uuid)}
                      >
                        + Добавить
                      </Button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── ДЕЙСТВИЯ (быстрые действия per-subscription) ───────────── */}
        <TabsContent value="actions" className="mt-3">
          <h3 className="font-semibold text-sm mb-3">Быстрые действия Remna</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 rounded-xl"
              onClick={() => {
                if (!confirm("Аннулировать эту подписку и все её компоненты? Остальные подписки клиента останутся без изменений.")) return;
                runAction("Подписка аннулирована", () => api.subscriptionRemnaRevokeSubscription(token, subscription.id), false);
              }}
            >
              <Ticket className="h-4 w-4" /> Аннулировать подписку
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 rounded-xl"
              onClick={() => runAction("Отключено в Remna", () => api.subscriptionRemnaDisable(token, subscription.id))}
            >
              <Ban className="h-4 w-4" /> Отключить в Remna
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2 text-green-700 dark:text-green-400 border-green-500/30 hover:bg-green-500/10 rounded-xl"
              onClick={() => runAction("Включено в Remna", () => api.subscriptionRemnaEnable(token, subscription.id))}
            >
              <ShieldCheck className="h-4 w-4" /> Включить в Remna
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2 rounded-xl border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08]"
              onClick={() => runAction("Трафик сброшен", () => api.subscriptionRemnaResetTraffic(token, subscription.id))}
            >
              <Wifi className="h-4 w-4" /> Сбросить трафик
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2 rounded-xl border-white/10 bg-foreground/[0.03] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08]"
              onClick={() => loadRemna()}
            >
              <RefreshCw className="h-4 w-4" /> Обновить данные
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2 text-yellow-700 dark:text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10 rounded-xl"
              onClick={() => {
                if (!confirm("Отвязать эту подписку от Remna? UUID будет обнулён, при следующей покупке создастся новый.")) return;
                runAction("Подписка отвязана от Remna", () => api.subscriptionRemnaUnlink(token, subscription.id));
              }}
            >
              <Unlink className="h-4 w-4" /> Отвязать от Remna
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {actionMsg && <p className="text-sm text-muted-foreground">{actionMsg}</p>}
    </div>
  );
}
