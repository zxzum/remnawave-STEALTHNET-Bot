import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Bitcoin, CreditCard, Globe, Loader2, QrCode, Wallet, Zap } from "lucide-react";
import { cn } from "../../lib/cn";
import { AnimatedNumber } from "./animated-number";
import { IconTile } from "./icon-tile";

/**
 * Ряд способа оплаты — единая строка h-11: иконка и название слева, подпись справа/под названием.
 * Все методы оплаты (баланс, Platega, CryptoBot, RollyPay) строятся из него — сетка без
 * разнобоя высот и без ссылок-строк по центру. Компонент только презентация: страницы
 * передают колбэки и сами дергают платёжные API.
 */
export function PaymentRow({
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
  /** accent — акцентные ячейки Platega (СБП/Карта): яркий accent-градиент + glow, как у primary-кнопки */
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
          ? /* Как раньше (refs/37): полный accent-градиент и neon-glow вместо бледной тонировки */
            "border-transparent bg-[linear-gradient(120deg,var(--color-accent-500),var(--color-accent-600)_55%,#6d28d9)] text-white shadow-[var(--shadow-neon-blue),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110 hover:shadow-[0_0_34px_-4px_rgb(139_92_246/0.7),0_10px_36px_-8px_rgb(139_92_246/0.45),inset_0_1px_0_rgb(255_255_255/0.3)]"
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
              <span
                className={cn(
                  "truncate font-medium",
                  size === "sm" ? "text-[10px]" : "text-[11px]",
                  tone === "accent" ? "text-white/75" : "text-fog-500",
                )}
              >
                {sub}
              </span>
            )}
          </span>
          {trailing}
        </>
      )}
    </button>
  );
}

export interface PaymentMethodsBlockProps {
  /** Цена покупки: ряд «С баланса» блокируется, если баланса не хватает */
  amount: number;
  /** Валюта тарифа (RUB открывает RollyPay) */
  currency: string;
  /** Баланс пользователя; ряд показывается только при balance > 0 */
  balance?: number;
  onBalancePay: () => void;
  /** Результат groupPlategaMethods на странице — группировка остаётся у потребителя */
  platega: {
    sbp?: { id: number };
    card?: { id: number };
    crypto?: { id: number };
    other: { id: number; label: string }[];
  };
  loading: boolean;
  /** methodId уже выбран на странице — сюда передаётся payPlatega */
  onPlatega: (methodId: number) => void;
  onCryptoBot?: () => void;
  onRollyPay?: () => void;
  cryptoEnabled?: boolean;
  rollyEnabled?: boolean;
  /** Явный флаг RUB; по умолчанию считается из currency */
  currencyIsRub?: boolean;
  /** Заголовки с дефолтами «С баланса» / «Банковские платежи и крипта» */
  labels?: { balanceTitle?: string; plategaSubtitle?: string };
}

/**
 * Способы оплаты: «С баланса» + Platega-плейт (акцентные СБП/Карта, второй ряд —
 * крипта/зарубежные) + CryptoBot/RollyPay. Пейлоады и вызовы API остаются на страницах —
 * сюда приходят только колбэки (refs/37 — эталон сетки).
 */
export function PaymentMethodsBlock({
  amount,
  currency,
  balance = 0,
  onBalancePay,
  platega,
  loading,
  onPlatega,
  onCryptoBot,
  onRollyPay,
  cryptoEnabled,
  rollyEnabled,
  currencyIsRub,
  labels,
}: PaymentMethodsBlockProps) {
  const balanceTitle = labels?.balanceTitle ?? "С баланса";
  const plategaSubtitle = labels?.plategaSubtitle ?? "Банковские платежи и крипта";
  // Второй ряд Platega-плиты: крипта + остальные методы. Нечётный последний тянется на 2 колонки,
  // чтобы в сетке не оставалось пустой ячейки
  const plategaSecondary = [
    ...(platega.crypto
      ? [{ key: `crypto-${platega.crypto.id}`, id: platega.crypto.id, title: "Крипта через Platega", icon: <Bitcoin className="h-4 w-4 text-fog-300" /> }]
      : []),
    ...platega.other.map((method) => ({
      key: `other-${method.id}`,
      id: method.id,
      title: method.label,
      icon: <Globe className="h-4 w-4 text-fog-300" />,
    })),
  ];
  const hasPlategaMethods = Boolean(platega.sbp || platega.card || platega.crypto) || platega.other.length > 0;
  // RUB берём из валюты тарифа; явный флаг currencyIsRub остаётся для страниц, где валюта уже нормализована
  const isRub = currencyIsRub ?? currency.toUpperCase() === "RUB";

  return (
    <div className="flex flex-col gap-2">
      {balance > 0 && (
        <PaymentRow
          loading={loading}
          disabled={balance < amount}
          onClick={onBalancePay}
          icon={<Wallet className="h-4 w-4 text-mint-400" />}
          title={balanceTitle}
          trailing={<AnimatedNumber value={balance} format={(v) => `${v.toLocaleString("ru-RU")} ₽`} className="text-xs font-bold tabular-nums" />}
        />
      )}

      {/* Platega — основной провайдер: акцентный плейт с сеткой методов */}
      {hasPlategaMethods && (
        <div className="rounded-2xl border border-accent-400/40 bg-accent-500/8 p-3 shadow-neon-blue">
          <div className="mb-2 flex items-center gap-2.5">
            <IconTile size="sm">
              <CreditCard className="h-4 w-4" />
            </IconTile>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight">Platega</p>
              <p className="text-[10px] leading-tight text-fog-500">{plategaSubtitle}</p>
            </div>
            <span className="rounded-full bg-accent-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-accent-400">
              Рекомендуем
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {platega.sbp && (
              <PaymentRow
                size="sm"
                tone="accent"
                loading={loading}
                onClick={() => onPlatega(platega.sbp!.id)}
                icon={<QrCode className="h-4 w-4 text-white" />}
                title="СБП"
                sub="по QR-коду"
              />
            )}
            {platega.card && (
              <PaymentRow
                size="sm"
                tone="accent"
                loading={loading}
                onClick={() => onPlatega(platega.card!.id)}
                icon={<CreditCard className="h-4 w-4 text-white" />}
                title="Карта"
                sub="RUB · любой банк"
              />
            )}
            {plategaSecondary.map((cell, index) => (
              <PaymentRow
                key={cell.key}
                size="sm"
                loading={loading}
                className={index === plategaSecondary.length - 1 && plategaSecondary.length % 2 === 1 ? "col-span-2" : undefined}
                onClick={() => onPlatega(cell.id)}
                icon={cell.icon}
                title={cell.title}
              />
            ))}
          </div>
        </div>
      )}

      {cryptoEnabled && onCryptoBot && (
        <PaymentRow loading={loading} onClick={onCryptoBot} icon={<Zap className="h-4 w-4 text-amber-glow" />} title="Crypto Bot" sub="USDT · TON · BTC" />
      )}
      {rollyEnabled && isRub && onRollyPay && (
        <PaymentRow loading={loading} onClick={onRollyPay} icon={<CreditCard className="h-4 w-4 text-emerald-300" />} title="RollyPay" sub="Оплата в рублях" />
      )}
    </div>
  );
}
