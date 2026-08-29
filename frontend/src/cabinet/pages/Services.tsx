import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Box, CalendarDays, Copy, CreditCard, Gift, Headphones, KeyRound,
  Layers3, MessageCircle, Network, PackagePlus, Send, Server, ShieldCheck,
  Signal, Smartphone, Ticket, Wallet, Wifi, Zap,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicSellOption, type TicketMessageDto } from "@/lib/api";
import { preparePaymentRedirect } from "@/lib/open-payment-url";
import { Button } from "../components/ui/button";
import { Input, Select, Textarea } from "../components/ui/input";
import { Modal, ModalDescription, ModalTitle } from "../components/ui/modal";
import { PaymentMethodsBlock } from "../components/ui/payment-methods";
import { useSuccess } from "../components/ui/success-dialog";
import { prefetchPublicConfig } from "../components/ui/prefetch";
import { canBuyTrafficOption, groupPlategaMethods, isWhitelistTrafficOption, resolvePaymentUrl, sortTrafficOptions, trafficOptionLabel, trafficOptionUnitPrice } from "../model";
import { useApp } from "../store/AppContext";
import { cn } from "../lib/cn";

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toLocaleString("ru-RU")} ${currency.toUpperCase()}`;
  }
}

function PageTitle({ icon: Icon, title, subtitle, compact = false }: { icon: typeof Box; title: string; subtitle: string; /** compact — плотная шапка секции («Докупить трафик»); остальные страницы остаются крупными */ compact?: boolean }) {
  return <div className={cn("flex items-center", compact ? "gap-3" : "gap-4")}><div className={cn("icon-tile", compact ? "h-9 w-9 rounded-xl" : "h-12 w-12 rounded-2xl")}><Icon className={compact ? "h-4 w-4" : "h-5 w-5"} /></div><div><h1 className={cn("font-extrabold tracking-tight", compact ? "text-lg sm:text-xl" : "text-2xl sm:text-3xl")}>{title}</h1><p className={cn("mt-1 text-fog-500", compact ? "text-xs" : "text-sm")}>{subtitle}</p></div></div>;
}

type PurchasePayload = {
  tariffId?: string;
  proxyTariffId?: string;
  singboxTariffId?: string;
  extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string; targetSubscriptionId?: string };
  customBuild?: { days: number; devices: number; trafficGb?: number };
};

function CheckoutActions({
  amount,
  currency,
  payload,
  balancePay,
  description,
}: {
  amount: number;
  currency: string;
  payload: PurchasePayload;
  balancePay: () => Promise<{ message: string }>;
  description: string;
}) {
  const { state, refreshProfile } = useClientAuth();
  const { user, config, reload, toast } = useApp();
  const { show } = useSuccess();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);

  const finishBalance = async () => {
    if (!state.token) return;
    setLoading(true);
    try {
      const result = await balancePay();
      // Успех — глобальное окно (без дубля в toast)
      show({ title: result.message });
      void Promise.all([refreshProfile(), reload({ soft: true })]).catch(() => undefined);
    } catch (cause) {
      toast({ title: "Оплата не прошла", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  const external = async (provider: string, create: () => Promise<{ paymentId: string; paymentUrl?: string; payUrl?: string; miniAppPayUrl?: string; webAppPayUrl?: string }>) => {
    const redirect = preparePaymentRedirect();
    setLoading(true);
    try {
      const result = await create();
      const url = resolvePaymentUrl(result, redirect.isTelegramMiniApp);
      if (!url) throw new Error("Платёжная система не вернула ссылку");
      redirect.open(url);
      if (!redirect.isTelegramMiniApp) navigate(`/cabinet/payment-wait?id=${encodeURIComponent(result.paymentId)}&kind=service`, { state: { url, provider, returnPath: location.pathname } });
    } catch (cause) {
      redirect.cancel();
      toast({ title: "Не удалось открыть оплату", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  return <div className="mt-4 flex flex-col gap-2">
    <Button variant="secondary" size="lg" className="w-full justify-between" loading={loading} loadingText="Оплата…" disabled={user.balance < amount} onClick={finishBalance}>
      <span className="flex items-center gap-2"><Wallet /> С баланса</span>
      <span className="font-bold">{money(user.balance, currency)}</span>
    </Button>
    {(config?.plategaMethods ?? []).map((method) => <Button key={method.id} size="lg" className="w-full" loading={loading} loadingText="Оплата…" disabled={!state.token} onClick={() => external("Platega", () => api.clientCreatePlategaPayment(state.token!, { ...payload, paymentMethod: method.id, description }))}><CreditCard /> Platega · {method.label}</Button>)}
    {config?.cryptopayEnabled && <Button variant="ghost" size="lg" className="w-full" loading={loading} loadingText="Оплата…" disabled={!state.token} onClick={() => external("Crypto Bot", () => api.cryptopayCreatePayment(state.token!, payload))}><Zap /> Crypto Bot</Button>}
    {config?.rollypayEnabled && currency.toUpperCase() === "RUB" && <Button variant="ghost" size="lg" className="w-full" loading={loading} loadingText="Оплата…" disabled={!state.token} onClick={() => external("RollyPay", () => api.rollypayCreatePayment(state.token!, { ...payload, currency }))}><CreditCard /> RollyPay</Button>}
  </div>;
}

function optionDescription(option: PublicSellOption) {
  if (option.kind === "traffic") return `+${option.trafficGb} ГБ · ${trafficOptionLabel(option.trafficMode)}`;
  if (option.kind === "devices") return `+${option.deviceCount} устройств`;
  return option.trafficGb ? `Дополнительный сервер · ${option.trafficGb} ГБ` : "Дополнительный сервер";
}

type TrafficSellOption = Extract<PublicSellOption, { kind: "traffic" }>;

function TrafficCard({ option, onBuy }: { option: TrafficSellOption; onBuy: () => void }) {
  const whitelist = isWhitelistTrafficOption(option);
  const perGb = trafficOptionUnitPrice(option.trafficGb ?? 0, option.price);
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative mt-2 flex flex-col rounded-3xl border p-5 transition-all duration-300",
        whitelist
          ? /* Плотная залитая подложка в amber-тоне, а не стеклянный полупрозрачный слой */
            "border-amber-glow/40 bg-[linear-gradient(150deg,#2b1f0d,#1b1207_58%,#130d05)] shadow-[inset_0_2px_12px_rgb(2_4_12/0.55),0_0_36px_-12px_rgba(255,181,69,0.55)]"
          : "glass-inset hover:border-white/16",
      )}
    >
      {whitelist && (
        <span className="absolute -top-3 left-5 flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-glow to-amber-500 px-3 py-1 text-[11px] font-extrabold text-ink-950 shadow-[0_4px_16px_-4px_rgba(255,181,69,0.7)]">
          <Signal className="h-3 w-3" /> Белые списки
        </span>
      )}
      <div className="flex items-center justify-between">
        <div className={cn("icon-tile h-11 w-11 rounded-xl", whitelist && "border border-amber-glow/30 bg-amber-glow/12 text-amber-glow")}>
          {whitelist ? <Signal className="h-5 w-5" /> : <Wifi className="h-5 w-5" />}
        </div>
        {!whitelist && <span className="chip chip-fluid max-w-[60%]">{trafficOptionLabel(option.trafficMode)}</span>}
      </div>
      <p className="mt-4 text-2xl font-extrabold tracking-tight">+{option.trafficGb} ГБ</p>
      <p className="mt-1 truncate text-sm font-semibold text-fog-400">{option.name}</p>
      <div className="my-4 h-px bg-white/8" />
      <div className="mt-auto flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xl font-extrabold tracking-tight">{money(option.price, option.currency)}</p>
          {perGb > 0 && <p className="text-[11px] text-fog-600">{money(perGb, option.currency)}/ГБ</p>}
        </div>
        <Button variant={whitelist ? "success" : "secondary"} size="md" className="shrink-0" onClick={onBuy}>
          <CreditCard /> Оплатить
        </Button>
      </div>
    </motion.section>
  );
}

function TrafficOptionDialog({
  option,
  open,
  onOpenChange,
  targetSubscriptionId,
}: {
  option: TrafficSellOption | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetSubscriptionId?: string;
}) {
  const { state, refreshProfile } = useClientAuth();
  const { user, config, reload, toast } = useApp();
  const { show } = useSuccess();
  const navigate = useNavigate();
  const location = useLocation();
  const [paying, setPaying] = useState(false);

  if (!option) return null;

  const whitelist = isWhitelistTrafficOption(option);
  const payload = { extraOption: { kind: "traffic" as const, productId: option.id, targetSubscriptionId: targetSubscriptionId || undefined } };
  const plategaMethods = config?.plategaMethods ?? [];
  const { sbp: sbpMethod, card: cardMethod, crypto: cryptoMethod, other: otherPlategaMethods } = groupPlategaMethods(plategaMethods);

  const payBalance = async () => {
    if (!state.token) return;
    setPaying(true);
    try {
      await api.clientPayOptionByBalance(state.token, payload);
      // Успех — глобальное окно, диалог закрывается по «Готово»
      show({
        title: "Трафик зачислен",
        description: `Пакет «${option.name}» добавлен к выбранной подписке.`,
        onDone: () => onOpenChange(false),
      });
      void Promise.all([refreshProfile(), reload({ soft: true })]).catch(() => undefined);
    } catch (cause) {
      toast({ title: "Оплата не прошла", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally {
      setPaying(false);
    }
  };

  const openPayment = async (provider: string, create: () => Promise<{ paymentId: string; paymentUrl?: string; payUrl?: string; miniAppPayUrl?: string; webAppPayUrl?: string }>) => {
    const redirect = preparePaymentRedirect();
    setPaying(true);
    try {
      const result = await create();
      const url = resolvePaymentUrl(result, redirect.isTelegramMiniApp);
      if (!url) throw new Error("Платёжная система не вернула ссылку");
      if (redirect.isTelegramMiniApp) {
        redirect.open(url);
      } else {
        navigate(`/cabinet/payment-wait?id=${encodeURIComponent(result.paymentId)}&kind=service`, { state: { url, provider, returnPath: location.pathname } });
        onOpenChange(false);
      }
    } catch (cause) {
      redirect.cancel();
      toast({ title: "Не удалось открыть оплату", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally {
      setPaying(false);
    }
  };

  const payPlatega = (methodId: number) => state.token && openPayment("Platega", () => api.clientCreatePlategaPayment(state.token!, { ...payload, paymentMethod: methodId, description: option.name }));
  const payCryptoBot = () => state.token && openPayment("Crypto Bot", () => api.cryptopayCreatePayment(state.token!, payload));
  const payRollyPay = () => state.token && openPayment("RollyPay", () => api.rollypayCreatePayment(state.token!, { ...payload, currency: option.currency }));

  return (
    <Modal open={open} onOpenChange={onOpenChange} className="max-w-lg">
      <div className="no-scrollbar min-h-0 overflow-y-auto p-5">
        {/* header — компактный, как в PlanDialog: без тайла, крестик встроен в Modal */}
        <div className="pr-10">
          <ModalTitle className="text-lg font-extrabold tracking-tight">{option.name}</ModalTitle>
          <ModalDescription className="mt-0.5 text-xs text-fog-500">{trafficOptionLabel(option.trafficMode)}</ModalDescription>
        </div>

        {/* компактная сводка — цена + назначение одной строкой */}
        <div className="glass-inset mt-5 rounded-2xl p-4">
          <div className="flex items-baseline justify-between">
            <span className="font-bold">Итого к оплате</span>
            <span className="text-xl font-extrabold tracking-tight">{money(option.price, option.currency)}</span>
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 text-xs text-fog-500">
            <Signal className={cn("h-3.5 w-3.5", whitelist && "text-amber-glow")} /> {optionDescription(option)}
          </p>
        </div>

        <p className="mt-5 mb-2 text-xs font-semibold text-fog-500">Способ оплаты</p>
        {/* Способы оплаты — общая сетка кита (как на тарифах); пейлоады и API остаются здесь */}
        <PaymentMethodsBlock
          amount={option.price}
          currency={option.currency}
          balance={user.balance}
          onBalancePay={payBalance}
          platega={{ sbp: sbpMethod, card: cardMethod, crypto: cryptoMethod, other: otherPlategaMethods }}
          loading={paying}
          onPlatega={(id) => payPlatega(id)}
          onCryptoBot={payCryptoBot}
          onRollyPay={payRollyPay}
          cryptoEnabled={config?.cryptopayEnabled}
          rollyEnabled={config?.rollypayEnabled && option.currency.toUpperCase() === "RUB"}
        />
      </div>
    </Modal>
  );
}

export function ExtraOptions({ trafficOnly = false }: { trafficOnly?: boolean } = {}) {
  const { state } = useClientAuth();
  const { config, subscriptions } = useApp();
  const activeSubscriptions = subscriptions.filter((item) => item.status === "active");
  const selectableSubscriptions = trafficOnly ? activeSubscriptions : subscriptions;
  const [target, setTarget] = useState(selectableSubscriptions[0]?.id ?? "");
  const [dialogOption, setDialogOption] = useState<TrafficSellOption | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const targetSubscription = selectableSubscriptions.find((item) => item.id === target) ?? selectableSubscriptions[0];
  const allOptions = (config?.sellOptions ?? []).filter((option) => {
    if (trafficOnly && option.kind !== "traffic") return false;
    if (trafficOnly && !targetSubscription) return false;
    return option.kind !== "traffic" || canBuyTrafficOption(option, targetSubscription);
  });
  const options = allOptions;
  // Прогреваем кэш public-config заранее — диалог оплаты открывается без запроса
  useEffect(() => { void prefetchPublicConfig().catch(() => undefined); }, []);
  useEffect(() => {
    const pool = trafficOnly ? subscriptions.filter((item) => item.status === "active") : subscriptions;
    if (!pool.some((item) => item.id === target)) setTarget(pool[0]?.id ?? "");
  }, [subscriptions, target, trafficOnly]);
  return <div className="flex flex-col gap-5"><PageTitle compact icon={PackagePlus} title={trafficOnly ? "Докупить трафик" : "Дополнительные опции"} subtitle={trafficOnly ? "Пакеты трафика для выбранной подписки." : "Трафик, устройства и серверы для выбранной подписки."} />
    {selectableSubscriptions.length > 1 && <Select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Выберите подписку</option>{selectableSubscriptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>}
    {trafficOnly ? (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sortTrafficOptions(options.filter((option): option is TrafficSellOption => option.kind === "traffic")).map((option) => (
          <TrafficCard
            key={option.id}
            option={option}
            onBuy={() => { setDialogOption(option); setDialogOpen(true); }}
          />
        ))}
      </div>
    ) : (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{options.map((option) => <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={`${option.kind}:${option.id}`} className="glass rounded-4xl p-5"><div className="icon-tile h-11 w-11 rounded-xl">{option.kind === "traffic" ? <Wifi className="h-5 w-5" /> : option.kind === "devices" ? <Smartphone className="h-5 w-5" /> : <Server className="h-5 w-5" />}</div><h2 className="mt-4 text-lg font-extrabold">{option.name}</h2><p className="mt-1 text-sm text-fog-500">{optionDescription(option)}</p><p className="mt-4 text-xl font-extrabold">{money(option.price, option.currency)}</p><CheckoutActions amount={option.price} currency={option.currency} description={option.name} payload={{ extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId: target || undefined } }} balancePay={() => api.clientPayOptionByBalance(state.token!, { extraOption: { kind: option.kind, productId: option.id }, targetSubscriptionId: target || undefined })} /></motion.section>)}</div>
    )}
    {trafficOnly && <TrafficOptionDialog option={dialogOption} open={dialogOpen} onOpenChange={setDialogOpen} targetSubscriptionId={target || undefined} />}
    {config && options.length === 0 && <div className="glass rounded-4xl p-7 text-center text-fog-500">{trafficOnly && !targetSubscription ? "Сначала подключите тариф — после этого здесь появятся пакеты трафика." : "Для выбранной подписки подходящих пакетов сейчас нет."}</div>}
  </div>;
}

export function CustomBuild() {
  const { state } = useClientAuth();
  const { config } = useApp();
  const build = config?.customBuildConfig;
  const [days, setDays] = useState(30);
  const [devices, setDevices] = useState(1);
  const [traffic, setTraffic] = useState(100);
  if (!build) return <div className="glass rounded-4xl p-7 text-center text-fog-500">Конструктор тарифа отключён.</div>;
  const total = Math.round((days * build.pricePerDay + devices * build.pricePerDevice + (build.trafficMode === "per_gb" ? traffic * build.pricePerGb : 0)) * 100) / 100;
  const payload = { days, devices, trafficGb: build.trafficMode === "per_gb" ? traffic : undefined };
  return <div className="mx-auto flex max-w-2xl flex-col gap-5"><PageTitle icon={Layers3} title="Собери свой тариф" subtitle="Настройте срок, устройства и трафик под себя." /><section className="glass rounded-4xl p-6"><Range label="Срок" value={days} min={1} max={build.maxDays} onChange={setDays} suffix="дн." icon={CalendarDays} /><Range label="Устройства" value={devices} min={1} max={build.maxDevices} onChange={setDevices} suffix="шт." icon={Smartphone} />{build.trafficMode === "per_gb" && <div className="mt-5"><label className="mb-2 block text-sm font-bold">Трафик, ГБ</label><Input className="w-full" type="number" min={1} max={1000} value={traffic} onChange={(event) => setTraffic(Math.max(1, Number(event.target.value) || 1))} /></div>}<div className="glass-inset mt-6 flex items-center justify-between rounded-2xl p-4"><span className="font-bold">Итого</span><span className="text-2xl font-extrabold">{money(total, build.currency)}</span></div><CheckoutActions amount={total} currency={build.currency} description="Индивидуальный тариф" payload={{ customBuild: payload }} balancePay={() => api.customBuildPayBalance(state.token!, payload)} /></section></div>;
}

function Range({ label, value, min, max, onChange, suffix, icon: Icon }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; suffix: string; icon: typeof Box }) {
  return <div className="mt-5 first:mt-0"><div className="mb-2 flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-bold"><Icon className="h-4 w-4" />{label}</span><span>{value} {suffix}</span></div><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-violet-500" /></div>;
}

type ProxyTariff = { id: string; name: string; proxyCount: number; durationDays: number; trafficLimitBytes: string | null; connectionLimit: number | null; price: number; currency: string };
type SingboxTariff = { id: string; name: string; slotCount: number; durationDays: number; trafficLimitBytes: string | null; price: number; currency: string };
type ProxySlot = { id: string; login: string; password: string; host: string; socksPort: number; httpPort: number; expiresAt: string; trafficLimitBytes: string | null; trafficUsedBytes: string; connectionLimit: number | null };
type SingboxSlot = { id: string; subscriptionLink: string; expiresAt: string; trafficLimitBytes: string | null; trafficUsedBytes: string; protocol: string };

function bytes(value: string | null) {
  if (!value) return "Безлимит";
  const amount = Number(value);
  return Number.isFinite(amount) ? `${Number((amount / 1024 ** 3).toFixed(1))} ГБ` : "Безлимит";
}

function NetworkService({ kind }: { kind: "proxy" | "singbox" }) {
  const { state } = useClientAuth();
  const { copy } = useApp();
  const [tariffs, setTariffs] = useState<Array<ProxyTariff | SingboxTariff>>([]);
  const [slots, setSlots] = useState<Array<ProxySlot | SingboxSlot>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!state.token) return;
    const request = kind === "proxy"
      ? Promise.all([api.getPublicProxyTariffs(), api.getProxySlots(state.token)]).then(([catalog, owned]) => {
          setTariffs(catalog.items.flatMap((category) => category.tariffs));
          setSlots(owned.slots);
        })
      : Promise.all([api.getPublicSingboxTariffs(), api.getSingboxSlots(state.token)]).then(([catalog, owned]) => {
          setTariffs(catalog.items.flatMap((category) => category.tariffs));
          setSlots(owned.slots);
        });
    void request.catch(() => { setTariffs([]); setSlots([]); }).finally(() => setLoading(false));
  }, [kind, state.token]);
  const proxy = kind === "proxy";
  return <div className="flex flex-col gap-5"><PageTitle icon={proxy ? Network : ShieldCheck} title={proxy ? "Прокси" : "Sing-box"} subtitle={proxy ? "Персональные SOCKS5 и HTTP доступы." : "Отдельные защищённые конфигурации Sing-box."} />
    {loading ? <div className="glass h-40 animate-pulse rounded-4xl" /> : <>
      {slots.length > 0 && <section className="glass rounded-4xl p-5"><h2 className="mb-3 font-extrabold">Активные доступы</h2><div className="grid gap-3 md:grid-cols-2">{slots.map((slot) => proxy ? <ProxySlotCard key={slot.id} slot={slot as ProxySlot} copy={copy} /> : <SingboxSlotCard key={slot.id} slot={slot as SingboxSlot} copy={copy} />)}</div></section>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tariffs.map((tariff) => {
        const count = proxy ? (tariff as ProxyTariff).proxyCount : (tariff as SingboxTariff).slotCount;
        const payload = proxy ? { proxyTariffId: tariff.id } : { singboxTariffId: tariff.id };
        return <section key={tariff.id} className="glass rounded-4xl p-5"><div className="icon-tile h-11 w-11 rounded-xl">{proxy ? <Network className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}</div><h2 className="mt-4 text-lg font-extrabold">{tariff.name}</h2><p className="mt-1 text-sm text-fog-500">{count} {proxy ? "прокси" : "слотов"} · {tariff.durationDays} дней · {bytes(tariff.trafficLimitBytes)}</p><p className="mt-4 text-xl font-extrabold">{money(tariff.price, tariff.currency)}</p><CheckoutActions amount={tariff.price} currency={tariff.currency} payload={payload} description={tariff.name} balancePay={() => api.clientPayByBalance(state.token!, payload)} /></section>;
      })}</div>
      {tariffs.length === 0 && <div className="glass rounded-4xl p-7 text-center text-fog-500">Нет доступных тарифов.</div>}
    </>}
  </div>;
}

function ProxySlotCard({ slot, copy }: { slot: ProxySlot; copy: (text: string, label?: string) => Promise<void> }) {
  const socks = `socks5://${encodeURIComponent(slot.login)}:${encodeURIComponent(slot.password)}@${slot.host}:${slot.socksPort}`;
  const http = `http://${encodeURIComponent(slot.login)}:${encodeURIComponent(slot.password)}@${slot.host}:${slot.httpPort}`;
  return <div className="glass-inset rounded-2xl p-4"><p className="font-bold">{slot.host}</p><p className="mt-1 text-xs text-fog-500">до {new Date(slot.expiresAt).toLocaleDateString("ru-RU")}</p><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="ghost" size="sm" onClick={() => copy(socks, "SOCKS5 скопирован")}><Copy /> SOCKS5</Button><Button variant="ghost" size="sm" onClick={() => copy(http, "HTTP скопирован")}><Copy /> HTTP</Button></div></div>;
}

function SingboxSlotCard({ slot, copy }: { slot: SingboxSlot; copy: (text: string, label?: string) => Promise<void> }) {
  return <div className="glass-inset rounded-2xl p-4"><p className="font-bold">{slot.protocol}</p><p className="mt-1 text-xs text-fog-500">до {new Date(slot.expiresAt).toLocaleDateString("ru-RU")} · {bytes(slot.trafficLimitBytes)}</p><Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => copy(slot.subscriptionLink, "Ссылка скопирована")}><KeyRound /> Скопировать подписку</Button></div>;
}

export function ProxyService() { return <NetworkService kind="proxy" />; }
export function SingboxService() { return <NetworkService kind="singbox" />; }

type GiftSubscription = { id: string; subscriptionIndex: number; tariffId: string | null; giftStatus: string | null; createdAt: string };
type GiftCode = { id: string; code: string; status: string; expiresAt: string; giftMessage: string | null; subscriptionId: string };

export function Gifts() {
  const { state, refreshProfile } = useClientAuth();
  const { tariffGroups, reload, copy, toast } = useApp();
  const [subscriptions, setSubscriptions] = useState<GiftSubscription[]>([]);
  const [codes, setCodes] = useState<GiftCode[]>([]);
  const [redeem, setRedeem] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const plans = tariffGroups.flatMap((group) => group.plans);
  const load = async () => {
    if (!state.token) return;
    const [all, giftCodes] = await Promise.all([api.giftListAllSubscriptions(state.token), api.giftListCodes(state.token)]);
    setSubscriptions(all.subscriptions);
    setCodes(giftCodes.codes);
  };
  useEffect(() => { void load(); }, [state.token]);
  const action = async (work: () => Promise<{ message: string }>) => {
    setLoading(true);
    try {
      const result = await work();
      toast({ title: result.message, variant: "success" });
      await Promise.all([load(), refreshProfile(), reload()]);
    } catch (cause) {
      toast({ title: "Операция не выполнена", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally { setLoading(false); }
  };
  return <div className="flex flex-col gap-5"><PageTitle icon={Gift} title="Подарочные подписки" subtitle="Купите подписку, создайте код или активируйте подарок." />
    <section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Активировать код</h2><form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (redeem) void action(() => api.giftRedeemCode(state.token!, redeem)); }}><Input value={redeem} onChange={(event) => setRedeem(event.target.value.trim())} placeholder="Подарочный код" className="flex-1" /><Button type="submit" loading={loading} disabled={!redeem}>Активировать</Button></form></section>
    <section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Купить для подарка</h2><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{plans.map((plan) => <div key={plan.id} className="glass-inset rounded-2xl p-4"><p className="font-bold">{plan.name}</p><p className="mt-1 text-sm text-fog-500">{plan.durationOptions[0]?.days} дней · {plan.baseDevices} устр.</p><p className="mt-3 text-xl font-extrabold">{money(plan.durationOptions[0]?.price ?? plan.monthlyPrice, plan.currency)}</p><Button className="mt-3 w-full" loading={loading} onClick={() => action(() => api.giftBuySubscription(state.token!, { tariffId: plan.id, tariffPriceOptionId: plan.durationOptions[0]?.id ?? undefined }))}><Gift /> Купить с баланса</Button></div>)}</div></section>
    {subscriptions.length > 0 && <section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Мои подарочные подписки</h2><Input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={200} placeholder="Сообщение получателю (необязательно)" className="mt-3" /><div className="mt-3 flex flex-col gap-2">{subscriptions.map((subscription) => <div key={subscription.id} className="glass-inset flex flex-wrap items-center gap-3 rounded-2xl p-4"><div className="min-w-0 flex-1"><p className="font-bold">Подписка #{subscription.subscriptionIndex}</p><p className="text-xs text-fog-500">{subscription.giftStatus || "Готова к использованию"}</p></div><Button size="sm" loading={loading} onClick={() => action(() => api.giftCreateCode(state.token!, subscription.id, message.trim() || undefined))}><Gift /> Создать код</Button>{subscription.giftStatus === "GIFT_RESERVED" && <Button variant="ghost" size="sm" loading={loading} onClick={() => action(() => api.giftActivateForSelf(state.token!, subscription.id))}>Активировать себе</Button>}</div>)}</div></section>}
    {codes.length > 0 && <section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Созданные коды</h2><div className="mt-3 flex flex-col gap-2">{codes.map((code) => <div key={code.id} className="glass-inset flex items-center gap-3 rounded-2xl p-4"><div className="min-w-0 flex-1"><p className="truncate font-mono font-bold">{code.code}</p><p className="text-xs text-fog-500">{code.status} · до {new Date(code.expiresAt).toLocaleDateString("ru-RU")}</p></div><Button variant="ghost" size="icon" onClick={() => copy(code.code, "Код скопирован")} aria-label="Скопировать код"><Copy /></Button>{code.status === "ACTIVE" && <Button variant="ghost" size="sm" loading={loading} onClick={() => action(() => api.giftCancelCode(state.token!, code.id))}>Отменить</Button>}</div>)}</div></section>}
  </div>;
}

type TicketSummary = { id: string; subject: string; status: string; createdAt: string; updatedAt: string };
type TicketDetail = TicketSummary & { messages: TicketMessageDto[] };

export function Tickets() {
  const { state } = useClientAuth();
  const { toast } = useApp();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const load = async () => { if (state.token) setTickets((await api.getTickets(state.token)).items); };
  useEffect(() => { void load(); }, [state.token]);
  const open = async (id: string) => { if (state.token) setSelected(await api.getTicket(state.token, id)); };
  const create = async () => {
    if (!state.token || !subject.trim() || !message.trim()) return;
    setLoading(true);
    try { const ticket = await api.createTicket(state.token, { subject: subject.trim(), message: message.trim(), files }); setSelected(ticket); setSubject(""); setMessage(""); setFiles([]); await load(); }
    catch (cause) { toast({ title: "Не удалось создать обращение", description: cause instanceof Error ? cause.message : undefined, variant: "error" }); }
    finally { setLoading(false); }
  };
  const reply = async () => {
    if (!state.token || !selected || !message.trim()) return;
    setLoading(true);
    try { await api.replyTicket(state.token, selected.id, { content: message.trim(), files }); setMessage(""); setFiles([]); await open(selected.id); await load(); }
    catch (cause) { toast({ title: "Не удалось отправить сообщение", description: cause instanceof Error ? cause.message : undefined, variant: "error" }); }
    finally { setLoading(false); }
  };
  if (selected) return <div className="mx-auto flex max-w-3xl flex-col gap-5"><Button variant="ghost" size="sm" className="w-fit" onClick={() => { setSelected(null); setMessage(""); setFiles([]); }}>← Все обращения</Button><PageTitle icon={MessageCircle} title={selected.subject} subtitle={`Статус: ${selected.status}`} /><section className="glass rounded-4xl p-5"><div className="flex max-h-[55dvh] flex-col gap-3 overflow-y-auto">{selected.messages.map((item) => { const isClientMessage = item.authorType.toLowerCase() === "client"; return <div key={item.id} className={cn("max-w-[85%] rounded-2xl p-3", isClientMessage ? "ml-auto bg-accent-500/20" : "bg-mint-500/12 ring-1 ring-mint-400/20")}><p className={cn("mb-1 text-[10px] font-bold uppercase tracking-wider", isClientMessage ? "text-accent-300" : "text-mint-300")}>{isClientMessage ? "Вы" : "Поддержка"}</p><p className="whitespace-pre-wrap text-sm">{item.content}</p>{(item.attachments ?? []).length > 0 && <div className="mt-2 grid grid-cols-2 gap-2">{item.attachments?.map((attachment) => <a key={attachment.url} href={attachment.url} target="_blank" rel="noopener noreferrer"><img src={attachment.url} alt={attachment.name || "Вложение"} loading="lazy" className="max-h-40 w-full rounded-xl object-cover" /></a>)}</div>}<p className="mt-1 text-[10px] text-fog-600">{new Date(item.createdAt).toLocaleString("ru-RU")}</p></div>; })}</div>{selected.status.toLowerCase() !== "closed" && <div className="mt-4"><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void reply(); }}><Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Сообщение поддержке" className="flex-1" /><Button type="submit" size="icon" loading={loading} disabled={!message.trim()} className="self-end" aria-label="Отправить сообщение"><Send /></Button></form><AttachmentInput files={files} onChange={setFiles} /></div>}</section></div>;
  return <div className="flex flex-col gap-5"><PageTitle icon={Headphones} title="Поддержка" subtitle="Создайте обращение и следите за ответами." /><section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Новое обращение</h2><form onSubmit={(event) => { event.preventDefault(); void create(); }}><Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Тема" className="mt-3" /><Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Опишите вопрос" className="mt-3 min-h-28" /><AttachmentInput files={files} onChange={setFiles} /><Button type="submit" loading={loading} disabled={!subject.trim() || !message.trim()} className="mt-3 w-full sm:w-fit"><Ticket /> Отправить</Button></form></section><section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Мои обращения</h2><div className="mt-3 flex flex-col gap-2">{tickets.map((ticket) => <button key={ticket.id} onClick={() => open(ticket.id)} className="glass-inset flex items-center gap-3 rounded-2xl p-4 text-left"><MessageCircle className="h-5 w-5 text-accent-400" /><span className="min-w-0 flex-1"><span className="block truncate font-bold">{ticket.subject}</span><span className="text-xs text-fog-500">{new Date(ticket.updatedAt).toLocaleString("ru-RU")}</span></span><span className="text-xs font-bold text-fog-400">{ticket.status}</span></button>)}{tickets.length === 0 && <p className="py-5 text-center text-sm text-fog-500">Обращений пока нет.</p>}</div></section></div>;
}

function AttachmentInput({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  // Скрытый input открываем программно — кнопка-обёртка из ui-кита
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => onChange(Array.from(event.target.files ?? []).slice(0, 5))} />
      <Button variant="ghost" size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>
        <Copy className="h-3.5 w-3.5" />
        {files.length > 0 ? `Фото: ${files.length}` : "Прикрепить фото"}
      </Button>
    </>
  );
}
