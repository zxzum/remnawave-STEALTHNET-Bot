import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Bitcoin, Box, CalendarDays, Check, Copy, CreditCard, Gift, Headphones, KeyRound,
  Layers3, MessageCircle, Network, PackagePlus, QrCode, Send, Server, ShieldCheck,
  Signal, Smartphone, Ticket, Wallet, Wifi, X, Zap,
  Loader2,
} from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicSellOption, type TicketMessageDto } from "@/lib/api";
import { preparePaymentRedirect } from "@/lib/open-payment-url";
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

function PageTitle({ icon: Icon, title, subtitle }: { icon: typeof Box; title: string; subtitle: string }) {
  return <div className="flex items-center gap-4"><div className="icon-tile h-12 w-12 rounded-2xl"><Icon className="h-5 w-5" /></div><div><h1 className="text-3xl font-extrabold tracking-tight">{title}</h1><p className="mt-1 text-sm text-fog-500">{subtitle}</p></div></div>;
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
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);

  const finishBalance = async () => {
    if (!state.token) return;
    setLoading(true);
    try {
      const result = await balancePay();
      toast({ title: result.message, variant: "success" });
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
      if (!redirect.isTelegramMiniApp) navigate(`/cabinet/payment-wait?id=${encodeURIComponent(result.paymentId)}&kind=service`, { state: { url, provider, returnPath: location.pathname } });
    } catch (cause) {
      redirect.cancel();
      toast({ title: "Не удалось открыть оплату", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  return <div className="mt-4 flex flex-col gap-2">
    <button disabled={loading || user.balance < amount} onClick={finishBalance} className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 p-3.5 text-sm font-bold text-white disabled:opacity-40">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}<span className="flex-1 text-left">{loading ? "Оплата…" : "С баланса"}</span><span>{money(user.balance, currency)}</span></button>
    {(config?.plategaMethods ?? []).map((method) => <button key={method.id} disabled={loading || !state.token} onClick={() => external("Platega", () => api.clientCreatePlategaPayment(state.token!, { ...payload, paymentMethod: method.id, description }))} className="btn-primary px-4 py-3 text-sm">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} {loading ? "Оплата…" : `Platega · ${method.label}`}</button>)}
    {config?.cryptopayEnabled && <button disabled={loading || !state.token} onClick={() => external("Crypto Bot", () => api.cryptopayCreatePayment(state.token!, payload))} className="btn-ghost px-4 py-3 text-sm">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} {loading ? "Оплата…" : "Crypto Bot"}</button>}
    {config?.rollypayEnabled && currency.toUpperCase() === "RUB" && <button disabled={loading || !state.token} onClick={() => external("RollyPay", () => api.rollypayCreatePayment(state.token!, { ...payload, currency }))} className="btn-ghost px-4 py-3 text-sm">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} {loading ? "Оплата…" : "RollyPay"}</button>}
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
          ? "border-amber-glow/40 bg-amber-glow/8 shadow-[0_0_36px_-12px_rgba(255,181,69,0.55)]"
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
      <p className="mt-4 text-3xl font-extrabold tracking-tight">+{option.trafficGb} ГБ</p>
      <p className="mt-1 truncate text-sm font-semibold text-fog-400">{option.name}</p>
      <div className="my-4 h-px bg-white/8" />
      <div className="mt-auto flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-extrabold tracking-tight">{money(option.price, option.currency)}</p>
          {perGb > 0 && <p className="text-[11px] text-fog-600">{money(perGb, option.currency)}/ГБ</p>}
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onBuy}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-all",
            whitelist
              ? "bg-gradient-to-r from-amber-glow to-amber-500 text-ink-950 shadow-[0_8px_24px_-8px_rgba(255,181,69,0.7)] hover:brightness-105"
              : "bg-white/90 text-ink-950 shadow-[0_8px_24px_-8px_rgba(255,255,255,0.4)] hover:bg-white",
          )}
        >
          <CreditCard className="h-4 w-4" /> Оплатить
        </motion.button>
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
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<"checkout" | "success">("checkout");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (open) setStep("checkout");
  }, [open]);

  if (!option) return null;

  const whitelist = isWhitelistTrafficOption(option);
  const payload = { extraOption: { kind: "traffic" as const, productId: option.id, targetSubscriptionId: targetSubscriptionId || undefined } };
  const plategaMethods = config?.plategaMethods ?? [];
  const { sbp: sbpMethod, card: cardMethod, crypto: cryptoMethod, other: otherPlategaMethods } = groupPlategaMethods(plategaMethods);

  const payBalance = async () => {
    if (!state.token) return;
    setPaying(true);
    try {
      const result = await api.clientPayOptionByBalance(state.token, payload);
      toast({ title: result.message, variant: "success" });
      void Promise.all([refreshProfile(), reload()]).catch(() => undefined);
      setStep("success");
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
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setStep("checkout");
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-md"
          />
        </Dialog.Overlay>
        <Dialog.Content asChild onFocusOutside={(event) => event.preventDefault()}>
          <motion.div
            initial={{ opacity: 0, y: 60, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="glass-strong fixed inset-x-3 bottom-3 z-50 mx-auto flex max-h-[92dvh] max-w-lg flex-col overflow-hidden rounded-4xl sm:inset-x-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
          >
            <AnimatePresence mode="wait" initial={false}>
              {step === "success" ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-7 text-center"
                >
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-mint-500/15 text-mint-400">
                    <Check className="h-8 w-8" strokeWidth={3} />
                  </div>
                  <Dialog.Title className="mt-5 text-2xl font-extrabold">Трафик зачислен</Dialog.Title>
                  <Dialog.Description className="mt-2 text-sm text-fog-500">
                    Пакет «{option.name}» добавлен к выбранной подписке.
                  </Dialog.Description>
                  <button autoFocus onClick={() => onOpenChange(false)} className="btn-primary mt-6 w-full px-6 py-4">
                    Готово
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="checkout"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={{ duration: 0.22 }}
                  className="no-scrollbar min-h-0 overflow-y-auto p-6"
                >
                  <div className="flex items-start gap-4">
                    <div className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-2xl border", whitelist ? "border-amber-glow/30 bg-amber-glow/12 text-amber-glow" : "border-violet-glow/30 bg-violet-glow/12 text-violet-glow")}>
                      {whitelist ? <Signal className="h-6 w-6" /> : <Wifi className="h-6 w-6" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Dialog.Title className="text-2xl font-extrabold tracking-tight">{option.name}</Dialog.Title>
                      <Dialog.Description className="mt-0.5 text-xs text-fog-500">{trafficOptionLabel(option.trafficMode)}</Dialog.Description>
                    </div>
                    <Dialog.Close className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-fog-500 transition-colors hover:bg-white/8 hover:text-white">
                      <X className="h-5 w-5" />
                    </Dialog.Close>
                  </div>

                  <div className="glass-inset mt-5 rounded-3xl p-5">
                    <p className="text-sm text-fog-500">Итого к оплате</p>
                    <p className="mt-1 text-4xl font-extrabold tracking-tight">{money(option.price, option.currency)}</p>
                    <div className="mt-4 grid grid-cols-2 gap-2.5">
                      <div className="flex flex-col justify-center rounded-2xl border border-white/8 bg-white/3 p-3">
                        <p className="text-[10px] font-bold tracking-wider text-fog-600 uppercase">Трафик</p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm font-bold">
                          <Wifi className="h-4 w-4 text-fog-500" /> +{option.trafficGb} ГБ
                        </p>
                      </div>
                      <div className="flex flex-col justify-center rounded-2xl border border-white/8 bg-white/3 p-3">
                        <p className="text-[10px] font-bold tracking-wider text-fog-600 uppercase">Назначение</p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm font-bold">
                          <Signal className={cn("h-4 w-4", whitelist ? "text-amber-glow" : "text-fog-500")} /> {trafficOptionLabel(option.trafficMode)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="mt-6 mb-2 flex items-center gap-2 text-sm font-bold">
                    <Wallet className="h-4 w-4 text-fog-500" /> Способ оплаты
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {user.balance > 0 && (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={paying || user.balance < option.price}
                        onClick={payBalance}
                        className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 p-4 text-left font-bold text-white shadow-[0_0_28px_-8px_rgba(249,115,22,0.7)] transition-filter hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wallet className="h-5 w-5" />}
                        <span className="flex-1">{paying ? "Оплата…" : "Оплатить с баланса"}</span>
                        <span className="rounded-lg bg-black/25 px-2.5 py-1 text-sm">
                          {user.balance.toLocaleString("ru-RU")} ₽
                        </span>
                      </motion.button>
                    )}

                    {plategaMethods.length > 0 && <div className="rounded-3xl border border-accent-400/40 bg-accent-500/8 p-4 shadow-neon-blue">
                      <div className="mb-3 flex items-center gap-2.5">
                        <div className="icon-tile h-10 w-10 rounded-xl">
                          <CreditCard className="h-5 w-5" />
                        </div>
                        <div className="flex-1">
                          <p className="font-bold">Platega</p>
                          <p className="text-[11px] text-fog-500">Банковские платежи и крипта</p>
                        </div>
                        <span className="rounded-full bg-accent-500/20 px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-accent-400 uppercase">
                          Рекомендуем
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        {sbpMethod && <motion.button
                          whileTap={{ scale: 0.96 }}
                          disabled={paying}
                          onClick={() => payPlatega(sbpMethod.id)}
                          className="btn-primary flex-col gap-0.5 rounded-2xl px-3 py-3.5 text-sm"
                        >
                          <span className="flex items-center gap-1.5 font-bold">
                            {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />} {paying ? "Оплата…" : "СБП"}
                          </span>
                          <span className="text-[10px] font-medium opacity-75">по QR-коду</span>
                        </motion.button>}
                        {cardMethod && <motion.button
                          whileTap={{ scale: 0.96 }}
                          disabled={paying}
                          onClick={() => payPlatega(cardMethod.id)}
                          className="btn-primary flex-col gap-0.5 rounded-2xl px-3 py-3.5 text-sm"
                        >
                          <span className="flex items-center gap-1.5 font-bold">
                            {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} {paying ? "Оплата…" : "Карта"}
                          </span>
                          <span className="text-[10px] font-medium opacity-75">RUB · любой банк</span>
                        </motion.button>}
                      </div>
                      {cryptoMethod && <button
                        disabled={paying}
                        onClick={() => payPlatega(cryptoMethod.id)}
                        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-semibold text-fog-400 transition-colors hover:text-accent-400"
                      >
                        {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bitcoin className="h-3.5 w-3.5" />} {paying ? "Оплата…" : "Оплатить криптой через Platega"}
                      </button>}
                      {otherPlategaMethods.length > 0 && <div className="mt-2.5 grid grid-cols-1 gap-2">
                        {otherPlategaMethods.map((method) => (
                          <button
                            key={method.id}
                            disabled={paying}
                            onClick={() => payPlatega(method.id)}
                            className="rounded-xl border border-accent-400/20 bg-accent-500/8 px-3 py-2 text-sm font-semibold transition-colors hover:bg-accent-500/15"
                          >
                            {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {paying ? "Оплата…" : method.label}
                          </button>
                        ))}
                      </div>}
                    </div>}

                    {config?.cryptopayEnabled && <button
                      disabled={paying}
                      onClick={payCryptoBot}
                      className="glass group flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:border-amber-glow/30"
                    >
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-glow/25 bg-amber-glow/10 text-amber-glow">
                        {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold">{paying ? "Оплата…" : "Crypto Bot"}</p>
                        <p className="text-xs text-fog-500">USDT · TON · BTC</p>
                      </div>
                    </button>}
                    {config?.rollypayEnabled && option.currency.toUpperCase() === "RUB" && <button
                      disabled={paying}
                      onClick={payRollyPay}
                      className="glass group flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:border-emerald-400/30"
                    >
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
                        {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold">{paying ? "Оплата…" : "RollyPay"}</p>
                        <p className="text-xs text-fog-500">Оплата в рублях</p>
                      </div>
                    </button>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
  useEffect(() => {
    const pool = trafficOnly ? subscriptions.filter((item) => item.status === "active") : subscriptions;
    if (!pool.some((item) => item.id === target)) setTarget(pool[0]?.id ?? "");
  }, [subscriptions, target, trafficOnly]);
  return <div className="flex flex-col gap-5"><PageTitle icon={PackagePlus} title={trafficOnly ? "Докупить трафик" : "Дополнительные опции"} subtitle={trafficOnly ? "Пакеты трафика для выбранной подписки." : "Трафик, устройства и серверы для выбранной подписки."} />
    {selectableSubscriptions.length > 1 && <select value={target} onChange={(event) => setTarget(event.target.value)} className="input-glass"><option value="">Выберите подписку</option>{selectableSubscriptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{options.map((option) => <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={`${option.kind}:${option.id}`} className="glass rounded-4xl p-5"><div className="icon-tile h-11 w-11 rounded-xl">{option.kind === "traffic" ? <Wifi className="h-5 w-5" /> : option.kind === "devices" ? <Smartphone className="h-5 w-5" /> : <Server className="h-5 w-5" />}</div><h2 className="mt-4 text-lg font-extrabold">{option.name}</h2><p className="mt-1 text-sm text-fog-500">{optionDescription(option)}</p><p className="mt-4 text-2xl font-extrabold">{money(option.price, option.currency)}</p><CheckoutActions amount={option.price} currency={option.currency} description={option.name} payload={{ extraOption: { kind: option.kind, productId: option.id, targetSubscriptionId: target || undefined } }} balancePay={() => api.clientPayOptionByBalance(state.token!, { extraOption: { kind: option.kind, productId: option.id }, targetSubscriptionId: target || undefined })} /></motion.section>)}</div>
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
