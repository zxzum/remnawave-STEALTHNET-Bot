import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import * as Accordion from "@radix-ui/react-accordion";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicConfig, type TariffConversionPreview } from "@/lib/api";
import { Modal, ModalDescription, ModalTitle } from "../components/ui/modal";
import { OptionCard } from "../components/ui/option-card";
import { Stepper } from "../components/ui/stepper";
import { Checkbox } from "../components/ui/checkbox";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { IconTile } from "../components/ui/icon-tile";
import { AnimatedNumber } from "../components/ui/animated-number";
import { useSuccess } from "../components/ui/success-dialog";
import { invalidatePrefetch, prefetchConversionPreview, prefetchPublicConfig } from "../components/ui/prefetch";
import {
  Box,
  ChevronDown,
  CalendarDays,
  Wifi,
  Signal,
  Smartphone,
  CreditCard,
  ArrowLeft,
  RefreshCw,
  Wallet,
  Zap,
  Flame,
  QrCode,
  Bitcoin,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useApp } from "../store/AppContext";
import { groupPlategaMethods, quoteTariff, resolvePaymentUrl, type TariffPlan } from "../model";
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
  const { show } = useSuccess();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<"config" | "checkout">("config");
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

  // Методы оплаты греются через кэш prefetch — повторные открытия мгновенные
  useEffect(() => { if (open) void prefetchPublicConfig().then(setConfig).catch(() => undefined); }, [open]);
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
      return;
    }
    let current = true;
    setKeepExistingExtras(true);
    void prefetchConversionPreview(state.token, {
      tariffId: plan.id,
      priceOptionId: selectedOptionId ?? undefined,
    }).then((preview) => {
      if (current) setConversion(preview);
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
          // Подписка изменилась — устаревший preview конвертации нельзя переиспользовать
          invalidatePrefetch("conversion:");
          await Promise.all([refreshProfile(), reload()]);
          if (active) {
            // Успех показываем глобальным SuccessDialog — модалку конфигурации закрываем
            onOpenChange(false);
            show({
              title: "Оплата прошла",
              description: "Подписка уже активирована. Если был пробный период, он автоматически конвертирован.",
            });
          }
          return;
        }
        if (payment.status === "FAILED") {
          setPendingPaymentId(null);
          invalidatePrefetch("conversion:");
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
  // База для бейджа скидки — максимальная цена/день среди опций (не полагаемся на сортировку API)
  const basePricePerDay = Math.max(0, ...plan.durationOptions.map((option) => (option.days > 0 ? option.price / option.days : 0)));
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
      // Баланс/подписка изменились — сбрасываем кэш preview конвертации
      invalidatePrefetch("conversion:");
      // Успех — глобальное окно (без дубля в toast), модалка закрывается по «Готово»
      show({
        title: "Оплата прошла",
        description: result.message,
        onDone: () => {
          onOpenChange(false);
          reset();
          navigate("/cabinet/dashboard?payment=success");
        },
      });
      void Promise.all([refreshProfile(), reload({ soft: true })]).catch(() => undefined);
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
  const payRollyPay = () => state.token && openPayment("RollyPay", () => api.rollypayCreatePayment(state.token!, purchasePayload));
  const plategaMethods = config?.plategaMethods ?? [];
  const { sbp: sbpMethod, card: cardMethod, crypto: cryptoMethod, other: otherPlategaMethods } = groupPlategaMethods(plategaMethods);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
      className="max-w-lg"
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
            {/* header — крестик встроен в Modal */}
            <div className="flex items-start gap-4 p-6 pb-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-violet-glow/30 bg-violet-glow/12 text-violet-glow">
                <Box className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1 pr-10">
                <ModalTitle className="text-2xl font-extrabold tracking-tight">{plan.name}</ModalTitle>
                <ModalDescription className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-fog-500">
                  {plan.emojiLine}
                </ModalDescription>
              </div>
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {/* duration */}
              <p className="mb-2 text-xs font-semibold text-fog-500">Длительность</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {plan.durationOptions.map((d) => {
                  const p = durationPrice(plan, d.days, extra);
                  // В API у опций нет процента скидки — считаем её от базовой цены/день (guard от days === 0)
                  const discount = basePricePerDay > 0 && d.days > 0
                    ? Math.round((1 - (d.price / d.days) / basePricePerDay) * 100)
                    : 0;
                  return (
                    <OptionCard
                      key={d.days}
                      selected={days === d.days}
                      badge={discount >= 5 ? `−${discount}%` : undefined}
                      onClick={() => setDays(d.days)}
                    >
                      <p className="text-sm font-extrabold">{d.days} дней</p>
                      <p className="mt-0.5 text-xs font-bold text-fog-300">{formatMoney(p, plan.currency)}</p>
                      <p className="text-[10px] text-fog-600">{formatMoney(p / d.days, plan.currency)}/день</p>
                    </OptionCard>
                  );
                })}
              </div>

              {/* devices */}
              <div className="mt-4 mb-2 flex items-baseline justify-between">
                <p className="text-xs font-semibold text-fog-500">Доп. устройства</p>
                <span className="text-xs text-fog-600">+{formatMoney(plan.pricePerExtraDevice, plan.currency)}/мес за устройство</span>
              </div>
              <Stepper
                label="Дополнительные устройства"
                value={extra}
                max={plan.maxExtraDevices}
                onChange={setExtra}
                hint={
                  quote.discountPercent > 0
                    ? <span className="font-bold text-mint-400">скидка {quote.discountPercent}%</span>
                    : <span>{totalDevices} устр. всего</span>
                }
              />

              {/* summary */}
              <div className="glass-inset mt-6 rounded-2xl p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-fog-500">Длительность</span>
                  <span className="font-bold">{days} дней</span>
                </div>
                <div className="mt-1.5 flex justify-between text-sm">
                  <span className="text-fog-500">Тариф ({totalDevices} устр)</span>
                  <span className="font-bold">{formatMoney(priceBeforePromo, plan.currency)}</span>
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
                  <span className="bg-gradient-to-r from-violet-glow to-accent-400 bg-clip-text text-2xl font-extrabold text-transparent">
                    {formatMoney(price, plan.currency)}
                  </span>
                </div>
              </div>

              {/* agreement */}
              <label className="mt-4 flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-fog-500">
                <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
                <span>
                  Нажимая кнопку «К оплате», я подтверждаю, что ознакомился и согласен с условиями
                  <span className="mt-1 flex flex-col gap-0.5">
                    <span className="font-semibold text-fog-300 underline">Публичной оферты</span>
                    <span className="font-semibold text-fog-300 underline">и Политикой обработки данных</span>
                  </span>
                </span>
              </label>

              <Button size="lg" disabled={!agreed} className="mt-4 w-full" onClick={() => setStep("checkout")}>
                Перейти к оплате · {formatMoney(priceBeforePromo, plan.currency)}
              </Button>
            </div>
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
              <div className="min-w-0 pr-10">
                <ModalTitle className="text-lg font-extrabold">Оплата тарифа</ModalTitle>
                <ModalDescription className="text-xs text-fog-500">{plan.name}</ModalDescription>
              </div>
            </div>

            {/* сводка-плейт */}
            <div className="glass-inset mt-5 rounded-2xl p-4">
              <div className="flex justify-between text-sm">
                <span className="text-fog-500">Тариф, {days} дней</span>
                <span className="font-bold">{formatMoney(quote.base, plan.currency)}</span>
              </div>
              {extra > 0 && (
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-fog-500">Доп. устройства ×{extra}</span>
                  <span className="font-bold">{formatMoney(quote.extras, plan.currency)}</span>
                </div>
              )}
              {conversionExtraCost > 0 && (
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-fog-500">Сохранение устройств</span>
                  <span className="font-bold">{formatMoney(conversionExtraCost, plan.currency)}</span>
                </div>
              )}
              {conversion?.willConvert && conversion.convertedDays !== undefined && (
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-fog-500">Добавится конвертацией</span>
                  <span className="font-bold text-amber-glow">+{conversion.convertedDays} дн.</span>
                </div>
              )}
              <Separator className="my-3" />
              <div className="flex items-baseline justify-between">
                <span className="font-bold">Итого</span>
                <span className="text-xl font-extrabold">
                  {formatMoney(price, plan.currency)}
                  {discountPercent > 0 && <span className="ml-2 text-sm font-bold text-mint-400">−{discountPercent}%</span>}
                </span>
              </div>
              {plan.whitelistGB && (
                <p className="mt-2.5 flex items-center gap-1.5 text-xs text-fog-500">
                  <Signal className="h-3.5 w-3.5" /> Белые списки: {plan.whitelistGB.toFixed(0)} ГБ / мес
                </p>
              )}
            </div>

            {/* renewal notice */}
            {ownedSub && (
              <div className="mt-3 flex items-start gap-3 rounded-2xl border border-violet-glow/25 bg-violet-glow/8 p-3.5">
                <IconTile size="sm" tone="violet">
                  <RefreshCw className="h-4 w-4" />
                </IconTile>
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
              <div className="mt-3 rounded-2xl border border-amber-glow/25 bg-amber-glow/8 p-3.5">
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
              <div className="mt-3 rounded-2xl border border-white/8 bg-white/3 p-3.5">
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
            <p className="mt-5 mb-2 text-xs font-semibold text-fog-500">Промокод</p>
            <form onSubmit={(e) => { e.preventDefault(); void applyPromo(); }} className="flex gap-2">
              <Input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="Промокод" className="flex-1" />
              <Button variant="secondary" type="submit">Применить</Button>
            </form>

            {/* payment methods */}
            <p className="mt-5 mb-2 text-xs font-semibold text-fog-500">Способ оплаты</p>
            <div className="flex flex-col gap-2.5">
              {user.balance > 0 && (
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full justify-between"
                  loading={paying}
                  loadingText="Оплата…"
                  disabled={user.balance < price}
                  onClick={payBalance}
                >
                  <span className="flex items-center gap-2">
                    <Wallet /> С баланса
                  </span>
                  <AnimatedNumber value={user.balance} format={(v) => `${v.toLocaleString("ru-RU")} ₽`} />
                </Button>
              )}

              {/* Platega — основной способ, акцентный блок */}
              {plategaMethods.length > 0 && <div className="rounded-2xl border border-accent-400/40 bg-accent-500/8 p-4 shadow-neon-blue">
                <div className="mb-3 flex items-center gap-2.5">
                  <IconTile size="sm">
                    <CreditCard className="h-4 w-4" />
                  </IconTile>
                  <div className="flex-1">
                    <p className="text-sm font-bold">Platega</p>
                    <p className="text-[11px] text-fog-500">Банковские платежи и крипта</p>
                  </div>
                  <span className="rounded-full bg-accent-500/20 px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-accent-400 uppercase">
                    Рекомендуем
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {sbpMethod && <Button
                    size="lg"
                    loading={paying}
                    loadingText="Оплата…"
                    onClick={() => payPlatega(sbpMethod.id)}
                  >
                    <span className="flex flex-col items-center">
                      <span className="flex items-center gap-1.5 font-bold">
                        <QrCode /> СБП
                      </span>
                      <span className="text-[10px] font-medium opacity-75">по QR-коду</span>
                    </span>
                  </Button>}
                  {cardMethod && <Button
                    size="lg"
                    loading={paying}
                    loadingText="Оплата…"
                    onClick={() => payPlatega(cardMethod.id)}
                  >
                    <span className="flex flex-col items-center">
                      <span className="flex items-center gap-1.5 font-bold">
                        <CreditCard /> Карта
                      </span>
                      <span className="text-[10px] font-medium opacity-75">RUB · любой банк</span>
                    </span>
                  </Button>}
                </div>
                {cryptoMethod && <Button
                  variant="link"
                  size="sm"
                  className="mt-2.5 w-full"
                  loading={paying}
                  loadingText="Оплата…"
                  onClick={() => payPlatega(cryptoMethod.id)}
                >
                  <Bitcoin /> Оплатить криптой через Platega
                </Button>}
                {otherPlategaMethods.length > 0 && <div className="mt-2.5 flex flex-col gap-2">
                  {otherPlategaMethods.map((method) => (
                    <Button
                      key={method.id}
                      variant="outline"
                      size="sm"
                      loading={paying}
                      loadingText="Оплата…"
                      onClick={() => payPlatega(method.id)}
                    >
                      {method.label}
                    </Button>
                  ))}
                </div>}
              </div>}

              {config?.cryptopayEnabled && <Button
                variant="secondary"
                size="lg"
                className="w-full justify-start hover:border-amber-glow/30"
                loading={paying}
                loadingText="Оплата…"
                onClick={payCryptoBot}
              >
                <IconTile size="sm" className="border-amber-glow/25 bg-amber-glow/10 text-amber-glow">
                  <Zap className="h-4 w-4" />
                </IconTile>
                <span className="flex flex-col items-start">
                  <span>Crypto Bot</span>
                  <span className="text-xs font-medium text-fog-500">USDT · TON · BTC</span>
                </span>
              </Button>}
              {config?.rollypayEnabled && plan.currency.toUpperCase() === "RUB" && <Button
                variant="secondary"
                size="lg"
                className="w-full justify-start hover:border-emerald-400/30"
                loading={paying}
                loadingText="Оплата…"
                onClick={payRollyPay}
              >
                <IconTile size="sm" className="border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
                  <CreditCard className="h-4 w-4" />
                </IconTile>
                <span className="flex flex-col items-start">
                  <span>RollyPay</span>
                  <span className="text-xs font-medium text-fog-500">Оплата в рублях</span>
                </span>
              </Button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}

function PlanRow({ plan, onPay, index }: { plan: TariffPlan; onPay: () => void; index: number }) {
  const { state } = useClientAuth();
  const startingOption = plan.durationOptions.reduce((best, option) => option.price < best.price ? option : best, plan.durationOptions[0]);
  const perDay = startingOption.price / startingOption.days;
  // Прогреваем кэш конвертации ещё до открытия диалога — он открывается с готовыми данными
  const prefetchConversion = () => {
    if (!state.token) return;
    void prefetchConversionPreview(state.token, { tariffId: plan.id, priceOptionId: plan.durationOptions[0]?.id ?? undefined }).catch(() => undefined);
  };
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
          onPointerDown={prefetchConversion}
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
  const { config, tariffGroups } = useApp();
  const [selected, setSelected] = useState<TariffPlan | null>(null);
  const firstGroupId = tariffGroups[0]?.id;
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const visibleGroups = firstGroupId
    ? [firstGroupId, ...openGroups.filter((id) => id !== firstGroupId)]
    : openGroups;

  useEffect(() => {
    if (window.location.hash === "#traffic") document.getElementById("traffic")?.scrollIntoView({ block: "start" });
  }, []);

  // Прогреваем кэш public-config заранее — диалог тарифа открывается мгновенно
  useEffect(() => { void prefetchPublicConfig().catch(() => undefined); }, []);

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

      {config?.sellOptions?.some((option) => option.kind === "traffic") && (
        <section id="traffic" className="scroll-mt-5">
          <ExtraOptions trafficOnly />
        </section>
      )}

      <PlanDialog plan={selected} open={selected !== null} onOpenChange={(v) => !v && setSelected(null)} />
    </div>
  );
}
