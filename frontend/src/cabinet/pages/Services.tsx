import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Box, CalendarDays, Copy, CreditCard, Gift, Headphones, KeyRound,
  Layers3, MessageCircle, Network, PackagePlus, Send, Server, ShieldCheck,
  Smartphone, Ticket, Wifi, X,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicSellOption, type TicketMessageDto } from "@/lib/api";
import { preparePaymentRedirect } from "@/lib/open-payment-url";
import { canBuyTrafficOption, resolvePaymentUrl, trafficOptionLabel, trafficOptionUnitPrice } from "../model";
import { useApp } from "../store/AppContext";
import { cn } from "../lib/cn";
import { PaymentMethods } from "../components/PaymentMethods";

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toLocaleString("ru-RU")} ${currency.toUpperCase()}`;
  }
}

function PageTitle({ icon: Icon, title, subtitle, compact = false }: { icon: typeof Box; title: string; subtitle: string; compact?: boolean }) {
  return <div className={cn("flex items-center", compact ? "gap-3" : "gap-4")}><div className={cn("icon-tile rounded-2xl", compact ? "h-9 w-9 rounded-xl" : "h-12 w-12")}><Icon className={compact ? "h-4 w-4" : "h-5 w-5"} /></div><div><h1 className={cn("font-extrabold tracking-tight", compact ? "text-2xl" : "text-3xl")}>{title}</h1><p className={cn("text-fog-500", compact ? "mt-0.5 text-xs" : "mt-1 text-sm")}>{subtitle}</p></div></div>;
}

type PurchasePayload = {
  tariffId?: string;
  proxyTariffId?: string;
  singboxTariffId?: string;
  extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string; targetSubscriptionId?: string };
  customBuild?: { days: number; devices: number; trafficGb?: number };
};

function OptionPaymentDialog({
  open,
  onOpenChange,
  amount,
  currency,
  payload,
  balancePay,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: number;
  currency: string;
  payload: PurchasePayload;
  balancePay: () => Promise<{ message: string }>;
  description: string;
}) {
  const { state, refreshProfile } = useClientAuth();
  const { user, config, reload, toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);

  const finishBalance = async () => {
    if (!state.token) return;
    setLoading(true);
    try {
      const result = await balancePay();
      toast({ title: result.message, variant: "success" });
      onOpenChange(false);
      void Promise.all([refreshProfile(), reload()]).catch(() => undefined);
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
      if (!redirect.isTelegramMiniApp) {
        navigate(`/cabinet/payment-wait?id=${encodeURIComponent(result.paymentId)}&kind=service`, { state: { url, provider, returnPath: location.pathname } });
        onOpenChange(false);
      }
    } catch (cause) {
      redirect.cancel();
      toast({ title: "Не удалось открыть оплату", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay asChild>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-md" />
      </Dialog.Overlay>
      <Dialog.Content asChild>
        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="glass-strong fixed inset-x-3 bottom-3 z-50 mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-4xl p-6 focus:outline-none sm:inset-x-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
        >
          <div className="flex items-start gap-4">
            <div className="icon-tile h-12 w-12 shrink-0 rounded-2xl"><CreditCard className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-2xl font-extrabold tracking-tight">Выберите способ оплаты</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fog-500">{description} · {money(amount, currency)}</Dialog.Description>
            </div>
            <Dialog.Close asChild><button type="button" aria-label="Закрыть" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-fog-400 transition-colors hover:bg-white/8 hover:text-white"><X className="h-5 w-5" /></button></Dialog.Close>
          </div>
          <div className="mt-6">
            <PaymentMethods
              amount={amount}
              currency={currency}
              balance={user.balance}
              plategaMethods={config?.plategaMethods ?? []}
              loading={loading}
              disabled={!state.token}
              onBalance={finishBalance}
              onPlatega={(methodId) => external("Platega", () => api.clientCreatePlategaPayment(state.token!, { ...payload, paymentMethod: methodId, description }))}
              onCryptoBot={config?.cryptopayEnabled ? () => external("Crypto Bot", () => api.cryptopayCreatePayment(state.token!, payload)) : undefined}
              onRollyPay={config?.rollypayEnabled && currency.toUpperCase() === "RUB" ? () => external("RollyPay", () => api.rollypayCreatePayment(state.token!, { ...payload, currency })) : undefined}
            />
          </div>
        </motion.div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

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
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="btn-ghost mt-2.5 min-h-11 w-full justify-center rounded-xl px-3 py-2.5 text-xs">Перейти к оплате · {money(amount, currency)}</button>
    <OptionPaymentDialog open={open} onOpenChange={setOpen} amount={amount} currency={currency} payload={payload} balancePay={balancePay} description={description} />
  </>;
}

function optionDescription(option: PublicSellOption) {
  if (option.kind === "traffic") return `+${option.trafficGb} ГБ трафика`;
  if (option.kind === "devices") return `+${option.deviceCount} устройств`;
  return option.trafficGb ? `Дополнительный сервер · ${option.trafficGb} ГБ` : "Дополнительный сервер";
}

export function ExtraOptions({ trafficOnly = false }: { trafficOnly?: boolean } = {}) {
  const { state } = useClientAuth();
  const { config, subscriptions } = useApp();
  const activeSubscriptions = subscriptions.filter((item) => item.status === "active");
  const selectableSubscriptions = trafficOnly ? activeSubscriptions : subscriptions;
  const [target, setTarget] = useState((trafficOnly ? activeSubscriptions : subscriptions)[0]?.id ?? "");
  const targetSubscription = selectableSubscriptions.find((item) => item.id === target) ?? selectableSubscriptions[0];
  const options = (config?.sellOptions ?? []).filter((option) => {
    if (trafficOnly && option.kind !== "traffic") return false;
    if (trafficOnly && !targetSubscription) return false;
    return option.kind !== "traffic" || canBuyTrafficOption(option, targetSubscription);
  });
  useEffect(() => {
    const pool = trafficOnly ? subscriptions.filter((item) => item.status === "active") : subscriptions;
    if (!pool.some((item) => item.id === target)) setTarget(pool[0]?.id ?? "");
  }, [subscriptions, target, trafficOnly]);

  const trafficSummary = targetSubscription
    ? [
        targetSubscription.trafficLimitGB !== null
          ? `${targetSubscription.trafficLimitGB.toFixed(0)} ГБ обычного интернета`
          : targetSubscription.trafficLimitMode === "REMNAWAVE" ? "Обычный интернет без лимита" : null,
        targetSubscription.whitelistGB !== null ? `${targetSubscription.whitelistGB.toFixed(0)} ГБ белых списков` : null,
      ].filter(Boolean).join(" · ") || "Лимиты уточняются после подключения"
    : null;

  return <div className="flex flex-col gap-5">
    <PageTitle compact={trafficOnly} icon={PackagePlus} title={trafficOnly ? "Докупить трафик" : "Дополнительные опции"} subtitle={trafficOnly ? "Пакеты для активной подписки." : "Трафик, устройства и серверы для выбранной подписки."} />

    {trafficOnly && (
      <section className="glass-inset flex flex-wrap items-center gap-3 rounded-2xl p-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="icon-tile h-9 w-9 shrink-0 rounded-xl"><Wifi className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-xs text-fog-500">Для подписки</p>
            <p className="truncate font-extrabold">{targetSubscription?.name ?? "Нет активной подписки"}</p>
            <p className="text-xs text-fog-500">{trafficSummary ?? "Сначала выберите тариф"}</p>
          </div>
        </div>
        {selectableSubscriptions.length > 1 && (
          <label className="ml-auto w-full shrink-0 sm:w-52">
            <span className="sr-only">Выберите подписку</span>
            <select aria-label="Выберите подписку" value={target} onChange={(event) => setTarget(event.target.value)} className="input-glass min-h-11">
              {selectableSubscriptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
      </section>
    )}

    {trafficOnly && targetSubscription && <p className="-mt-2 text-xs leading-relaxed text-fog-500">Пакет добавится к текущему лимиту; срок и устройства не изменятся.</p>}

    {!trafficOnly && selectableSubscriptions.length > 1 && (
      <label className="w-full sm:max-w-xs">
        <span className="mb-1.5 block text-xs font-semibold text-fog-500">Для какой подписки</span>
        <select aria-label="Выберите подписку" value={target} onChange={(event) => setTarget(event.target.value)} className="input-glass">
          {selectableSubscriptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    )}

    <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
      {options.map((option) => {
        const isTraffic = option.kind === "traffic";
        const trafficPrice = isTraffic ? trafficOptionUnitPrice(option.trafficGb, option.price) : 0;
        return <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={`${option.kind}:${option.id}`} className="glass-inset flex flex-col rounded-2xl p-3.5">
          <div className="flex items-start gap-3">
            <div className="icon-tile h-9 w-9 shrink-0 rounded-xl">{isTraffic ? <Wifi className="h-4 w-4" /> : option.kind === "devices" ? <Smartphone className="h-4 w-4" /> : <Server className="h-4 w-4" />}</div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-extrabold">{isTraffic ? `+${option.trafficGb} ГБ` : option.name}</h2>
              <p className="mt-0.5 text-xs text-fog-400">{isTraffic ? trafficOptionLabel(option.trafficMode) : optionDescription(option)}</p>
              {isTraffic && <p className="mt-0.5 text-[11px] text-fog-600">{option.name} · ≈{money(trafficPrice, option.currency)}/ГБ</p>}
            </div>
            <div className="shrink-0 text-right"><p className="text-base font-extrabold">{money(option.price, option.currency)}</p><p className="text-[11px] text-fog-600">разово</p></div>
          </div>
          <div className="mt-auto pt-3">
            <CheckoutActions amount={option.price} currency={option.currency} description={option.name} payload={{ extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId: target || undefined } }} balancePay={() => api.clientPayOptionByBalance(state.token!, { extraOption: { kind: option.kind, productId: option.id }, targetSubscriptionId: target || undefined })} />
          </div>
        </motion.section>;
      })}
    </div>

    {config && options.length === 0 && <div className="glass rounded-4xl p-7 text-center text-fog-500">
      {trafficOnly && !targetSubscription ? "Сначала подключите тариф — после этого здесь появятся пакеты трафика." : "Для выбранной подписки подходящих пакетов сейчас нет."}
    </div>}
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
  return <div className="mx-auto flex max-w-2xl flex-col gap-5"><PageTitle icon={Layers3} title="Собери свой тариф" subtitle="Настройте срок, устройства и трафик под себя." /><section className="glass rounded-4xl p-6"><Range label="Срок" value={days} min={1} max={build.maxDays} onChange={setDays} suffix="дн." icon={CalendarDays} /><Range label="Устройства" value={devices} min={1} max={build.maxDevices} onChange={setDevices} suffix="шт." icon={Smartphone} />{build.trafficMode === "per_gb" && <div className="mt-5"><label className="mb-2 block text-sm font-bold">Трафик, ГБ</label><input className="input-glass" type="number" min={1} max={1000} value={traffic} onChange={(event) => setTraffic(Math.max(1, Number(event.target.value) || 1))} /></div>}<div className="glass-inset mt-6 flex items-center justify-between rounded-2xl p-4"><span className="font-bold">Итого</span><span className="text-3xl font-extrabold">{money(total, build.currency)}</span></div><CheckoutActions amount={total} currency={build.currency} description="Индивидуальный тариф" payload={{ customBuild: payload }} balancePay={() => api.customBuildPayBalance(state.token!, payload)} /></section></div>;
}

function Range({ label, value, min, max, onChange, suffix, icon: Icon }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; suffix: string; icon: typeof Box }) {
  return <div className="mt-5 first:mt-0"><div className="mb-2 flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-bold"><Icon className="h-4 w-4" />{label}</span><span>{value} {suffix}</span></div><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-blue-500" /></div>;
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
        return <section key={tariff.id} className="glass rounded-4xl p-5"><div className="icon-tile h-11 w-11 rounded-xl">{proxy ? <Network className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}</div><h2 className="mt-4 text-lg font-extrabold">{tariff.name}</h2><p className="mt-1 text-sm text-fog-500">{count} {proxy ? "прокси" : "слотов"} · {tariff.durationDays} дней · {bytes(tariff.trafficLimitBytes)}</p><p className="mt-4 text-2xl font-extrabold">{money(tariff.price, tariff.currency)}</p><CheckoutActions amount={tariff.price} currency={tariff.currency} payload={payload} description={tariff.name} balancePay={() => api.clientPayByBalance(state.token!, payload)} /></section>;
      })}</div>
      {tariffs.length === 0 && <div className="glass rounded-4xl p-7 text-center text-fog-500">Нет доступных тарифов.</div>}
    </>}
  </div>;
}

function ProxySlotCard({ slot, copy }: { slot: ProxySlot; copy: (text: string, label?: string) => Promise<void> }) {
  const socks = `socks5://${encodeURIComponent(slot.login)}:${encodeURIComponent(slot.password)}@${slot.host}:${slot.socksPort}`;
  const http = `http://${encodeURIComponent(slot.login)}:${encodeURIComponent(slot.password)}@${slot.host}:${slot.httpPort}`;
  return <div className="glass-inset rounded-2xl p-4"><p className="font-bold">{slot.host}</p><p className="mt-1 text-xs text-fog-500">до {new Date(slot.expiresAt).toLocaleDateString("ru-RU")}</p><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => copy(socks, "SOCKS5 скопирован")} className="btn-ghost px-3 py-2 text-xs"><Copy className="h-3.5 w-3.5" /> SOCKS5</button><button onClick={() => copy(http, "HTTP скопирован")} className="btn-ghost px-3 py-2 text-xs"><Copy className="h-3.5 w-3.5" /> HTTP</button></div></div>;
}

function SingboxSlotCard({ slot, copy }: { slot: SingboxSlot; copy: (text: string, label?: string) => Promise<void> }) {
  return <div className="glass-inset rounded-2xl p-4"><p className="font-bold">{slot.protocol}</p><p className="mt-1 text-xs text-fog-500">до {new Date(slot.expiresAt).toLocaleDateString("ru-RU")} · {bytes(slot.trafficLimitBytes)}</p><button onClick={() => copy(slot.subscriptionLink, "Ссылка скопирована")} className="btn-ghost mt-3 w-full px-3 py-2 text-xs"><KeyRound className="h-3.5 w-3.5" /> Скопировать подписку</button></div>;
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
    <section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Активировать код</h2><div className="mt-3 flex gap-2"><input value={redeem} onChange={(event) => setRedeem(event.target.value.trim())} placeholder="Подарочный код" className="input-glass flex-1" /><button disabled={loading || !redeem} onClick={() => action(() => api.giftRedeemCode(state.token!, redeem))} className="btn-primary px-5 text-sm">Активировать</button></div></section>
    <section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Купить для подарка</h2><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{plans.map((plan) => <div key={plan.id} className="glass-inset rounded-2xl p-4"><p className="font-bold">{plan.name}</p><p className="mt-1 text-sm text-fog-500">{plan.durationOptions[0]?.days} дней · {plan.baseDevices} устр.</p><p className="mt-3 text-xl font-extrabold">{money(plan.durationOptions[0]?.price ?? plan.monthlyPrice, plan.currency)}</p><button disabled={loading} onClick={() => action(() => api.giftBuySubscription(state.token!, { tariffId: plan.id, tariffPriceOptionId: plan.durationOptions[0]?.id ?? undefined }))} className="btn-primary mt-3 w-full px-4 py-2.5 text-sm"><Gift className="h-4 w-4" /> Купить с баланса</button></div>)}</div></section>
    {subscriptions.length > 0 && <section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Мои подарочные подписки</h2><input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={200} placeholder="Сообщение получателю (необязательно)" className="input-glass mt-3" /><div className="mt-3 flex flex-col gap-2">{subscriptions.map((subscription) => <div key={subscription.id} className="glass-inset flex flex-wrap items-center gap-3 rounded-2xl p-4"><div className="min-w-0 flex-1"><p className="font-bold">Подписка #{subscription.subscriptionIndex}</p><p className="text-xs text-fog-500">{subscription.giftStatus || "Готова к использованию"}</p></div><button disabled={loading} onClick={() => action(() => api.giftCreateCode(state.token!, subscription.id, message.trim() || undefined))} className="btn-primary px-4 py-2 text-xs"><Gift className="h-3.5 w-3.5" /> Создать код</button>{subscription.giftStatus === "GIFT_RESERVED" && <button disabled={loading} onClick={() => action(() => api.giftActivateForSelf(state.token!, subscription.id))} className="btn-ghost px-4 py-2 text-xs">Активировать себе</button>}</div>)}</div></section>}
    {codes.length > 0 && <section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Созданные коды</h2><div className="mt-3 flex flex-col gap-2">{codes.map((code) => <div key={code.id} className="glass-inset flex items-center gap-3 rounded-2xl p-4"><div className="min-w-0 flex-1"><p className="truncate font-mono font-bold">{code.code}</p><p className="text-xs text-fog-500">{code.status} · до {new Date(code.expiresAt).toLocaleDateString("ru-RU")}</p></div><button onClick={() => copy(code.code, "Код скопирован")} className="btn-ghost px-3 py-2 text-xs"><Copy className="h-3.5 w-3.5" /></button>{code.status === "ACTIVE" && <button disabled={loading} onClick={() => action(() => api.giftCancelCode(state.token!, code.id))} className="btn-ghost px-3 py-2 text-xs">Отменить</button>}</div>)}</div></section>}
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
  if (selected) return <div className="mx-auto flex max-w-3xl flex-col gap-5"><button onClick={() => { setSelected(null); setMessage(""); setFiles([]); }} className="w-fit text-sm font-bold text-fog-400">← Все обращения</button><PageTitle icon={MessageCircle} title={selected.subject} subtitle={`Статус: ${selected.status}`} /><section className="glass rounded-4xl p-5"><div className="flex max-h-[55dvh] flex-col gap-3 overflow-y-auto">{selected.messages.map((item) => { const isClientMessage = item.authorType.toLowerCase() === "client"; return <div key={item.id} className={cn("max-w-[85%] rounded-2xl p-3", isClientMessage ? "ml-auto bg-accent-500/20" : "bg-mint-500/12 ring-1 ring-mint-400/20")}><p className={cn("mb-1 text-[10px] font-bold uppercase tracking-wider", isClientMessage ? "text-accent-300" : "text-mint-300")}>{isClientMessage ? "Вы" : "Поддержка"}</p><p className="whitespace-pre-wrap text-sm">{item.content}</p>{(item.attachments ?? []).length > 0 && <div className="mt-2 grid grid-cols-2 gap-2">{item.attachments?.map((attachment) => <a key={attachment.url} href={attachment.url} target="_blank" rel="noopener noreferrer"><img src={attachment.url} alt={attachment.name || "Вложение"} loading="lazy" className="max-h-40 w-full rounded-xl object-cover" /></a>)}</div>}<p className="mt-1 text-[10px] text-fog-600">{new Date(item.createdAt).toLocaleString("ru-RU")}</p></div>; })}</div>{selected.status.toLowerCase() !== "closed" && <div className="mt-4"><div className="flex gap-2"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Сообщение поддержке" className="input-glass min-h-20 flex-1 resize-none" /><button disabled={loading || !message.trim()} onClick={reply} className="btn-primary self-end p-3"><Send className="h-4 w-4" /></button></div><AttachmentInput files={files} onChange={setFiles} /></div>}</section></div>;
  return <div className="flex flex-col gap-5"><PageTitle icon={Headphones} title="Поддержка" subtitle="Создайте обращение и следите за ответами." /><section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Новое обращение</h2><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Тема" className="input-glass mt-3" /><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Опишите вопрос" className="input-glass mt-3 min-h-28 resize-none" /><AttachmentInput files={files} onChange={setFiles} /><button disabled={loading || !subject.trim() || !message.trim()} onClick={create} className="btn-primary mt-3 px-5 py-3 text-sm"><Ticket className="h-4 w-4" /> Отправить</button></section><section className="glass rounded-4xl p-5"><h2 className="font-extrabold">Мои обращения</h2><div className="mt-3 flex flex-col gap-2">{tickets.map((ticket) => <button key={ticket.id} onClick={() => open(ticket.id)} className="glass-inset flex items-center gap-3 rounded-2xl p-4 text-left"><MessageCircle className="h-5 w-5 text-accent-400" /><span className="min-w-0 flex-1"><span className="block truncate font-bold">{ticket.subject}</span><span className="text-xs text-fog-500">{new Date(ticket.updatedAt).toLocaleString("ru-RU")}</span></span><span className="text-xs font-bold text-fog-400">{ticket.status}</span></button>)}{tickets.length === 0 && <p className="py-5 text-center text-sm text-fog-500">Обращений пока нет.</p>}</div></section></div>;
}

function AttachmentInput({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  return <label className="btn-ghost mt-3 inline-flex cursor-pointer px-4 py-2 text-xs"><input type="file" accept="image/*" multiple className="hidden" onChange={(event) => onChange(Array.from(event.target.files ?? []).slice(0, 5))} /><Copy className="h-3.5 w-3.5" />{files.length > 0 ? `Фото: ${files.length}` : "Прикрепить фото"}</label>;
}
