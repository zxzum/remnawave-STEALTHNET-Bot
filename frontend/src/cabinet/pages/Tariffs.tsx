import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import * as Accordion from "@radix-ui/react-accordion";
import * as Dialog from "@radix-ui/react-dialog";
import * as Checkbox from "@radix-ui/react-checkbox";
import { useClientAuth } from "@/contexts/client-auth";
import { ApiError, api, type ManualConversionQuote, type ManualConversionResult, type PublicConfig, type TariffConversionPreview } from "@/lib/api";
import {
  Box,
  ChevronDown,
  X,
  CalendarDays,
  Wifi,
  Signal,
  Smartphone,
  CreditCard,
  Check,
  ArrowLeft,
  RefreshCw,
  Tag,
  Wallet,
  Loader2,
  Zap,
  Sparkles,
  Flame,
  QrCode,
  Bitcoin,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useApp } from "../store/AppContext";
import { conversionTargets, quoteTariff, resolvePaymentUrl, type CabinetSubscription, type TariffGroup, type TariffPlan } from "../model";
import { preparePaymentRedirect } from "@/lib/open-payment-url";
import { ExtraOptions } from "./Services";

function durationPrice(plan: TariffPlan, days: number, extraDevices: number) {
  return quoteTariff(plan, days, extraDevices).total;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString("ru-RU")} ${currency.toUpperCase()}`;
  }
}

/* ---------------- Конфигуратор + оплата ---------------- */

export function PlanDialog({ plan, open, onOpenChange }: { plan: TariffPlan | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user, subscriptions, toast, reload } = useApp();
  const { state, refreshProfile } = useClientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<"config" | "checkout" | "success">("config");
  const [days, setDays] = useState(30);
  const [extra, setExtra] = useState(0);
  const [agreed, setAgreed] = useState(true);
  const [promo, setPromo] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountFixed, setDiscountFixed] = useState(0);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [paying, setPaying] = useState(false);
  const [conversion, setConversion] = useState<TariffConversionPreview | null>(null);
  const [keepExistingExtras, setKeepExistingExtras] = useState(true);
  const [selectedTrialId, setSelectedTrialId] = useState<string | null>(null);
  const [pendingPaymentId, setPendingPaymentId] = useState<string | null>(null);
  const [manualQuote, setManualQuote] = useState<ManualConversionQuote | null>(null);
  const [manualResult, setManualResult] = useState<ManualConversionResult | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  useEffect(() => { if (open) void api.getPublicConfig().then(setConfig).catch(() => undefined); }, [open]);
  useEffect(() => {
    if (plan?.durationOptions.length) setDays(plan.durationOptions[0].days);
  }, [plan]);

  const ownedSub = useMemo(
    () => subscriptions.find((s) => s.tariffId === plan?.id || s.plan.toLowerCase() === plan?.name.toLowerCase()),
    [subscriptions, plan],
  );
  const explicitTarget = useMemo(() => {
    const id = searchParams.get("extend");
    return id ? subscriptions.find((subscription) => subscription.id === id) ?? null : null;
  }, [searchParams, subscriptions]);
  const selectedOptionId = plan?.durationOptions.find((option) => option.days === days)?.id
    ?? plan?.durationOptions[0]?.id
    ?? null;

  useEffect(() => {
    if (!open || !plan || !state.token) {
      setConversion(null);
      setManualQuote(null);
      return;
    }
    let current = true;
    setKeepExistingExtras(true);
    setManualQuote(null);
    setManualResult(null);
    void api.clientTariffConversionPreview(state.token, {
      tariffId: plan.id,
      priceOptionId: selectedOptionId ?? undefined,
    }).then((preview) => {
      if (current) setConversion(preview);
      if (!preview.willConvert || !preview.subscription?.id) return null;
      return api.clientSubscriptionConversionQuote(state.token!, {
        subscriptionId: preview.subscription.id,
        tariffId: plan.id,
        priceOptionId: selectedOptionId,
      }).then((quote) => {
        if (current) setManualQuote(quote);
      }).catch(() => {
        if (current) setManualQuote(null);
      });
    }).catch(() => {
      if (current) setConversion(null);
    });
    return () => { current = false; };
  }, [open, plan, selectedOptionId, state.token]);

  useEffect(() => {
    if (!pendingPaymentId || !state.token) return;
    let active = true;
    let timeout = 0;
    const check = async () => {
      try {
        const payment = await api.getPaymentStatus(state.token!, pendingPaymentId);
        if (!active) return;
        if (payment.status === "PAID" && payment.fulfilled) {
          setPendingPaymentId(null);
          await Promise.all([refreshProfile(), reload()]);
          if (active) setStep("success");
          return;
        }
        if (payment.status === "FAILED") {
          setPendingPaymentId(null);
          toast({ title: "Платёж не прошёл", variant: "error" });
          return;
        }
      } catch { /* callback или сверка ещё обрабатываются */ }
      if (active) timeout = window.setTimeout(check, 2500);
    };
    void check();
    return () => { active = false; window.clearTimeout(timeout); };
  }, [pendingPaymentId, refreshProfile, reload, state.token, toast]);

  if (!plan) return null;

  const quote = quoteTariff(plan, days, extra);
  const basePrice = quote.total;
  const conversionExtraCost = conversion?.willConvert && keepExistingExtras
    ? conversion.extras?.keep.extraCost ?? 0
    : 0;
  const priceBeforePromo = basePrice + conversionExtraCost;
  const price = Math.max(0, Math.round((priceBeforePromo * (1 - discountPercent / 100) - discountFixed) * 100) / 100);
  const totalDevices = plan.baseDevices + extra;
  const selectedOption = plan.durationOptions.find((option) => option.days === days) ?? plan.durationOptions[0];
  const promoCode = discountPercent > 0 || discountFixed > 0 ? promo.trim() : undefined;
  const trialSubscriptions = subscriptions.filter((subscription) => subscription.isTrial);
  const trialConversionCandidates = trialSubscriptions.filter((subscription) => (
    subscription.trialConvertEnabled
    && (subscription.tariffId === plan.id
      || subscription.trialConvertAllTariffs
      || subscription.convertTariffIds.includes(plan.id))
  ));
  const trialExtensionId = trialConversionCandidates.find((subscription) => subscription.id === selectedTrialId)?.id
    ?? trialConversionCandidates[0]?.id
    ?? null;
  const conversionExtension = conversion?.willConvert && conversion.subscription?.isTrial
    ? conversion.subscription.id
    : conversion?.willConvert && conversion.mode === "extend"
    ? conversion.subscription?.id
    : null;
  const extensionId = explicitTarget?.id
    ?? conversionExtension
    ?? trialExtensionId
    ?? (ownedSub?.source.type === "secondary" ? ownedSub.id : null);
  const purchaseMode = extensionId
    ? {
        extendsSecondarySubId: extensionId,
        ...(conversion?.extras?.extraDevices ? { removeExtrasOnActivate: !keepExistingExtras } : {}),
      }
    : {
        ...(!conversion?.willConvert && subscriptions.length > 0 ? { asAdditional: true } : {}),
        ...(conversion?.willConvert && conversion.extras?.extraDevices ? { removeExtrasOnActivate: !keepExistingExtras } : {}),
        ...(!conversion?.willConvert && trialSubscriptions.length > 0
          ? { replaceTrialSubId: selectedTrialId ?? trialSubscriptions[0].id }
          : {}),
      };

  const reset = () => {
    setStep("config");
    setDays(plan.durationOptions[0]?.days ?? 30);
    setExtra(0);
    setPromo("");
    setDiscountPercent(0);
    setDiscountFixed(0);
    setConversion(null);
    setKeepExistingExtras(true);
    setSelectedTrialId(null);
    setManualQuote(null);
    setManualResult(null);
    setManualBusy(false);
  };

  const applyPromo = async () => {
    if (!state.token || !promo.trim()) return;
    try {
      const result = await api.clientCheckPromoCode(state.token, promo.trim());
      if (result.type === "DISCOUNT") {
        setDiscountPercent(result.discountPercent ?? 0);
        setDiscountFixed(result.discountFixed ?? 0);
        toast({ title: "Промокод применён", description: result.name, variant: "success" });
      } else {
        const activated = await api.clientActivatePromoCode(state.token, promo.trim());
        toast({ title: "Промокод активирован", description: activated.message, variant: "success" });
        setPromo("");
        await Promise.all([refreshProfile(), reload()]);
      }
    } catch (cause) {
      toast({ title: "Промокод не применён", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
      setDiscountPercent(0);
      setDiscountFixed(0);
    }
  };

  const purchasePayload = {
    tariffId: plan.id,
    tariffPriceOptionId: selectedOption?.id ?? undefined,
    deviceCount: extra,
    promoCode,
    ...purchaseMode,
  };

  const payBalance = async () => {
    if (!state.token) return;
    setPaying(true);
    try {
      const result = await api.clientPayByBalance(state.token, purchasePayload);
      toast({ title: "Оплата прошла", description: result.message, variant: "success" });
      onOpenChange(false);
      reset();
      navigate("/cabinet/dashboard?payment=success");
      void Promise.all([refreshProfile(), reload()]).catch(() => undefined);
    } catch (cause) {
      toast({ title: "Не удалось оплатить", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
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
      if (redirect.isTelegramMiniApp) setPendingPaymentId(result.paymentId);
      redirect.open(url);
      if (!redirect.isTelegramMiniApp) navigate(`/cabinet/payment-wait?id=${encodeURIComponent(result.paymentId)}&kind=tariff`, { state: { url, provider } });
      if (!redirect.isTelegramMiniApp) onOpenChange(false);
    } catch (cause) {
      redirect.cancel();
      toast({ title: "Не удалось открыть оплату", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally {
      setPaying(false);
    }
  };

  const payPlatega = (methodId: number) => state.token && openPayment("Platega", () => api.clientCreatePlategaPayment(state.token!, {
    ...purchasePayload,
    paymentMethod: methodId,
    description: `Тариф «${plan.name}» · ${days} дней · ${totalDevices} устр.`,
  }));
  const payCryptoBot = () => state.token && openPayment("Crypto Bot", () => api.cryptopayCreatePayment(state.token!, purchasePayload));
  const convertManually = async () => {
    if (!state.token || !manualQuote || manualBusy) return;
    setManualBusy(true);
    try {
      const result = await api.clientSubscriptionConversion(state.token, manualQuote.quoteToken);
      setManualResult(result);
      await Promise.all([refreshProfile(), reload()]);
      if (result.direction !== "upgrade") {
        toast({ title: "Конвертация выполнена", description: `Добавлено ${result.convertedDays} дн. без покупки месяца`, variant: "success" });
        onOpenChange(false);
        reset();
      } else {
        toast({ title: "Тариф изменён", description: "Можно оплатить ещё месяц", variant: "success" });
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setManualQuote(null);
        setConversion(null);
        toast({ title: "Расчёт устарел", description: "Откройте тариф заново и подтвердите актуальный остаток", variant: "error" });
      } else {
        toast({ title: "Не удалось выполнить конвертацию", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
      }
    } finally {
      setManualBusy(false);
    }
  };
  const plategaMethods = config?.plategaMethods ?? [];
  const sbpMethod = plategaMethods.find((method) => /сбп|sbp|qr/i.test(method.label));
  const cardMethod = plategaMethods.find((method) => /карт|card/i.test(method.label));
  const cryptoMethod = plategaMethods.find((method) => /крип|crypto/i.test(method.label));
  const namedMethodIds = new Set([sbpMethod?.id, cardMethod?.id, cryptoMethod?.id]);
  const otherPlategaMethods = plategaMethods.filter((method) => !namedMethodIds.has(method.id));

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
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
        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, y: 60, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="glass-strong fixed inset-x-3 bottom-3 z-50 mx-auto flex max-h-[92dvh] max-w-lg flex-col overflow-hidden rounded-4xl sm:inset-x-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
          >
            <AnimatePresence mode="wait" initial={false}>
              {step === "config" ? (
                <motion.div
                  key="config"
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.22 }}
                  className="flex min-h-0 flex-col"
                >
                  {/* header */}
                  <div className="flex items-start gap-4 p-6 pb-4">
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-violet-glow/30 bg-violet-glow/12 text-violet-glow">
                      <Box className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Dialog.Title className="text-2xl font-extrabold tracking-tight">{plan.name}</Dialog.Title>
                      <Dialog.Description className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-fog-500">
                        {plan.emojiLine}
                      </Dialog.Description>
                    </div>
                    <Dialog.Close className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-fog-500 transition-colors hover:bg-white/8 hover:text-white">
                      <X className="h-5 w-5" />
                    </Dialog.Close>
                  </div>

                  <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                    {/* duration */}
                    <p className="mb-3 flex items-center gap-2 text-xs font-bold tracking-wider text-fog-500 uppercase">
                      <CalendarDays className="h-3.5 w-3.5" /> Длительность
                    </p>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      {plan.durationOptions.map((d) => {
                        const p = durationPrice(plan, d.days, extra);
                        const selected = days === d.days;
                        return (
                          <button
                            key={d.days}
                            onClick={() => setDays(d.days)}
                            className={cn(
                              "relative rounded-2xl border p-3 text-center transition-all duration-200",
                              selected
                                ? "border-accent-400/60 bg-accent-500/15 shadow-neon-blue"
                                : "border-white/8 bg-white/3 hover:border-white/20",
                            )}
                          >
                            <p className="text-sm font-extrabold">{d.days} дней</p>
                            <p className="mt-0.5 text-sm font-bold text-fog-300">{formatMoney(p, plan.currency)}</p>
                            <p className="text-[10px] text-fog-600">{formatMoney(p / d.days, plan.currency)}/день</p>
                          </button>
                        );
                      })}
                    </div>

                    {/* devices */}
                    <div className="mt-6 mb-3 flex items-center justify-between">
                      <p className="flex items-center gap-2 text-xs font-bold tracking-wider text-fog-500 uppercase">
                        <Smartphone className="h-3.5 w-3.5" /> Доп. устройства
                      </p>
                      <span className="text-xs text-fog-500">В тарифе: {plan.baseDevices}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                      {Array.from({ length: plan.maxExtraDevices + 1 }, (_, extraCount) => extraCount).map((extraCount) => {
                        const selected = extra === extraCount;
                        const extraQuote = quoteTariff(plan, days, extraCount);
                        const bestValue = extraQuote.discountPercent > 0;
                        return (
                          <button
                            key={extraCount}
                            onClick={() => setExtra(extraCount)}
                            className={cn(
                              "relative rounded-2xl border p-3 text-center transition-all duration-200",
                              selected
                                ? "border-violet-glow/60 bg-violet-glow/12 shadow-[0_0_24px_-6px_rgba(176,124,255,0.6)]"
                                : "border-white/8 bg-white/3 hover:border-white/20",
                            )}
                          >
                            {bestValue && (
                              <span className="absolute -top-2 -right-1 flex items-center gap-0.5 rounded-full bg-violet-glow px-1.5 py-0.5 text-[9px] font-extrabold text-ink-950">
                                <Sparkles className="h-2.5 w-2.5" />
                              </span>
                            )}
                            <p className="flex items-center justify-center gap-1 text-sm font-extrabold">
                              <Smartphone className="h-3.5 w-3.5 text-fog-500" />
                              {extraCount === 0 ? "Без доп." : `+${extraCount}`}
                            </p>
                            <p className="mt-0.5 text-sm font-bold text-fog-300">
                              +{formatMoney(extraQuote.extras, plan.currency)}
                            </p>
                            <p className={cn("text-[10px]", bestValue ? "font-bold text-violet-glow" : "text-fog-600")}>
                              {bestValue ? `скидка ${extraQuote.discountPercent}%` : `${plan.baseDevices + extraCount} устр.`}
                            </p>
                          </button>
                        );
                      })}
                    </div>

                    {/* summary */}
                    <div className="glass-inset mt-6 rounded-2xl p-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-fog-500">Длительность</span>
                        <span className="font-bold">{days} дней</span>
                      </div>
                      <div className="mt-1.5 flex justify-between text-sm">
                        <span className="text-fog-500">Тариф ({totalDevices} устр)</span>
                        <span className="font-bold">{formatMoney(basePrice, plan.currency)}</span>
                      </div>
                      {conversion?.willConvert && conversion.convertedDays !== undefined && (
                        <div className="mt-1.5 flex justify-between text-sm">
                          <span className="text-fog-500">Добавится конвертацией</span>
                          <span className="font-bold text-amber-glow">+{conversion.convertedDays} дн.</span>
                        </div>
                      )}
                      <div className="my-3 h-px bg-white/8" />
                      <div className="flex items-baseline justify-between">
                        <span className="font-bold">К оплате</span>
                        <span className="bg-gradient-to-r from-violet-glow to-accent-400 bg-clip-text text-3xl font-extrabold text-transparent">
                          {formatMoney(basePrice, plan.currency)}
                        </span>
                      </div>
                    </div>

                    {/* agreement */}
                    <label className="mt-4 flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-fog-500">
                      <Checkbox.Root
                        checked={agreed}
                        onCheckedChange={(v) => setAgreed(v === true)}
                        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-white/15 bg-white/5 transition-colors data-[state=checked]:border-violet-glow data-[state=checked]:bg-violet-glow data-[state=checked]:text-ink-950"
                      >
                        <Checkbox.Indicator>
                          <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      <span>
                        Нажимая кнопку «К оплате», я подтверждаю, что ознакомился и согласен с условиями
                        <span className="mt-1 flex flex-col gap-0.5">
                          <span className="font-semibold text-fog-300 underline">Публичной оферты</span>
                          <span className="font-semibold text-fog-300 underline">и Политикой обработки данных</span>
                        </span>
                      </span>
                    </label>

                    <button
                      disabled={!agreed}
                      onClick={() => setStep("checkout")}
                      className="btn-primary mt-5 w-full px-6 py-4 text-base disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Перейти к оплате · {formatMoney(basePrice, plan.currency)}
                    </button>
                  </div>
                </motion.div>
              ) : step === "success" ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-7 text-center"
                >
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-mint-500/15 text-mint-400">
                    <Check className="h-8 w-8" strokeWidth={3} />
                  </div>
                  <Dialog.Title className="mt-5 text-2xl font-extrabold">Оплата прошла</Dialog.Title>
                  <Dialog.Description className="mt-2 text-sm text-fog-500">
                    Подписка уже активирована. Если был пробный период, он автоматически конвертирован.
                  </Dialog.Description>
                  <button
                    onClick={() => { onOpenChange(false); navigate("/cabinet/dashboard?payment=success"); }}
                    className="btn-primary mt-6 w-full px-6 py-4"
                  >
                    Перейти к подписке
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
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setStep("config")}
                      className="grid h-9 w-9 place-items-center rounded-xl text-fog-400 transition-colors hover:bg-white/8 hover:text-white"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div>
                      <Dialog.Title className="text-lg font-extrabold">Оплата тарифа</Dialog.Title>
                      <Dialog.Description className="text-xs text-fog-500">{plan.name}</Dialog.Description>
                    </div>
                  </div>

                  {/* total */}
                  <div className="glass-inset mt-5 rounded-3xl p-5">
                    <p className="text-sm text-fog-500">Итого к оплате</p>
                    <p className="mt-1 text-4xl font-extrabold tracking-tight">
                      {formatMoney(price, plan.currency)}
                      {discountPercent > 0 && (
                        <span className="ml-2 align-middle text-base font-bold text-mint-400">−{discountPercent}%</span>
                      )}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2.5">
                      <div className="flex flex-col justify-center rounded-2xl border border-white/8 bg-white/3 p-3">
                        <p className="text-[10px] font-bold tracking-wider text-fog-600 uppercase">Срок</p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm font-bold">
                          <CalendarDays className="h-4 w-4 text-fog-500" /> {days} дн.
                        </p>
                      </div>
                      <div className="flex flex-col justify-center rounded-2xl border border-white/8 bg-white/3 p-3">
                        <p className="text-[10px] font-bold tracking-wider text-fog-600 uppercase">Трафик</p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm font-bold">
                          <Wifi className="h-4 w-4 text-fog-500" /> {plan.traffic}
                        </p>
                      </div>
                      </div>
                      {conversion?.willConvert && conversion.convertedDays !== undefined && (
                        <p className="mt-3 text-xs text-fog-500">В обычной покупке к сроку добавится конвертация: <b className="text-amber-glow">+{conversion.convertedDays} дн.</b></p>
                      )}
                    {plan.whitelistGB && (
                      <span className="chip chip-amber chip-fluid mt-2.5">
                        <Signal className="h-3.5 w-3.5" /> Белые списки: {plan.whitelistGB.toFixed(0)} ГБ / мес
                      </span>
                    )}
                  </div>

                  {/* renewal notice */}
                  {ownedSub && (
                    <div className="mt-4 flex items-start gap-3 rounded-3xl border border-violet-glow/25 bg-violet-glow/8 p-4">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-glow/15 text-violet-glow">
                        <RefreshCw className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">Этот тариф у вас уже есть — подписка будет продлена</p>
                        <p className="mt-1 text-xs leading-relaxed text-fog-500">
                          Вторая подписка не создастся — дни просто сложатся: остаток {ownedSub.daysLeft} дней + покупка{" "}
                          {days} дней = <span className="font-bold text-violet-glow">{ownedSub.daysLeft + days} дней</span>.
                          Устройства и серверы останутся как есть.
                        </p>
                      </div>
                    </div>
                  )}

                  {conversion?.willConvert && conversion.mode !== "extend" && (
                    <div className="mt-4 rounded-3xl border border-amber-glow/25 bg-amber-glow/8 p-4">
                      <p className="text-sm font-bold">
                        {conversion.mode === "replace" ? "Текущая подписка будет заменена" : "Остаток подписки будет пересчитан"}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-fog-500">
                        {conversion.subscription?.tariffName && <>Текущий тариф: {conversion.subscription.tariffName}. </>}
                        {conversion.remainingDays !== undefined && <>Остаток: {conversion.remainingDays} дн. </>}
                        {conversion.convertedDays !== undefined && <>После пересчёта: {conversion.convertedDays} дн. </>}
                        {conversion.totalDays !== undefined && <>Итого после покупки: <b className="text-amber-glow">{conversion.totalDays} дн.</b></>}
                      </p>
                    </div>
                  )}

                  {manualQuote && (
                    <div className="mt-4 rounded-3xl border border-accent-400/30 bg-accent-500/8 p-4">
                      <p className="text-sm font-bold">Конвертация без покупки месяца</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <span className="text-fog-500">Текущий тариф</span>
                        <span className="text-right font-semibold">{manualQuote.currentTariff.name ?? "—"}</span>
                        <span className="text-fog-500">Целевой тариф</span>
                        <span className="text-right font-semibold">{manualQuote.targetTariff.name}</span>
                        <span className="text-fog-500">Остаток</span>
                        <span className="text-right font-semibold">{manualQuote.remainingDays} дн.</span>
                        <span className="text-fog-500">Расчёт и округление</span>
                        <span className="text-right font-semibold">{manualQuote.rawConvertedDays.toFixed(2)} → {manualQuote.rounding}</span>
                        <span className="text-fog-500">Комиссия</span>
                        <span className="text-right font-semibold">{manualQuote.commissionPercent}%</span>
                        <span className="text-fog-500">Итоговые дни</span>
                        <span className="text-right font-bold text-accent-300">{manualQuote.totalDays} дн.</span>
                      </div>
                      {manualResult?.direction === "upgrade" ? (
                        <div className="mt-3 rounded-2xl border border-mint-400/25 bg-mint-500/10 p-3 text-xs text-fog-300">
                          Конвертация выполнена. <button type="button" className="font-bold text-mint-300 underline" onClick={() => setManualResult(null)}>Оплатить ещё месяц</button>
                        </div>
                      ) : !manualResult ? (
                        <button
                          type="button"
                          disabled={manualBusy}
                          onClick={convertManually}
                          className="btn-primary mt-3 w-full justify-center disabled:opacity-50"
                        >
                          {manualBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          {manualBusy ? "Конвертация…" : "Конвертация"}
                        </button>
                      ) : null}
                    </div>
                  )}

                  {conversion?.willConvert && (conversion.extras?.extraDevices ?? 0) > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setKeepExistingExtras(true)}
                        className={cn(
                          "rounded-2xl border p-3 text-left transition-all",
                          keepExistingExtras ? "border-violet-glow/50 bg-violet-glow/12" : "border-white/8 bg-white/3",
                        )}
                      >
                        <p className="text-xs font-bold">Сохранить устройства</p>
                        <p className="mt-1 text-[11px] text-fog-500">
                          {conversion.extras?.keep.totalDevices} устр.
                          {(conversion.extras?.keep.extraCost ?? 0) > 0 && ` · +${formatMoney(conversion.extras?.keep.extraCost ?? 0, plan.currency)}`}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setKeepExistingExtras(false)}
                        className={cn(
                          "rounded-2xl border p-3 text-left transition-all",
                          !keepExistingExtras ? "border-accent-400/50 bg-accent-500/12" : "border-white/8 bg-white/3",
                        )}
                      >
                        <p className="text-xs font-bold">Убрать дополнительные</p>
                        <p className="mt-1 text-[11px] text-fog-500">Останется {conversion.extras?.drop.totalDevices} устр.</p>
                      </button>
                    </div>
                  )}

                  {!conversion?.willConvert && trialConversionCandidates.length > 1 && (
                    <div className="mt-4 rounded-3xl border border-white/8 bg-white/3 p-4">
                      <p className="text-sm font-bold">Какую пробную подписку конвертировать</p>
                      <div className="mt-2 flex flex-col gap-2">
                        {trialConversionCandidates.map((subscription) => (
                          <button
                            type="button"
                            key={subscription.id}
                            onClick={() => setSelectedTrialId(subscription.id)}
                            className={cn(
                              "rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-all",
                              (selectedTrialId ?? trialConversionCandidates[0].id) === subscription.id
                                ? "border-violet-glow/50 bg-violet-glow/12"
                                : "border-white/8 bg-white/3",
                            )}
                          >
                            {subscription.name} · осталось {subscription.daysLeft} дн.
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* promo */}
                  <p className="mt-6 mb-2 flex items-center gap-2 text-sm font-bold">
                    <Tag className="h-4 w-4 text-fog-500" /> Промокод
                  </p>
                  <div className="flex gap-2.5">
                    <input
                      value={promo}
                      onChange={(e) => setPromo(e.target.value)}
                      placeholder="Введите промокод"
                      className="input-glass flex-1"
                    />
                    <button onClick={applyPromo} className="btn-ghost px-5 text-sm">
                      Применить
                    </button>
                  </div>

                  {/* payment methods */}
                  <p className="mt-6 mb-2 flex items-center gap-2 text-sm font-bold">
                    <Wallet className="h-4 w-4 text-fog-500" /> Способ оплаты
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {user.balance > 0 && (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={paying}
                        onClick={payBalance}
                        className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 p-4 text-left font-bold text-white shadow-[0_0_28px_-8px_rgba(249,115,22,0.7)] transition-filter hover:brightness-110"
                      >
                        {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wallet className="h-5 w-5" />}
                        <span className="flex-1">{paying ? "Оплата…" : "Оплатить с баланса"}</span>
                        <span className="rounded-lg bg-black/25 px-2.5 py-1 text-sm">
                          {user.balance.toLocaleString("ru-RU")} ₽
                        </span>
                      </motion.button>
                    )}

                    {/* Platega — основной способ, акцентный блок */}
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

/* ---------------- Строка тарифа ---------------- */

export function ManualConversionDialog({
  open,
  onOpenChange,
  source,
  tariffGroups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: CabinetSubscription;
  tariffGroups: TariffGroup[];
}) {
  const { reload, toast } = useApp();
  const { state, refreshProfile } = useClientAuth();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [quote, setQuote] = useState<ManualConversionQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [applying, setApplying] = useState(false);
  const targets = useMemo(() => conversionTargets(tariffGroups, source.tariffId), [source.tariffId, tariffGroups]);
  const selectedTargetId = targetId ?? targets[0]?.id ?? null;
  const target = targets.find((plan) => plan.id === selectedTargetId) ?? null;
  const option = target?.durationOptions[0] ?? null;

  useEffect(() => {
    if (!open) {
      setTargetId(null);
      setQuote(null);
      setQuoteError(null);
      setQuoting(false);
      setApplying(false);
      return;
    }
    setTargetId((current) => current && targets.some((plan) => plan.id === current) ? current : null);
  }, [open, targets]);

  useEffect(() => {
    if (!open || !state.token || !target || !option) {
      setQuote(null);
      setQuoteError(target ? "У выбранного тарифа нет доступного срока" : null);
      setQuoting(false);
      return;
    }
    let current = true;
    setQuoting(true);
    setQuote(null);
    setQuoteError(null);
    void api.clientSubscriptionConversionQuote(state.token, {
      subscriptionId: source.id,
      tariffId: target.id,
      priceOptionId: option.id,
    }).then((nextQuote) => {
      if (current) setQuote(nextQuote);
    }).catch((cause) => {
      if (current) setQuoteError(cause instanceof Error ? cause.message : "Для этого тарифа конвертация недоступна");
    }).finally(() => {
      if (current) setQuoting(false);
    });
    return () => { current = false; };
  }, [open, option, source.id, state.token, target]);

  const apply = async () => {
    if (!state.token || !quote || applying) return;
    setApplying(true);
    try {
      const result = await api.clientSubscriptionConversion(state.token, quote.quoteToken);
      await Promise.all([reload(), refreshProfile()]);
      toast({
        title: "Тариф изменён",
        description: `Остаток пересчитан: ${result.totalDays} дн.${result.commissionPercent > 0 ? " Комиссия 5% учтена." : ""}`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setQuote(null);
        setQuoteError("Расчёт устарел. Выберите тариф ещё раз.");
      } else {
        setQuoteError(cause instanceof Error ? cause.message : "Не удалось выполнить конвертацию");
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!applying) onOpenChange(nextOpen); }}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-md"
          />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="glass-strong fixed inset-x-3 top-1/2 z-50 mx-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg -translate-y-1/2 overflow-y-auto rounded-4xl p-6 sm:inset-x-0 sm:w-[calc(100%-2rem)] sm:p-7"
          >
            <Dialog.Close disabled={applying} className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-xl text-fog-500 transition-colors hover:bg-white/8 hover:text-white disabled:opacity-50">
              <X className="h-4 w-4" />
            </Dialog.Close>
            <Dialog.Title className="pr-9 text-2xl font-extrabold">Конвертация подписки</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-fog-500">
              Выберите тариф — остаток будет пересчитан без создания новой ссылки.
            </Dialog.Description>

            <div className="mt-5 rounded-3xl border border-white/8 bg-white/3 p-4">
              <p className="text-xs font-bold tracking-wider text-fog-600 uppercase">Текущая подписка</p>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="font-bold">{source.name}</span>
                <span className="text-sm font-semibold text-fog-400">{source.daysLeft} дн.</span>
              </div>
            </div>

            <p className="mt-5 mb-2 text-sm font-bold">Целевой тариф</p>
            {targets.length > 0 ? (
              <div className="-mx-4 grid max-h-64 gap-2 overflow-y-auto px-4 py-3">
                {targets.map((plan) => {
                  const selected = plan.id === selectedTargetId;
                  const firstOption = plan.durationOptions[0];
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => { setTargetId(plan.id); setQuote(null); setQuoteError(null); }}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border p-3 text-left transition-all",
                        selected ? "border-accent-400/55 bg-accent-500/12 shadow-neon-blue" : "border-white/8 bg-white/3 hover:border-accent-400/30",
                      )}
                    >
                      <span className="icon-tile h-10 w-10 rounded-xl"><RefreshCw className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{plan.name}</span>
                        <span className="mt-0.5 block text-xs text-fog-500">
                          {firstOption ? `${firstOption.days} дн. · ${formatMoney(firstOption.price, plan.currency)}` : "Срок не настроен"}
                        </span>
                      </span>
                      {plan.popular && <span className="chip chip-amber text-[10px]">Рекомендуем</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-2xl border border-white/8 bg-white/3 p-4 text-sm text-fog-500">Других тарифов пока нет.</p>
            )}

            <div className="mt-4 min-h-52">
              {target && (quoting || (!quote && !quoteError)) && (
                <div className="h-52 animate-pulse rounded-3xl border border-white/8 bg-white/3 p-4" aria-label="Считаем новый срок" aria-busy="true">
                  <div className="h-5 w-40 rounded-lg bg-white/8" />
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {[0, 1, 2, 3].map((item) => <div key={item} className="h-4 rounded-md bg-white/6" />)}
                  </div>
                </div>
              )}
              {quoteError && !quoting && <p className="rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{quoteError}</p>}
              {quote && !quoting && (
              <div className="rounded-3xl border border-accent-400/30 bg-accent-500/8 p-4">
                <p className="text-sm font-bold">Расчёт конвертации</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <span className="text-fog-500">Текущий тариф</span>
                  <span className="text-right font-semibold">{quote.currentTariff.name ?? source.name}</span>
                  <span className="text-fog-500">Целевой тариф</span>
                  <span className="text-right font-semibold">{quote.targetTariff.name}</span>
                  <span className="text-fog-500">Остаток</span>
                  <span className="text-right font-semibold">{quote.remainingDays} дн.</span>
                  <span className="text-fog-500">После пересчёта</span>
                  <span className="text-right font-semibold">{quote.convertedDays} дн.</span>
                  {quote.commissionPercent > 0 && <>
                    <span className="text-fog-500">Комиссия</span>
                    <span className="text-right font-semibold text-amber-glow">5%</span>
                  </>}
                  <span className="text-fog-500">Итого</span>
                  <span className="text-right font-bold text-accent-300">{quote.totalDays} дн.</span>
                </div>
              </div>
              )}
            </div>

            <button
              type="button"
              disabled={!quote || quoting || applying}
              onClick={() => void apply()}
              className="btn-primary mt-5 w-full justify-center px-6 py-4 text-base disabled:cursor-not-allowed disabled:opacity-45"
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {applying ? "Конвертируем…" : "Конвертировать подписку"}
            </button>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PlanRow({ plan, onPay, index }: { plan: TariffPlan; onPay: () => void; index: number }) {
  const startingOption = plan.durationOptions.reduce((best, option) => option.price < best.price ? option : best, plan.durationOptions[0]);
  const perDay = startingOption.price / startingOption.days;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35 }}
      className={cn(
        "relative flex flex-col rounded-3xl border p-5 transition-all duration-300",
        plan.popular
          ? "border-accent-400/40 bg-accent-500/8 shadow-neon-blue"
          : "glass-inset hover:border-white/16",
      )}
    >
      {plan.popular && (
        <span className="absolute -top-3 left-5 flex items-center gap-1 rounded-full bg-gradient-to-r from-accent-500 to-accent-600 px-3 py-1 text-[11px] font-extrabold text-white shadow-neon-blue">
          <Flame className="h-3 w-3" /> Лучший выбор
        </span>
      )}

      <h3 className="text-lg font-extrabold">{plan.name}</h3>
      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-fog-500">{plan.emojiLine}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <span className="chip chip-fluid">
          <CalendarDays className="h-3.5 w-3.5" /> от {Math.min(...plan.durationOptions.map((option) => option.days))} дн.
        </span>
        <span className="chip chip-fluid">
          <Smartphone className="h-3.5 w-3.5" /> {plan.baseDevices} устр.
        </span>
        <span className="chip chip-fluid col-span-2">
          <Wifi className="h-3.5 w-3.5" /> {plan.traffic}
        </span>
        {plan.whitelistGB !== null && (
          <span className="chip chip-amber chip-fluid col-span-2">
            <Signal className="h-3.5 w-3.5" /> Белые списки: {plan.whitelistGB.toFixed(0)} ГБ
          </span>
        )}
      </div>

      <div className="my-4 h-px bg-white/8" />

      <div className="mt-auto">
        <p className="text-[11px] font-semibold text-fog-600">от {formatMoney(perDay, plan.currency)}/день</p>
        <p className="text-2xl font-extrabold tracking-tight whitespace-nowrap">
          <span className="text-sm font-semibold text-fog-500">от </span>
          {formatMoney(startingOption.price, plan.currency)}
        </p>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onPay}
          className={cn(
            "mt-3 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-bold transition-all",
            plan.popular
              ? "btn-primary"
              : "bg-white/90 text-ink-950 shadow-[0_8px_24px_-8px_rgba(255,255,255,0.4)] hover:bg-white",
          )}
        >
          <CreditCard className="h-4 w-4" /> Оплатить
        </motion.button>
      </div>
    </motion.div>
  );
}

/* ---------------- Страница ---------------- */

export default function Tariffs() {
  const { tariffGroups } = useApp();
  const [selected, setSelected] = useState<TariffPlan | null>(null);
  const firstGroupId = tariffGroups[0]?.id;
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const visibleGroups = firstGroupId
    ? [firstGroupId, ...openGroups.filter((id) => id !== firstGroupId)]
    : openGroups;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Тарифы</h1>
        <p className="mt-1 text-fog-500">Выберите подходящий тариф и оплатите.</p>
      </div>

      <Accordion.Root
        type="multiple"
        value={visibleGroups}
        onValueChange={(groups: string[]) => setOpenGroups(firstGroupId ? [firstGroupId, ...groups.filter((id: string) => id !== firstGroupId)] : groups)}
        className="flex flex-col gap-4"
      >
        {tariffGroups.map((group) => (
          <Accordion.Item key={group.id} value={group.id} className="glass overflow-hidden rounded-4xl">
            <Accordion.Header>
              <Accordion.Trigger className="group flex w-full items-center gap-4 p-5 text-left sm:p-6">
                <div className="icon-tile h-11 w-11 rounded-xl">
                  <Box className="h-5 w-5" />
                </div>
                <h2 className="flex-1 text-base font-extrabold sm:text-lg">{group.title}</h2>
                <ChevronDown className="h-5 w-5 text-fog-600 transition-transform duration-300 group-data-[state=open]:rotate-180" />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="overflow-hidden data-[state=closed]:animate-[accordion-up_0.25s_ease-out] data-[state=open]:animate-[accordion-down_0.25s_ease-out]">
              <div className="grid grid-cols-1 gap-3 px-4 pt-3 pb-5 sm:grid-cols-2 sm:px-5 xl:grid-cols-3">
                {group.plans.map((plan, i) => (
                  <PlanRow key={plan.id} plan={plan} index={i} onPay={() => setSelected(plan)} />
                ))}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>

      <ExtraOptions trafficOnly />

      <PlanDialog plan={selected} open={selected !== null} onOpenChange={(v) => !v && setSelected(null)} />
    </div>
  );
}
