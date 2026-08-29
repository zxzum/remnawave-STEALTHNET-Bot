import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import * as Accordion from "@radix-ui/react-accordion";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicConfig, type TariffConversionPreview } from "@/lib/api";
import { Modal, ModalBack, ModalDescription, ModalTitle } from "../components/ui/modal";
import { OptionCard } from "../components/ui/option-card";
import { Stepper } from "../components/ui/stepper";
import { Checkbox } from "../components/ui/checkbox";
import { Button, buttonVariants } from "../components/ui/button";
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
  Signal,
  Check,
  CreditCard,
  Globe,
  Loader2,
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

/**
 * Ряд способа оплаты — единая строка h-11: иконка и название слева, подпись/баланс справа.
 * Все методы оплаты (баланс, Platega, CryptoBot, RollyPay) строятся из него — сетка без
 * разнобоя высот и без ссылок-строк по центру.
 */
function PaymentRow({
  icon,
  title,
  sub,
  trailing,
  tone = "default",
  size = "md",
  loading,
  disabled,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  title: ReactNode;
  /** Подпись под названием («USDT · TON · BTC») */
  sub?: ReactNode;
  /** Слот справа (баланс) */
  trailing?: ReactNode;
  /** accent — акцентные ячейки Platega (СБП/Карта) */
  tone?: "default" | "accent";
  /** sm — ячейка сетки (мельче шрифт), md — ряд на всю ширину */
  size?: "md" | "sm";
  loading?: boolean;
}) {
  const titleSize = size === "sm" ? "text-xs" : "text-sm";
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-2xl border px-3 text-left transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400",
        tone === "accent"
          ? "border-accent-400/45 bg-accent-500/12 text-white hover:border-accent-400/80 hover:bg-accent-500/20"
          : "glass text-fog-100 hover:bg-white/8 hover:border-white/20",
        className,
      )}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span className={cn("truncate font-extrabold", titleSize)}>Оплата…</span>
        </>
      ) : (
        <>
          {icon}
          <span className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
            <span className={cn("truncate font-bold", titleSize)}>{title}</span>
            {sub != null && (
              <span className={cn("truncate font-medium text-fog-500", size === "sm" ? "text-[10px]" : "text-[11px]")}>{sub}</span>
            )}
          </span>
          {trailing}
        </>
      )}
    </button>
  );
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

  // Прогрев конвертации стартует сразу при выборе плана — даже когда модалка ещё закрыта
  // (кейс «Продлить» / `?extend=`), поэтому к открытию чекаута строка «+N дн.» уже в кэше
  useEffect(() => {
    if (!plan || !state.token) {
      setConversion(null);
      return;
    }
    let current = true;
    setKeepExistingExtras(true);
    void prefetchConversionPreview(state.token, {
      tariffId: plan.id,
      priceOptionId: selectedOptionId ?? undefined,
    }).then((preview) => {
      if (current && open) setConversion(preview);
    }).catch(() => {
      if (current && open) setConversion(null);
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
          // Промокод/скидка не должны переживать оплату и протекать в следующую покупку
          reset();
          // Подписка изменилась — устаревший preview конвертации нельзя переиспользовать
          invalidatePrefetch("conversion:");
          await Promise.all([refreshProfile(), reload()]);
          if (active) {
            // Успех показываем глобальным SuccessDialog — модалку конфигурации закрываем
            onOpenChange(false);
            show({
              title: "Оплата прошла",
              description: "Подписка уже активирована. Если был пробный период, он автоматически конвертирован.",
              onDone: () => navigate("/cabinet/dashboard?payment=success"),
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
  // Второй ряд Platega-плита: крипта + остальные методы. Нечётный последний тянется на 2 колонки,
  // чтобы в сетке не оставалось пустой ячейки
  const plategaSecondary = [
    ...(cryptoMethod
      ? [{ key: `crypto-${cryptoMethod.id}`, method: cryptoMethod, title: "Крипта через Platega", icon: <Bitcoin className="h-4 w-4 text-fog-300" /> }]
      : []),
    ...otherPlategaMethods.map((method) => ({
      key: `other-${method.id}`,
      method,
      title: method.label,
      icon: <Globe className="h-4 w-4 text-fog-300" />,
    })),
  ];

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
            {/* header — компактный на мобиле: без тайла и описания тарифа, крестик встроен в Modal */}
            <div className="p-5 pb-3">
              <div className="pr-10">
                <ModalTitle className="text-lg font-extrabold tracking-tight">Тариф «{plan.name}»</ModalTitle>
                <ModalDescription className="mt-0.5 text-xs text-fog-500">
                  Выберите длительность и доп. устройства
                </ModalDescription>
              </div>
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-6">
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
                      compact
                      selected={days === d.days}
                      badge={discount >= 5 ? `−${discount}%` : undefined}
                      onClick={() => setDays(d.days)}
                    >
                      {/* две строки вместо трёх: срок + «цена · цена/день» — плотнее на мобиле */}
                      <p className={cn("text-sm font-bold", days === d.days && "text-accent-400")}>{d.days} дней</p>
                      <p className="mt-0.5 text-[11px] text-fog-400">
                        {formatMoney(p, plan.currency)} · {formatMoney(p / d.days, plan.currency)}/день
                      </p>
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
            className="no-scrollbar min-h-0 overflow-y-auto p-4"
          >
            {/* back-кнопка — тот же плейт, что и X в шапке (h-8 w-8 rounded-xl), ряд симметричен */}
            <div className="flex items-center gap-3">
              <ModalBack label="К конфигурации тарифа" onClick={() => setStep("config")} />
              <div className="min-w-0 flex-1 pr-10">
                <ModalTitle className="text-base font-extrabold">Оплата тарифа</ModalTitle>
                <ModalDescription className="text-xs text-fog-500">{plan.name}</ModalDescription>
              </div>
            </div>

            {/* сводка — один компактный плейт */}
            <div className="glass-inset mt-4 rounded-2xl p-3.5">
              <div className="flex justify-between gap-3 text-xs">
                <span className="text-fog-500">Тариф, {days} дней</span>
                <span className="font-bold">{formatMoney(quote.base, plan.currency)}</span>
              </div>
              {extra > 0 && (
                <div className="mt-1 flex justify-between gap-3 text-xs">
                  <span className="text-fog-500">Доп. устройства ×{extra}</span>
                  <span className="font-bold">{formatMoney(quote.extras, plan.currency)}</span>
                </div>
              )}
              {conversionExtraCost > 0 && (
                <div className="mt-1 flex justify-between gap-3 text-xs">
                  <span className="text-fog-500">Сохранение устройств</span>
                  <span className="font-bold">{formatMoney(conversionExtraCost, plan.currency)}</span>
                </div>
              )}
              {conversion?.willConvert && conversion.convertedDays !== undefined && (
                <div className="mt-1 flex justify-between gap-3 text-xs">
                  <span className="text-fog-500">Добавится конвертацией</span>
                  <span className="font-bold text-amber-glow">+{conversion.convertedDays} дн.</span>
                </div>
              )}
              <Separator className="my-2.5" />
              <div className="flex items-baseline justify-between">
                <span className="font-bold">Итого</span>
                <span className="text-lg font-extrabold">
                  {formatMoney(price, plan.currency)}
                  {discountPercent > 0 && <span className="ml-2 text-xs font-bold text-mint-400">−{discountPercent}%</span>}
                </span>
              </div>
              {plan.whitelistGB && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-fog-500">
                  <Signal className="h-3.5 w-3.5" /> Белые списки: {plan.whitelistGB.toFixed(0)} ГБ / мес
                </p>
              )}
            </div>

            {/* информеры — максимум 1–2 строки */}
            {ownedSub && (
              <div className="mt-2.5 flex items-start gap-2.5 rounded-2xl border border-violet-glow/25 bg-violet-glow/8 p-3">
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-violet-glow" />
                <p className="min-w-0 flex-1 text-xs leading-snug text-fog-400">
                  Тариф уже ваш — дни сложатся: {ownedSub.daysLeft} + {days} ={" "}
                  <span className="font-bold text-violet-glow">{ownedSub.daysLeft + days} дн.</span>{" "}
                  Устройства и серверы останутся как есть.
                </p>
              </div>
            )}

            {conversion?.willConvert && conversion.mode !== "extend" && (
              <div className="mt-2.5 flex items-start gap-2.5 rounded-2xl border border-amber-glow/25 bg-amber-glow/8 p-3">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-amber-glow" />
                <p className="min-w-0 flex-1 text-xs leading-snug text-fog-400">
                  <span className="font-bold text-amber-glow">
                    {conversion.mode === "replace" ? "Подписка будет заменена" : "Остаток будет пересчитан"}
                  </span>
                  {conversion.subscription?.tariffName && <> · {conversion.subscription.tariffName}</>}
                  {conversion.remainingDays !== undefined && <> · остаток {conversion.remainingDays} дн.</>}
                  {conversion.convertedDays !== undefined && <> · после пересчёта {conversion.convertedDays} дн.</>}
                  {conversion.totalDays !== undefined && <> · итого <b className="text-amber-glow">{conversion.totalDays} дн.</b></>}
                </p>
              </div>
            )}

            {conversion?.willConvert && (conversion.extras?.extraDevices ?? 0) > 0 && (
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setKeepExistingExtras(true)}
                  className={cn(
                    "rounded-2xl border p-2.5 text-left transition-all",
                    keepExistingExtras ? "border-violet-glow/50 bg-violet-glow/12" : "border-white/8 bg-white/3",
                  )}
                >
                  <p className="text-xs font-bold">Сохранить устройства</p>
                  <p className="mt-0.5 text-[11px] text-fog-500">
                    {conversion.extras?.keep.totalDevices} устр.
                    {(conversion.extras?.keep.extraCost ?? 0) > 0 && ` · +${formatMoney(conversion.extras?.keep.extraCost ?? 0, plan.currency)}`}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setKeepExistingExtras(false)}
                  className={cn(
                    "rounded-2xl border p-2.5 text-left transition-all",
                    !keepExistingExtras ? "border-accent-400/50 bg-accent-500/12" : "border-white/8 bg-white/3",
                  )}
                >
                  <p className="text-xs font-bold">Убрать дополнительные</p>
                  <p className="mt-0.5 text-[11px] text-fog-500">Останется {conversion.extras?.drop.totalDevices} устр.</p>
                </button>
              </div>
            )}

            {!conversion?.willConvert && trialConversionCandidates.length > 1 && (
              <div className="mt-2.5 rounded-2xl border border-white/8 bg-white/3 p-3">
                <p className="text-xs font-bold">Какую пробную подписку конвертировать</p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {trialConversionCandidates.map((subscription) => (
                    <button
                      type="button"
                      key={subscription.id}
                      onClick={() => setSelectedTrialId(subscription.id)}
                      className={cn(
                        "rounded-xl border px-3 py-1.5 text-left text-xs font-semibold transition-all",
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
            <p className="mt-4 mb-2 text-xs font-semibold text-fog-500">Промокод</p>
            <form onSubmit={(e) => { e.preventDefault(); void applyPromo(); }} className="flex gap-2">
              <Input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="Промокод" className="min-w-0 flex-1" />
              <Button variant="secondary" type="submit">Применить</Button>
            </form>

            {/* способы оплаты — единая сетка рядов h-11 */}
            <p className="mt-4 mb-2 text-xs font-semibold text-fog-500">Способ оплаты</p>
            <div className="flex flex-col gap-2">
              {user.balance > 0 && (
                <PaymentRow
                  loading={paying}
                  disabled={user.balance < price}
                  onClick={payBalance}
                  icon={<Wallet className="h-4 w-4 text-mint-400" />}
                  title="С баланса"
                  trailing={<AnimatedNumber value={user.balance} format={(v) => `${v.toLocaleString("ru-RU")} ₽`} className="text-xs font-bold tabular-nums" />}
                />
              )}

              {/* Platega — основной провайдер: акцентный плейт с сеткой методов */}
              {plategaMethods.length > 0 && (
                <div className="rounded-2xl border border-accent-400/40 bg-accent-500/8 p-3 shadow-neon-blue">
                  <div className="mb-2 flex items-center gap-2.5">
                    <IconTile size="sm">
                      <CreditCard className="h-4 w-4" />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-tight">Platega</p>
                      <p className="text-[10px] leading-tight text-fog-500">Банковские платежи и крипта</p>
                    </div>
                    <span className="rounded-full bg-accent-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-accent-400">
                      Рекомендуем
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {sbpMethod && (
                      <PaymentRow
                        size="sm"
                        tone="accent"
                        loading={paying}
                        onClick={() => payPlatega(sbpMethod.id)}
                        icon={<QrCode className="h-4 w-4 text-accent-400" />}
                        title="СБП"
                        sub="по QR-коду"
                      />
                    )}
                    {cardMethod && (
                      <PaymentRow
                        size="sm"
                        tone="accent"
                        loading={paying}
                        onClick={() => payPlatega(cardMethod.id)}
                        icon={<CreditCard className="h-4 w-4 text-accent-400" />}
                        title="Карта"
                        sub="RUB · любой банк"
                      />
                    )}
                    {plategaSecondary.map((cell, index) => (
                      <PaymentRow
                        key={cell.key}
                        size="sm"
                        loading={paying}
                        className={index === plategaSecondary.length - 1 && plategaSecondary.length % 2 === 1 ? "col-span-2" : undefined}
                        onClick={() => payPlatega(cell.method.id)}
                        icon={cell.icon}
                        title={cell.title}
                      />
                    ))}
                  </div>
                </div>
              )}

              {config?.cryptopayEnabled && (
                <PaymentRow
                  loading={paying}
                  onClick={payCryptoBot}
                  icon={<Zap className="h-4 w-4 text-amber-glow" />}
                  title="Crypto Bot"
                  sub="USDT · TON · BTC"
                />
              )}
              {config?.rollypayEnabled && plan.currency.toUpperCase() === "RUB" && (
                <PaymentRow
                  loading={paying}
                  onClick={payRollyPay}
                  icon={<CreditCard className="h-4 w-4 text-emerald-300" />}
                  title="RollyPay"
                  sub="Оплата в рублях"
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}

function PlanRow({ plan, onPay, index }: { plan: TariffPlan; onPay: () => void; index: number }) {
  // Цена на карточке — от опции МИНИМАЛЬНОГО срока (не от самой дешёвой):
  // формат «4 ₽/день» над «120 ₽/30 дн.». Пустых durationOptions не бывает у валидного тарифа,
  // но guard нужен — reduce без начального значения на пустом массиве бросает.
  const minTermOption = plan.durationOptions.length
    ? plan.durationOptions.reduce((best, option) => option.days < best.days ? option : best)
    : null;
  // Чек-лист вместо описания: каждая строка админского emojiLine — отдельный пункт (refs/29)
  const checklist = plan.emojiLine.split("\n").map((line) => line.trim()).filter(Boolean);
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
      {checklist.length > 0 && (
        <ul className="mt-3 space-y-2">
          {checklist.map((line, lineIndex) => (
            <li key={`${lineIndex}:${line}`} className="flex items-start gap-2 text-sm leading-snug text-fog-200">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-mint-400" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="my-4 h-px bg-white/8" />

      <div className="mt-auto">
        {minTermOption && (
          <>
            <p className="text-[11px] font-semibold text-fog-600">{formatMoney(minTermOption.price / minTermOption.days, plan.currency)}/день</p>
            <p className="text-2xl font-extrabold tracking-tight whitespace-nowrap">
              {formatMoney(minTermOption.price, plan.currency)}
              <span className="text-sm font-semibold text-fog-500">/{minTermOption.days} дн.</span>
            </p>
          </>
        )}
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onPay}
          className={cn(
            "mt-3 flex w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold transition-all",
            plan.popular
              ? buttonVariants({ variant: "primary", size: "lg" })
              : "bg-white/90 px-5 py-3.5 text-ink-950 shadow-[0_8px_24px_-8px_rgba(255,255,255,0.4)] hover:bg-white",
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
  const { state } = useClientAuth();
  const token = state.token;
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

  // Прогрев preview конвертации для первого варианта каждого плана: строка «+N дн.»
  // уже в кэше, когда юзер доходит до чекаута (см. prefetchConversionPreview)
  useEffect(() => {
    if (!token) return;
    for (const group of tariffGroups) {
      for (const plan of group.plans) {
        void prefetchConversionPreview(token, {
          tariffId: plan.id,
          priceOptionId: plan.durationOptions[0]?.id ?? undefined,
        }).catch(() => undefined);
      }
    }
  }, [token, tariffGroups]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Тарифы</h1>
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
              <Accordion.Trigger className="group flex w-full items-center gap-4 p-4 text-left sm:p-5">
                <div className="icon-tile h-9 w-9 rounded-xl">
                  <Box className="h-4 w-4" />
                </div>
                <h2 className="flex-1 text-sm font-extrabold sm:text-base">{group.title}</h2>
                <ChevronDown className="h-4 w-4 text-fog-600 transition-transform duration-300 group-data-[state=open]:rotate-180" />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="overflow-hidden data-[state=closed]:animate-[accordion-up_0.25s_ease-out] data-[state=open]:animate-[accordion-down_0.25s_ease-out]">
              {/* pt-8, а не pt-3: бейдж «Лучший выбор» на -top-3 + spread shadow-neon-blue
                  не должен срезаться overflow-hidden у Accordion.Content */}
              <div className="grid grid-cols-1 gap-3 px-4 pt-8 pb-5 sm:grid-cols-2 sm:px-5 xl:grid-cols-3">
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
