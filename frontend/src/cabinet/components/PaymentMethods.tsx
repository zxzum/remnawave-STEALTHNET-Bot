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
const methodButton = `${focusRing} flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-sm font-semibold text-fog-200 transition-colors hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45`;

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
          className={`${focusRing} flex min-h-12 items-center gap-3 rounded-2xl border border-white/[0.12] bg-white/[0.08] p-3.5 text-left font-bold text-white transition-colors hover:border-white/20 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-45`}
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
        <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-3.5">
          <div className="mb-2.5 flex items-center gap-2.5">
            <div className="icon-tile h-9 w-9 rounded-xl"><CreditCard className="h-4 w-4" /></div>
            <div className="min-w-0">
              <p className="text-sm font-bold">Банковская оплата</p>
              <p className="text-[11px] text-fog-500">СБП, карта и другие способы</p>
            </div>
          </div>

          {(grouped.sbp || grouped.card) && (
            <div className={`grid gap-2.5 ${grouped.sbp && grouped.card ? "sm:grid-cols-2" : ""}`}>
              {grouped.sbp && (
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => onPlatega(grouped.sbp!.id)}
                  className={`${methodButton} min-h-14`}
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
                  className={`${methodButton} min-h-14`}
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
              className={`${methodButton} mt-2.5 w-full sm:w-auto`}
            >
              <Busy loading={loading}><Bitcoin className="h-4 w-4" /></Busy>
              Криптовалюта через Platega
            </button>
          )}

          {grouped.other.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {grouped.other.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  disabled={unavailable}
                  onClick={() => onPlatega(method.id)}
                  className={`${methodButton} w-full sm:w-auto`}
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
        <div className="flex flex-wrap gap-2.5">
          {onCryptoBot && (
            <button
              type="button"
              disabled={unavailable}
              onClick={onCryptoBot}
              className={`${focusRing} glass-inset flex min-h-12 w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:border-white/18 disabled:cursor-not-allowed disabled:opacity-45 sm:w-64`}
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
              className={`${focusRing} glass-inset flex min-h-12 w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:border-white/18 disabled:cursor-not-allowed disabled:opacity-45 sm:w-64`}
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
