import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import * as Switch from "@radix-ui/react-switch";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ShieldCheck,
  KeyRound,
  Mail,
  MonitorSmartphone,
  Nfc,
  Wallet,
  Zap,
  CreditCard,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  Percent,
  Trash2,
  Globe,
  Send,
  AtSign,
  CalendarDays,
  Hash,
  QrCode,
  Bitcoin,
  X,
  Layers3,
  PackagePlus,
  Gift,
  Headphones,
  Users,
  Save,
  LogOut,
  Unlink,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useApp } from "../store/AppContext";
import { formatCurrency, resolvePaymentUrl, type CabinetTransaction as Transaction } from "../model";
import { CopyIconButton } from "../components/ui/CopyButton";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { preparePaymentRedirect } from "@/lib/open-payment-url";
import { QRCodeSVG } from "qrcode.react";

/* ---------------- Банковская карта ---------------- */

function BankCard() {
  const { user, subscriptions, config } = useApp();
  const [flipped, setFlipped] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const nearest = subscriptions[0];

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 8) drag.current.moved = true;
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: -py * 22, y: px * 26 });
  };

  const onPointerUp = () => {
    if (drag.current && !drag.current.moved) setFlipped((f) => !f);
    drag.current = null;
    setTilt({ x: 0, y: 0 });
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="[perspective:1400px]">
        <motion.div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            drag.current = null;
            setTilt({ x: 0, y: 0 });
          }}
          animate={{ rotateY: (flipped ? 180 : 0) + tilt.y, rotateX: tilt.x }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          className="relative aspect-[1.586/1] w-full cursor-pointer select-none [transform-style:preserve-3d]"
        >
          {/* front */}
          <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/12 bg-gradient-to-br from-ink-700 via-[#131c3d] to-[#1b2660] shadow-[0_32px_80px_-24px_rgba(10,20,60,0.9)] backface-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_85%_100%,rgba(109,155,255,0.22),transparent_60%),radial-gradient(60%_50%_at_10%_0%,rgba(255,255,255,0.08),transparent_60%)]" />
            {/* декоративные круги */}
            <div className="absolute -right-16 -bottom-20 h-56 w-56 rounded-full bg-accent-500/20 blur-2xl" />
            <div className="absolute -right-8 -bottom-14 h-40 w-40 rounded-full border border-white/10" />
            <div className="absolute right-24 -top-20 h-44 w-44 rounded-full border border-white/8" />
            <div className="card-shine" />
            <div className="relative flex h-full flex-col p-6 sm:p-7">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xl font-extrabold tracking-tight">{config?.serviceName || "Лазейка VPN"}</p>
                  <p className="mt-0.5 truncate text-[11px] font-bold tracking-[0.18em] text-accent-400">{nearest?.name || "VPN"}</p>
                </div>
                <div className="flex items-center gap-3">
                  {/* EMV-чип */}
                  <div className="relative h-8 w-11 overflow-hidden rounded-md border border-amber-200/50 bg-gradient-to-br from-amber-100/90 via-amber-300/80 to-amber-500/70">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-ink-950/35" />
                    <div className="absolute inset-y-0 left-1/2 w-px bg-ink-950/35" />
                    <div className="absolute top-1/2 left-1/2 h-3.5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-ink-950/35" />
                  </div>
                  <Nfc className="h-6 w-6 -rotate-90 text-fog-300" />
                </div>
              </div>
              <div className="mt-auto">
                <p className="text-sm text-fog-500">Ваш баланс</p>
                <p className="mt-1 text-4xl font-extrabold tracking-tight">
                  {formatCurrency(user.balance, user.currency)}
                </p>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <p className="text-[11px] font-bold tracking-[0.25em] text-fog-500">ВИРТУАЛЬНАЯ КАРТА</p>
                <p className="font-bold">
                  {config?.serviceName || "Лазейка VPN"}
                </p>
              </div>
            </div>
          </div>

          {/* back */}
          <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/12 bg-gradient-to-br from-[#131c3d] to-ink-800 shadow-[0_32px_80px_-24px_rgba(10,20,60,0.9)] [transform:rotateY(180deg)] backface-hidden">
            <div className="absolute inset-x-0 top-6 h-12 bg-ink-950/90" />
            <div className="relative flex h-full flex-col justify-end p-6 sm:p-7">
              <div>
                <p className="text-[10px] font-bold tracking-[0.25em] text-fog-500">ВЛАДЕЛЕЦ</p>
                <p className="mt-1 text-2xl font-extrabold">{user.name}</p>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.25em] text-fog-500">ПОДПИСКА ДО</p>
                  <p className="mt-1 text-xl font-extrabold">{nearest?.expiresAt ?? "—"}</p>
                </div>
                <p className="font-bold">
                  {config?.serviceName || "Лазейка VPN"}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
      <p className="mt-3 text-center text-xs text-fog-600">Нажмите, чтобы перевернуть · зажмите, чтобы вращать</p>
    </div>
  );
}

/* ---------------- Пополнение ---------------- */

const quickAmounts = [200, 500, 1000];

function TopUp() {
  const { config, toast } = useApp();
  const { state } = useClientAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState<number>(500);
  const [method, setMethod] = useState("");
  const [paying, setPaying] = useState(false);
  const currency = state.client?.preferredCurrency?.toLowerCase() || "rub";
  const methods = [
    ...(config?.plategaMethods ?? []).map((item) => ({
      id: `platega:${item.id}`,
      label: item.label,
      icon: /крип|crypto/i.test(item.label) ? Bitcoin : /сбп|sbp|qr/i.test(item.label) ? QrCode : CreditCard,
      provider: "platega" as const,
      methodId: item.id,
    })),
    ...(config?.cryptopayEnabled ? [{ id: "cryptobot", label: "Crypto Bot", icon: Zap, provider: "cryptobot" as const, methodId: null }] : []),
  ];
  useEffect(() => {
    if (!methods.some((item) => item.id === method)) setMethod(methods[0]?.id ?? "");
  }, [method, methods]);

  const pay = async () => {
    if (!Number.isFinite(amount) || amount < 1) {
      toast({ title: "Введите сумму", variant: "error" });
      return;
    }
    if (!state.token || !method) return;
    const selected = methods.find((item) => item.id === method);
    if (!selected) return;
    const redirect = preparePaymentRedirect();
    setPaying(true);
    try {
      const result = selected.provider === "platega"
        ? await api.clientCreatePlategaPayment(state.token, {
            amount,
            currency,
            paymentMethod: selected.methodId!,
            description: "Пополнение баланса",
          })
        : await api.cryptopayCreatePayment(state.token, { amount, currency });
      const url = resolvePaymentUrl(result, redirect.isTelegramMiniApp);
      if (!url) throw new Error("Платёжная система не вернула ссылку");
      redirect.open(url);
      if (!redirect.isTelegramMiniApp) {
        navigate(`/cabinet/payment-wait?id=${encodeURIComponent(result.paymentId)}&kind=topup`, {
          state: { url, provider: selected.label },
        });
      }
    } catch (cause) {
      redirect.cancel();
      toast({ title: "Не удалось открыть оплату", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally {
      setPaying(false);
    }
  };

  return (
    <section className="glass rounded-4xl p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="icon-tile h-11 w-11 rounded-xl">
          <Wallet className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-extrabold">Пополнить баланс</h2>
          <p className="text-xs text-fog-500">Средства зачисляются мгновенно</p>
        </div>
      </div>

      <div className="mb-3 flex gap-2">
        {quickAmounts.map((a) => (
          <button
            key={a}
            onClick={() => setAmount(a)}
            className={cn(
              "flex-1 rounded-xl border py-2 text-sm font-bold transition-all",
              amount === a
                ? "border-accent-400/60 bg-accent-500/15 text-accent-400 shadow-neon-blue"
                : "border-white/8 bg-white/3 text-fog-400 hover:border-white/20",
            )}
          >
            {formatCurrency(a, currency)}
          </button>
        ))}
      </div>

      <div className="flex gap-2.5">
        <div className="relative flex-1">
          <input
            type="number"
            min={1}
            value={amount || ""}
            onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
            placeholder="Сумма"
            className="input-glass pr-10"
          />
          <span className="absolute top-1/2 right-4 -translate-y-1/2 text-fog-500">{currency.toUpperCase()}</span>
        </div>
        <button disabled={paying || !method} onClick={pay} className="btn-primary px-6 py-3 text-sm disabled:opacity-40">
          {paying ? "Открываем…" : "Пополнить"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {methods.map((m) => (
          <button
            key={m.id}
            onClick={() => setMethod(m.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all",
              method === m.id
                ? "border-mint-400/50 bg-mint-500/12 text-mint-400"
                : "border-white/8 bg-white/3 text-fog-500 hover:border-white/20",
            )}
          >
            <m.icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        ))}
      </div>
      {config && methods.length === 0 && <p className="mt-3 text-xs text-fog-500">Способы пополнения временно недоступны.</p>}
    </section>
  );
}

/* ---------------- Данные аккаунта ---------------- */

function AccountData() {
  const { referral, user, canLinkTelegram, linkTelegram, canUnlinkTelegram, unlinkTelegram } = useApp();
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const rows = [
    { icon: Hash, label: "ID аккаунта", value: user.telegramId },
    { icon: Mail, label: "Email", value: user.email },
    { icon: AtSign, label: "Telegram", value: `${user.tgUsername} · ${user.telegramId}` },
    { icon: CalendarDays, label: "Регистрация", value: user.registeredAt },
  ];
  return (
    <section className="glass rounded-4xl p-5 sm:p-6">
      <h2 className="mb-4 font-extrabold">Данные аккаунта</h2>
      <div className="flex flex-col">
        {rows.map((r, i) => (
          <div key={r.label} className={cn("flex items-center gap-3 py-3", i > 0 && "border-t border-white/6")}>
            <r.icon className="h-4 w-4 shrink-0 text-fog-600" />
            <span className="w-28 shrink-0 text-xs font-semibold text-fog-500">{r.label}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.value}</span>
            <CopyIconButton text={r.value} label="Скопировано" className="h-8 w-8 rounded-lg" />
          </div>
        ))}
      </div>
      {canLinkTelegram && (
        <button
          disabled={linking}
          onClick={async () => {
            setLinking(true);
            try {
              await linkTelegram();
            } finally {
              setLinking(false);
            }
          }}
          className="btn-ghost mt-4 w-full px-5 py-3 text-sm disabled:cursor-wait disabled:opacity-60"
        >
          <Send className="h-4 w-4" /> {linking ? "Открываем Telegram…" : "Привязать Telegram"}
        </button>
      )}
      {canUnlinkTelegram && (
        <button
          disabled={unlinking}
          onClick={async () => {
            if (!window.confirm("Отвязать Telegram от аккаунта?")) return;
            setUnlinking(true);
            try {
              await unlinkTelegram();
            } finally {
              setUnlinking(false);
            }
          }}
          className="btn-ghost mt-2 w-full px-5 py-3 text-sm text-rose-300 disabled:cursor-wait disabled:opacity-60"
        >
          <Unlink className="h-4 w-4" /> {unlinking ? "Отвязываем…" : "Отвязать Telegram"}
        </button>
      )}
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-[10px] font-bold tracking-wider text-fog-600 uppercase">Реферальные ссылки</p>
        {[
          { icon: Globe, link: referral.siteLink },
          { icon: Send, link: referral.botLink },
        ].map((l, i) => (
          <div key={i} className="glass-inset flex items-center gap-3 rounded-xl px-3 py-2.5">
            <l.icon className="h-4 w-4 shrink-0 text-accent-400" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fog-400">{l.link}</span>
            <CopyIconButton text={l.link} label="Ссылка скопирована" className="h-8 w-8 rounded-lg" />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Безопасность ---------------- */

type SecurityMode = "2fa" | "password" | "email";

function SecurityDialog({ mode, onClose }: { mode: SecurityMode | null; onClose: () => void }) {
  const { state, refreshProfile } = useClientAuth();
  const { config, toast } = useApp();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const totpEnabled = Boolean(state.client?.totpEnabled);

  useEffect(() => {
    setCurrentPassword("");
    setNewPassword("");
    setEmail(state.client?.email ?? "");
    setCode("");
    setSetup(null);
    setError("");
    if (mode !== "2fa" || totpEnabled || !state.token) return;
    setLoading(true);
    void api.client2FASetup(state.token)
      .then(setSetup)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось начать настройку 2FA"))
      .finally(() => setLoading(false));
  }, [mode, state.client?.email, state.token, totpEnabled]);

  const submit = async () => {
    if (!state.token || !mode) return;
    setLoading(true);
    setError("");
    try {
      let message = "Настройки сохранены";
      if (mode === "2fa") {
        const result = totpEnabled
          ? await api.client2FADisable(state.token, code)
          : await api.client2FAConfirm(state.token, code);
        message = result.message;
      } else if (mode === "password") {
        const result = state.client?.hasPassword
          ? await api.clientChangePassword(state.token, { currentPassword, newPassword })
          : await api.clientSetPassword(state.token, { newPassword });
        message = result.message;
      } else if (config?.skipEmailVerification || !config?.smtpConfigured) {
        const result = await api.clientLinkEmailDirect(state.token, { email: email.trim() });
        message = result.message;
      } else {
        const result = await api.clientLinkEmailRequest(state.token, { email: email.trim() });
        message = result.message;
      }
      await refreshProfile();
      toast({ title: message, variant: "success" });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки");
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "2fa"
    ? totpEnabled ? "Отключить 2FA" : "Настроить 2FA"
    : mode === "password" ? state.client?.hasPassword ? "Сменить пароль" : "Установить пароль"
    : state.client?.email ? "Изменить email" : "Привязать email";
  const disabled = loading
    || (mode === "2fa" && (code.length !== 6 || (!totpEnabled && !setup)))
    || (mode === "password" && (newPassword.length < 8 || (Boolean(state.client?.hasPassword) && !currentPassword)))
    || (mode === "email" && !/^\S+@\S+\.\S+$/.test(email));

  return (
    <Dialog.Root open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-md" /></Dialog.Overlay>
        <Dialog.Content asChild>
          <motion.div initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="glass-strong fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-4xl p-6 sm:inset-x-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2">
            <div className="flex items-center gap-3">
              <div className="icon-tile h-11 w-11 rounded-xl"><ShieldCheck className="h-5 w-5" /></div>
              <Dialog.Title className="flex-1 text-lg font-extrabold">{title}</Dialog.Title>
              <Dialog.Close className="grid h-9 w-9 place-items-center rounded-xl text-fog-500 hover:bg-white/8"><X className="h-5 w-5" /></Dialog.Close>
            </div>
            <Dialog.Description className="mt-2 text-xs text-fog-500">
              {mode === "2fa" ? "Используйте приложение-аутентификатор и одноразовый шестизначный код." : "Изменение применяется только после подтверждения сервером."}
            </Dialog.Description>

            {mode === "2fa" && !totpEnabled && setup && <>
              <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-3"><QRCodeSVG value={setup.otpauthUrl} size={176} /></div>
              <div className="glass-inset mt-3 flex items-center gap-2 rounded-xl px-3 py-2"><span className="min-w-0 flex-1 truncate font-mono text-xs">{setup.secret}</span><CopyIconButton text={setup.secret} label="Ключ скопирован" /></div>
            </>}
            {mode === "2fa" && <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="000000" className="input-glass mt-4 text-center font-mono text-xl tracking-[0.45em]" />}
            {mode === "password" && <div className="mt-4 flex flex-col gap-3">
              {state.client?.hasPassword && <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" placeholder="Текущий пароль" className="input-glass" />}
              <input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="Новый пароль · минимум 8 символов" className="input-glass" />
            </div>}
            {mode === "email" && <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" className="input-glass mt-4" />}
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <button disabled={disabled} onClick={submit} className="btn-primary mt-5 w-full px-5 py-3.5 text-sm disabled:opacity-40">{loading ? "Сохраняем…" : "Подтвердить"}</button>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Security() {
  const { subscriptions, disconnectDevice } = useApp();
  const { state } = useClientAuth();
  const [mode, setMode] = useState<SecurityMode | null>(null);

  return (
    <section className="glass rounded-4xl p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl border border-orange-400/25 bg-orange-500/12 text-orange-400">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-extrabold">Безопасность</h2>
          <p className="text-xs text-fog-500">Защита вашего аккаунта</p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="glass-inset flex items-center gap-3 rounded-2xl p-4">
          <div className="icon-tile h-10 w-10 rounded-xl">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fog-500">Двухфакторная аутентификация</p>
            <p className="text-sm font-bold">Многоуровневая защита</p>
          </div>
          <Switch.Root
            checked={Boolean(state.client?.totpEnabled)}
            onCheckedChange={() => setMode("2fa")}
            className="relative h-7 w-12 shrink-0 rounded-full bg-white/10 transition-colors data-[state=checked]:bg-mint-500 data-[state=checked]:shadow-neon-mint"
          >
            <Switch.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-6" />
          </Switch.Root>
        </div>

        {[
          { icon: KeyRound, sub: "Пароль", title: state.client?.hasPassword ? "Сменить пароль аккаунта" : "Установить пароль для входа", btn: state.client?.hasPassword ? "Сменить" : "Установить", mode: "password" as const },
          { icon: Mail, sub: "Почта", title: state.client?.email ? "Изменить email аккаунта" : "Привязать email для входа", btn: state.client?.email ? "Изменить" : "Привязать", mode: "email" as const },
        ].map((r) => (
          <div key={r.sub} className="glass-inset flex items-center gap-3 rounded-2xl p-4">
            <div className="icon-tile h-10 w-10 rounded-xl">
              <r.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-fog-500">{r.sub}</p>
              <p className="text-sm font-bold">{r.title}</p>
            </div>
            <button
              onClick={() => setMode(r.mode)}
              className="btn-ghost px-4 py-2 text-xs"
            >
              {r.btn}
            </button>
          </div>
        ))}

        {/* sessions */}
        <div className="glass-inset rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="icon-tile h-10 w-10 rounded-xl">
              <MonitorSmartphone className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-fog-500">Сеансы</p>
              <p className="text-sm font-bold">Управление устройствами</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-fog-500">Отключите устройство, чтобы освободить слот для другого:</p>

          {subscriptions.map((sub, si) => (
            <div key={sub.id} className="mt-4">
              <p className="text-[10px] font-bold tracking-wider text-fog-600 uppercase">
                Подписка #{si} — {sub.plan} · {sub.devices.length}
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {sub.devices.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 rounded-xl border border-white/6 bg-white/3 p-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/6 text-fog-400">
                      <MonitorSmartphone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">
                        {d.os} · {d.name}
                      </p>
                      <p className="truncate text-[11px] text-violet-glow">{d.app}</p>
                      <p className="truncate font-mono text-[10px] text-fog-600">{d.hwid}</p>
                    </div>
                    <button
                      onClick={() => disconnectDevice(sub.id, d.id)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/8 px-2.5 py-1.5 text-[11px] font-bold text-red-400 transition-all hover:bg-red-500/20 active:scale-95"
                    >
                      <Trash2 className="h-3 w-3" /> Отключить
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <SecurityDialog mode={mode} onClose={() => setMode(null)} />
    </section>
  );
}

/* ---------------- История ---------------- */

const txMeta = {
  topup: { icon: ArrowDownLeft, cls: "bg-mint-500/15 border-mint-400/25 text-mint-400", label: "Пополнения" },
  purchase: { icon: ArrowUpRight, cls: "bg-accent-500/15 border-accent-400/25 text-accent-400", label: "Покупки" },
  referral: { icon: Percent, cls: "bg-violet-glow/15 border-violet-glow/25 text-violet-glow", label: "Бонусы" },
} as const;

type TxType = keyof typeof txMeta;

function TxRow({ t, i }: { t: Transaction; i: number }) {
  const m = txMeta[t.type];
  return (
    <div className={cn("flex items-center gap-3 py-3", i > 0 && "border-t border-white/6")}>
      <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl border", m.cls)}>
        <m.icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{t.title}</p>
        <p className="truncate text-xs text-fog-600">
          {t.detail} · {t.date}
        </p>
      </div>
      <span className={cn("shrink-0 text-sm font-extrabold", t.amount > 0 ? "text-mint-400" : "text-fog-100")}>
        {t.amount > 0 ? "+" : ""}
        {t.amount.toLocaleString("ru-RU")} ₽
      </span>
    </div>
  );
}

function PaymentsHistory() {
  const { transactions } = useApp();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | TxType>("all");

  const filtered = filter === "all" ? transactions : transactions.filter((t) => t.type === filter);
  const preview = transactions.slice(0, 5);

  const filters: Array<{ id: "all" | TxType; label: string }> = [
    { id: "all", label: "Все" },
    { id: "topup", label: txMeta.topup.label },
    { id: "purchase", label: txMeta.purchase.label },
    { id: "referral", label: txMeta.referral.label },
  ];

  return (
    <section className="glass rounded-4xl p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="icon-tile h-11 w-11 rounded-xl">
          <History className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-extrabold">История платежей</h2>
          <p className="text-xs text-fog-500">Пополнения, покупки и бонусы</p>
        </div>
        <span className="rounded-full bg-white/6 px-2.5 py-1 text-[11px] font-bold text-fog-400">
          {transactions.length}
        </span>
      </div>

      <div className="flex flex-col">
        {preview.map((t, i) => (
          <TxRow key={t.id} t={t} i={i} />
        ))}
      </div>

      <button onClick={() => setOpen(true)} className="btn-ghost mt-3 w-full px-4 py-3 text-sm">
        <History className="h-4 w-4" /> Все операции ({transactions.length})
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay asChild>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-md" />
          </Dialog.Overlay>
          <Dialog.Content asChild>
            <motion.div
              initial={{ opacity: 0, y: 60, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="glass-strong fixed inset-x-3 bottom-3 z-50 mx-auto flex max-h-[88dvh] max-w-lg flex-col overflow-hidden rounded-4xl sm:inset-x-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
            >
              <div className="flex items-center gap-3 border-b border-white/8 p-5">
                <div className="icon-tile h-10 w-10 rounded-xl">
                  <History className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <Dialog.Title className="font-extrabold">История платежей</Dialog.Title>
                  <Dialog.Description className="text-xs text-fog-500">
                    {filtered.length} из {transactions.length} операций
                  </Dialog.Description>
                </div>
                <Dialog.Close className="grid h-9 w-9 place-items-center rounded-xl text-fog-500 transition-colors hover:bg-white/8 hover:text-white">
                  <X className="h-5 w-5" />
                </Dialog.Close>
              </div>

              <div className="flex gap-2 border-b border-white/8 px-5 py-3">
                {filters.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      "rounded-xl border px-3.5 py-2 text-xs font-bold transition-all",
                      filter === f.id
                        ? "border-accent-400/60 bg-accent-500/15 text-accent-400 shadow-neon-blue"
                        : "border-white/8 bg-white/3 text-fog-500 hover:border-white/20",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
                {filtered.map((t, i) => (
                  <TxRow key={t.id} t={t} i={i} />
                ))}
                {filtered.length === 0 && (
                  <p className="py-10 text-center text-sm text-fog-500">Операций не найдено</p>
                )}
              </div>
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

/* ---------------- Страница ---------------- */

function ServiceLinks() {
  const { config } = useApp();
  const links = [
    config?.customBuildConfig?.enabled && { to: "/cabinet/custom-build", label: "Собери тариф", icon: Layers3 },
    config?.sellOptionsEnabled && { to: "/cabinet/extra-options", label: "Доп. опции", icon: PackagePlus },
    config?.showProxyEnabled && { to: "/cabinet/proxy", label: "Прокси", icon: Globe },
    config?.showSingboxEnabled && { to: "/cabinet/singbox", label: "Sing-box", icon: ShieldCheck },
    config?.giftSubscriptionsEnabled && { to: "/cabinet/gifts", label: "Подарки", icon: Gift },
  ].filter((item): item is { to: string; label: string; icon: typeof Globe } => Boolean(item));
  if (links.length === 0) return null;
  return <section className="glass rounded-4xl p-5 sm:p-6"><h2 className="mb-4 font-extrabold">Сервисы</h2><div className="grid grid-cols-2 gap-2">{links.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className="glass-inset flex items-center gap-2 rounded-2xl p-3 text-sm font-bold transition-colors hover:border-accent-400/30"><Icon className="h-4 w-4 text-accent-400" />{label}</Link>)}</div></section>;
}

function ReferralPromo() {
  const { referral, user } = useApp();

  return (
    <section className="glass rounded-4xl border border-violet-glow/30 bg-gradient-to-br from-violet-glow/15 via-transparent to-accent-500/10 p-5 shadow-[0_20px_60px_-32px_rgba(139,92,246,0.8)] sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-violet-glow/30 bg-violet-glow/15 text-violet-glow shadow-[0_0_24px_-8px_rgba(139,92,246,0.9)]">
          <Users className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold tracking-tight">Реферальная программа</h2>
          <p className="mt-1 text-sm leading-relaxed text-fog-400">Приглашайте друзей и получайте бонусы с их оплат.</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 divide-x divide-white/10 rounded-2xl border border-white/10 bg-white/[0.04] py-3">
        <div className="px-2 text-center">
          <p className="text-xl font-extrabold text-violet-glow">{referral.percent}%</p>
          <p className="mt-1 text-xs font-semibold text-fog-500">Процент</p>
        </div>
        <div className="px-2 text-center">
          <p className="text-xl font-extrabold">{referral.invited}</p>
          <p className="mt-1 text-xs font-semibold text-fog-500">Приглашено</p>
        </div>
        <div className="min-w-0 px-2 text-center">
          <p className="truncate text-xl font-extrabold text-mint-400">{formatCurrency(referral.earned, user.currency)}</p>
          <p className="mt-1 text-xs font-semibold text-fog-500">Заработано</p>
        </div>
      </div>

      <Link to="/cabinet/referral" className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-violet-glow px-5 py-3 text-sm font-extrabold text-white shadow-[0_12px_28px_-14px_rgba(139,92,246,0.95)] transition hover:bg-violet-glow/90">
        Открыть рефералку
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

function SupportButton() {
  const { config } = useApp();
  const supportUrl = config?.supportLink?.trim() || "https://t.me/lazeika_support_bot";

  return (
    <a
      href={supportUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Открыть поддержку в Telegram"
      className="glass group flex min-h-20 w-full items-center gap-4 rounded-4xl border border-[#2AABEE]/35 bg-gradient-to-r from-[#229ED9]/20 via-[#229ED9]/10 to-transparent p-5 shadow-[0_20px_60px_-34px_rgba(34,158,217,0.9)] transition hover:border-[#2AABEE]/60 hover:from-[#229ED9]/30 sm:p-6"
    >
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#229ED9] text-white shadow-[0_10px_28px_-10px_rgba(34,158,217,0.95)]">
        <Headphones className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-extrabold tracking-tight">Поддержка в Telegram</p>
        <p className="mt-1 text-sm text-fog-400">Открыть чат с ботом поддержки</p>
      </div>
      <ArrowUpRight className="h-5 w-5 shrink-0 text-[#2AABEE] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </a>
  );
}

function Preferences() {
  const { state, refreshProfile } = useClientAuth();
  const { toast, config } = useApp();
  const languages = config?.activeLanguages?.length ? config.activeLanguages : ["ru", "en"];
  const currencies = config?.activeCurrencies?.length ? config.activeCurrencies : ["usd", "rub"];
  const languagesKey = languages.join("|");
  const currenciesKey = currencies.join("|");
  const [language, setLanguage] = useState(state.client?.preferredLang || "ru");
  const [currency, setCurrency] = useState(state.client?.preferredCurrency || "rub");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const preferredLanguage = state.client?.preferredLang || "ru";
    const preferredCurrency = state.client?.preferredCurrency || "rub";
    setLanguage(languages.includes(preferredLanguage) ? preferredLanguage : languages[0]);
    setCurrency(currencies.includes(preferredCurrency) ? preferredCurrency : currencies[0]);
  }, [currenciesKey, languagesKey, state.client?.preferredCurrency, state.client?.preferredLang]);
  const save = async () => {
    if (!state.token) return;
    setSaving(true);
    try {
      await api.clientUpdateProfile(state.token, { preferredLang: language, preferredCurrency: currency });
      await refreshProfile();
      toast({ title: "Настройки сохранены", variant: "success" });
    } catch (cause) {
      toast({ title: "Не удалось сохранить настройки", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally { setSaving(false); }
  };
  const unlink = async () => {
    if (!state.token) return;
    setSaving(true);
    try {
      await api.yookassaUnlinkPaymentMethod(state.token);
      await refreshProfile();
      toast({ title: "Способ оплаты отвязан", variant: "success" });
    } catch (cause) {
      toast({ title: "Не удалось отвязать способ оплаты", description: cause instanceof Error ? cause.message : undefined, variant: "error" });
    } finally { setSaving(false); }
  };
  const languageLabels: Record<string, string> = { ru: "Русский", en: "English" };
  return <section className="glass rounded-4xl p-5 sm:p-6"><h2 className="mb-4 font-extrabold">Настройки кабинета</h2><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-fog-500">Язык<select value={language} onChange={(event) => setLanguage(event.target.value)} className="input-glass mt-2">{languages.map((item) => <option key={item} value={item}>{languageLabels[item.toLowerCase()] ?? item.toUpperCase()}</option>)}</select></label><label className="text-xs font-bold text-fog-500">Валюта<select value={currency} onChange={(event) => setCurrency(event.target.value)} className="input-glass mt-2">{currencies.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label></div><button disabled={saving} onClick={save} className="btn-primary mt-4 w-full px-5 py-3 text-sm disabled:opacity-40"><Save className="h-4 w-4" /> Сохранить</button>{state.client?.yookassaPaymentMethodTitle && <button disabled={saving} onClick={unlink} className="btn-ghost mt-2 w-full px-5 py-3 text-sm disabled:opacity-40"><Trash2 className="h-4 w-4" /> Отвязать {state.client.yookassaPaymentMethodTitle}</button>}</section>;
}

export default function Profile() {
  const { user } = useApp();
  const { logout } = useClientAuth();
  const navigate = useNavigate();
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);
  const isMiniapp = typeof window !== "undefined" && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const updateLayout = () => setIsDesktopLayout(media.matches);
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center gap-4 lg:hidden">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-mint-400 to-emerald-500 text-lg font-extrabold text-ink-950 shadow-neon-mint">
          {user.initials}
        </div>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">{user.name}</h1>
          <p className="text-sm text-fog-500">ID: {user.telegramId}</p>
        </div>
      </header>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Профиль</h1>
        <p className="mt-1 text-fog-500">Баланс, данные аккаунта и безопасность</p>
      </div>

      {isDesktopLayout ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 items-start gap-5">
            <div className="flex flex-col gap-5">
              <BankCard />
              <TopUp />
              <ReferralPromo />
              <PaymentsHistory />
              <ServiceLinks />
            </div>
            <div className="flex flex-col gap-5">
              <AccountData />
              <Preferences />
              <SupportButton />
              <Security />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <BankCard />
          <TopUp />
          <ReferralPromo />
          <SupportButton />
          <AccountData />
          <Preferences />
          <Security />
          <PaymentsHistory />
          <ServiceLinks />
        </div>
      )}
      {!isMiniapp && <button
        type="button"
        onClick={async () => { await logout(); navigate("/cabinet/login", { replace: true }); }}
        className="glass mx-auto flex w-full max-w-xl items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-semibold text-fog-500 transition-colors hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-400"
      >
        <LogOut className="h-4 w-4" strokeWidth={2.2} />
        Выйти из аккаунта
      </button>}
    </div>
  );
}
