import { Bitcoin, CreditCard, Loader2, QrCode, Wallet, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { formatCurrency, groupPlategaMethods, type PlategaMethod } from "../model";

type PaymentMethodsProps = {
  amount: number;
  currency: string;
  balance: number;
  plategaMethods: PlategaMethod[];
  loading: boolean;
  disabled?: boolean;
  onBalance: () => void;
  onPlatega: (methodId: number) => void;
  onCryptoBot?: () => void;
  onRollyPay?: () => void;
};

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950";

function Busy({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children;
}

export function PaymentMethods({
  amount,
  currency,
  balance,
  plategaMethods,
  loading,
  disabled = false,
  onBalance,
  onPlatega,
  onCryptoBot,
  onRollyPay,
}: PaymentMethodsProps) {
  const grouped = groupPlategaMethods(plategaMethods);
  const unavailable = disabled || loading;
  const insufficient = balance < amount;

  return (
    <div className="flex flex-col gap-3">
      {balance > 0 && (
        <button
          type="button"
          disabled={unavailable || insufficient}
          onClick={onBalance}
          className={`${focusRing} flex min-h-14 items-center gap-3 rounded-2xl border border-orange-300/20 bg-orange-500/90 p-4 text-left font-bold text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-45`}
        >
          <Wallet className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block">{insufficient ? "Недостаточно на балансе" : "Оплатить с баланса"}</span>
            {insufficient && <span className="mt-0.5 block text-xs font-medium text-white/70">Доступно меньше суммы заказа</span>}
          </span>
          <span className="shrink-0 text-sm">{formatCurrency(balance, currency)}</span>
        </button>
      )}

      {plategaMethods.length > 0 && (
        <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="icon-tile h-10 w-10 rounded-xl"><CreditCard className="h-5 w-5" /></div>
            <div className="min-w-0">
              <p className="font-bold">Банковская оплата</p>
              <p className="text-xs text-fog-500">СБП, карта и другие способы</p>
            </div>
          </div>

          {(grouped.sbp || grouped.card) && (
            <div className={`grid gap-2.5 ${grouped.sbp && grouped.card ? "sm:grid-cols-2" : ""}`}>
              {grouped.sbp && (
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => onPlatega(grouped.sbp!.id)}
                  className={`${focusRing} btn-primary min-h-12 rounded-2xl px-3 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  <Busy loading={loading}><QrCode className="h-4 w-4" /></Busy>
                  <span><span className="block font-bold">СБП</span><span className="block text-[11px] font-medium opacity-75">по QR-коду</span></span>
                </button>
              )}
              {grouped.card && (
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => onPlatega(grouped.card!.id)}
                  className={`${focusRing} btn-primary min-h-12 rounded-2xl px-3 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  <Busy loading={loading}><CreditCard className="h-4 w-4" /></Busy>
                  <span><span className="block font-bold">Карта</span><span className="block text-[11px] font-medium opacity-75">любой банк</span></span>
                </button>
              )}
            </div>
          )}

          {grouped.crypto && (
            <button
              type="button"
              disabled={unavailable}
              onClick={() => onPlatega(grouped.crypto!.id)}
              className={`${focusRing} btn-ghost mt-2.5 min-h-11 w-full rounded-2xl px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <Busy loading={loading}><Bitcoin className="h-4 w-4" /></Busy>
              Криптовалюта через Platega
            </button>
          )}

          {grouped.other.length > 0 && (
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              {grouped.other.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  disabled={unavailable}
                  onClick={() => onPlatega(method.id)}
                  className={`${focusRing} btn-ghost min-h-11 rounded-2xl px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  <Busy loading={loading}><CreditCard className="h-4 w-4" /></Busy>
                  {method.label}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {(onCryptoBot || onRollyPay) && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {onCryptoBot && (
            <button
              type="button"
              disabled={unavailable}
              onClick={onCryptoBot}
              className={`${focusRing} glass-inset flex min-h-14 items-center gap-3 rounded-2xl p-3.5 text-left transition-colors hover:border-amber-glow/30 disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-amber-glow/20 bg-amber-glow/10 text-amber-glow"><Zap className="h-4 w-4" /></span>
              <span><span className="block text-sm font-bold">Crypto Bot</span><span className="block text-xs text-fog-500">USDT · TON · BTC</span></span>
            </button>
          )}
          {onRollyPay && (
            <button
              type="button"
              disabled={unavailable}
              onClick={onRollyPay}
              className={`${focusRing} glass-inset flex min-h-14 items-center gap-3 rounded-2xl p-3.5 text-left transition-colors hover:border-mint-400/30 disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-mint-400/20 bg-mint-400/10 text-mint-300"><CreditCard className="h-4 w-4" /></span>
              <span><span className="block text-sm font-bold">RollyPay</span><span className="block text-xs text-fog-500">Оплата в рублях</span></span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
