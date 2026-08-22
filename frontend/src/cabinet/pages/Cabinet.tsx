import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import { Gift, KeyRound, ShoppingBag, Smartphone, X, ChevronRight, Monitor, Send, Package, RefreshCw } from "lucide-react";
import { useApp } from "../store/AppContext";
import { useClientAuth } from "@/contexts/client-auth";
import { TrialsPickerDialog } from "@/components/cabinet/trials-picker-dialog";
import { cn } from "../lib/cn";
import { isExpiredTrial, type CabinetSubscription as Subscription } from "../model";
import { ManualConversionDialog, PlanDialog } from "./Tariffs";

function pluralDays(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "день";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "дня";
  return "дней";
}

function formatGb(value: number) {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ГБ`;
}

export function PageHeader() {
  const { user } = useApp();
  return (
    <header className="flex items-center gap-4 lg:hidden">
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-mint-400 to-emerald-500 text-lg font-extrabold text-ink-950 shadow-neon-mint">
        {user.initials}
      </div>
      <div>
        <h1 className="text-xl font-extrabold tracking-tight">{user.name}</h1>
        <p className="text-sm text-fog-500">ID: {user.telegramId}</p>
      </div>
    </header>
  );
}

function TrafficBar({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100);
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/8 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-accent-500 via-accent-400 to-mint-400 shadow-[0_0_12px_rgba(77,124,254,0.6)]"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
      />
    </div>
  );
}

function MainSubscriptionCard({ sub }: { sub: Subscription }) {
  const { disconnectDevice } = useApp();
  const limit = sub.trafficLimitGB ?? 0;
  const expiredTrial = isExpiredTrial(sub);

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14, transition: { duration: 0.18 } }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong liquid rounded-4xl p-6 sm:p-7"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-fog-500">
            Подписка · <span className="font-semibold text-fog-300">{sub.name}</span>
          </p>
        </div>
        <span className={cn("flex items-center gap-2 text-sm font-bold", expiredTrial ? "text-fog-500" : "text-mint-400")}>
          <span className={cn("status-dot", expiredTrial && "bg-fog-500 shadow-none")} />
          {expiredTrial ? "Завершена" : "Активна"}
        </span>
      </div>

      {sub.lazeikaOnly?.active && (
        <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3">
          <p className="whitespace-pre-line text-sm leading-relaxed text-amber-200">{sub.lazeikaOnly.message}</p>
        </div>
      )}

      {expiredTrial ? (
        <div className="flex min-h-72 flex-col items-center justify-center text-center">
          <div className="icon-tile h-16 w-16 rounded-2xl">
            <Gift className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-2xl font-extrabold">Пробный период закончился</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-fog-500">Выберите тариф, чтобы продолжить пользоваться Лазейкой ВПН.</p>
          <Link to="/cabinet/tariffs" className="btn-primary mt-5 px-6 py-3">
            <ShoppingBag className="h-5 w-5" />
            Все тарифы
          </Link>
        </div>
      ) : <>
      <div className="mt-4 flex items-end gap-3">
        <span className="bg-gradient-to-br from-white to-fog-300 bg-clip-text text-7xl leading-none font-extrabold tracking-tight text-transparent">
          {sub.daysLeft}
        </span>
        <span className="pb-1.5 text-xl font-semibold text-fog-500">{pluralDays(sub.daysLeft)}</span>
        <span className="ml-auto pb-1 text-right text-xs text-fog-600">
          до {sub.expiresAt}
        </span>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="font-medium text-fog-300">Трафик за месяц</span>
          <span className="font-bold">
            {sub.trafficUsedGB.toLocaleString("ru-RU")} / {sub.trafficLimitGB ? `${limit} ГБ` : "∞"}
          </span>
        </div>
        {sub.trafficLimitGB && <TrafficBar used={sub.trafficUsedGB} limit={limit} />}
        <p className="mt-2 text-xs text-fog-600">
          Всего за всё время: {sub.trafficAllTimeGB.toLocaleString("ru-RU")} ГБ
        </p>
        {sub.whitelistGB && (
          <div className="mt-5">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-medium text-fog-300">Трафик по белым спискам</span>
              <span className="font-bold">
                {formatGb(sub.whitelistUsedGB)} / {formatGb(sub.whitelistGB)}
              </span>
            </div>
            <TrafficBar used={sub.whitelistUsedGB} limit={sub.whitelistGB} />
          </div>
        )}
      </div>

      <div className="my-6 h-px bg-white/8" />

      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold">Устройства</h3>
        <span className="text-sm font-semibold text-fog-500">
          {sub.devices.length} из {sub.deviceLimit}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {sub.devices.map((d, i) => (
          <motion.li
            key={d.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + i * 0.08 }}
            className="flex items-center gap-4"
          >
            <div className="icon-tile">
              {d.os === "macOS" || d.os === "Windows" ? <Monitor className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{d.name}</p>
              <p className={cn("text-sm", d.connectedNow ? "text-mint-400" : "text-fog-600")}>
                {d.connectedNow ? "Подключено сейчас" : "Не в сети"}
              </p>
            </div>
            <button
              onClick={() => disconnectDevice(sub.id, d.id)}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-fog-500 transition-all hover:bg-red-500/10 hover:text-red-400"
            >
              Отключить
            </button>
          </motion.li>
        ))}
      </ul>
      </>}
    </motion.section>
  );
}

function CompactSubscriptionCard({ sub, index, onSelect }: { sub: Subscription; index: number; onSelect: () => void }) {
  const pct = Math.min(100, (sub.daysLeft / sub.totalDays) * 100);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 + index * 0.1, duration: 0.4 }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => e.key === "Enter" && onSelect()}
        className="glass group flex cursor-pointer items-center gap-4 rounded-3xl p-4 transition-all duration-200 hover:border-accent-400/30 hover:shadow-neon-blue"
      >
        <div className="icon-tile h-11 w-11 rounded-2xl">
          <KeyRound className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{sub.name}</p>
          <p className="text-xs text-fog-500">
            {sub.plan} · {sub.daysLeft} {pluralDays(sub.daysLeft)}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-accent-500 to-mint-400"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.9, delay: 0.4 }}
            />
          </div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-fog-600 transition-transform group-hover:translate-x-1 group-hover:text-accent-400" />
      </div>
    </motion.div>
  );
}

function BindTelegramDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { linkTelegram } = useApp();
  const [linking, setLinking] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
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
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="glass-strong fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-4xl p-6 text-center"
          >
            <Dialog.Close className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-xl text-fog-500 transition-colors hover:bg-white/8 hover:text-white">
              <X className="h-4 w-4" />
            </Dialog.Close>
            <div className="icon-tile mx-auto h-14 w-14 rounded-2xl">
              <Send className="h-6 w-6" />
            </div>
            <Dialog.Title className="mt-4 text-xl font-extrabold">Привязать Telegram?</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-fog-500">
              Свяжите аккаунт с Telegram-ботом — подписки, баланс и рефералы будут в одном месте, а вход станет проще.
            </Dialog.Description>
            <button
              disabled={linking}
              onClick={async () => {
                setLinking(true);
                try {
                  await linkTelegram();
                  onClose();
                } finally {
                  setLinking(false);
                }
              }}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-sm font-bold text-ink-950 shadow-[0_8px_24px_-8px_rgba(255,255,255,0.4)] transition-all hover:bg-fog-100 active:scale-95 disabled:cursor-wait disabled:opacity-60"
            >
              <Send className="h-4 w-4" /> {linking ? "Открываем…" : "Привязать Telegram"}
            </button>
            <button
              onClick={onClose}
              className="mt-2 w-full rounded-xl py-2.5 text-sm font-semibold text-fog-500 transition-colors hover:text-fog-100"
            >
              Позже
            </button>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EmailHintDialog() {
  const { state } = useClientAuth();
  const [open, setOpen] = useState(false);
  const client = state.client;

  useEffect(() => {
    const inTelegram = Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
    if (!inTelegram || !client?.id || client.email) return;
    const key = `cabinet-email-hint:${client.id}`;
    // Показываем только при входе в Mini App: переходы и действия не должны повторять подсказку.
    if (!window.sessionStorage.getItem(key) && Number(window.localStorage.getItem(key) ?? 0) < 2) {
      window.sessionStorage.setItem(key, "shown");
      setOpen(true);
    }
  }, [client?.email, client?.id]);

  const close = () => {
    if (client?.id) {
      const key = `cabinet-email-hint:${client.id}`;
      const count = Number(window.localStorage.getItem(key) ?? 0);
      window.localStorage.setItem(key, String(Math.min(count + 1, 2)));
    }
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-md" />
        <Dialog.Content className="glass-strong fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-4xl p-6 text-center">
          <Dialog.Title className="text-xl font-extrabold">Почта — по желанию</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm leading-relaxed text-fog-400">
            Вы уже можете пользоваться кабинетом. Если захотите входить и с сайта, привяжите почту и пароль позже в «Профиль» → «Безопасность».
          </Dialog.Description>
          <button onClick={close} className="btn-primary mt-5 w-full px-5 py-3.5 text-sm">Понятно</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RegistrationSuccessDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-md" />
        <Dialog.Content className="glass-strong fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-4xl p-6 text-center">
          <div className="icon-tile mx-auto h-14 w-14 rounded-2xl"><Send className="h-6 w-6" /></div>
          <Dialog.Title className="mt-4 text-xl font-extrabold">Аккаунт успешно создан</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm leading-relaxed text-fog-400">
            Рекомендуем привязать Telegram в настройках профиля, чтобы упростить вход и управление подпиской.
          </Dialog.Description>
          <Link to="/cabinet/profile" onClick={onClose} className="btn-primary mt-5 flex w-full items-center justify-center gap-2 px-5 py-3.5 text-sm">
            <Send className="h-4 w-4" /> Открыть настройки
          </Link>
          <button onClick={onClose} className="mt-2 w-full rounded-xl py-2.5 text-sm font-semibold text-fog-500 transition-colors hover:text-fog-100">
            Позже
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function Cabinet() {
  const { availableTrials, reload, subscriptions, tariffGroups, toast } = useApp();
  const { state } = useClientAuth();
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | undefined>(subscriptions[0]?.id);
  const [renewOpen, setRenewOpen] = useState(false);
  const [conversionOpen, setConversionOpen] = useState(false);

  const main = subscriptions.find((s) => s.id === selectedId) ?? subscriptions[0];
  const renewalPlan = main?.tariffId
    ? tariffGroups.flatMap((group) => group.plans).find((plan) => plan.id === main.tariffId) ?? null
    : null;
  const rest = subscriptions.filter((s) => s.id !== main?.id);
  const bindOpen = params.get("bindTelegram") === "1";
  const trialOpen = params.get("trial") === "1";
  const registrationOpen = params.toString().includes("registration=success");
  const closeTrial = () => {
    const next = new URLSearchParams(params);
    next.delete("trial");
    setParams(next);
  };
  const trialDialog = availableTrials.length > 0 && state.token ? (
    <TrialsPickerDialog
      open={trialOpen}
      token={state.token}
      onOpenChange={(open) => { if (!open) closeTrial(); }}
      onActivated={async ({ message }) => {
        await reload();
        toast({ title: message, variant: "success" });
      }}
    />
  ) : null;
  const registrationDialog = <RegistrationSuccessDialog open={registrationOpen} onClose={() => setParams({})} />;

  if (!main) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader />
        <div><h1 className="text-3xl font-extrabold tracking-tight">Кабинет</h1><p className="mt-1 text-fog-500">Ваша подписка и подключённые устройства</p></div>
        <section className="glass-strong liquid mx-auto w-full max-w-xl rounded-4xl p-7 text-center sm:p-9">
          <div className="icon-tile mx-auto h-16 w-16 rounded-2xl"><Package className="h-7 w-7" /></div>
          <h2 className="mt-5 text-xl font-extrabold">Подписка ещё не выбрана</h2>
          <p className="mt-2 text-sm leading-relaxed text-fog-500">Выберите тариф, чтобы получить ключ доступа и подключить VPN.</p>
          {availableTrials.length > 0 && <Link to="/cabinet/dashboard?trial=1" className="btn-primary mt-4 px-6 py-4"><Gift className="h-5 w-5" />Активировать пробный период</Link>}
          <Link to="/cabinet/tariffs" className="btn-primary mt-6 px-6 py-4"><ShoppingBag className="h-5 w-5" />Выбрать тариф</Link>
        </section>
        {trialDialog}
        <BindTelegramDialog open={bindOpen} onClose={() => setParams({})} />
        <EmailHintDialog />
        {registrationDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader />

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Кабинет</h1>
        <p className="mt-1 text-fog-500">Ваша подписка и подключённые устройства</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <AnimatePresence mode="wait">
          {main && <MainSubscriptionCard key={main.id} sub={main} />}
        </AnimatePresence>

        <div className="flex flex-col gap-5">
          <motion.div
            className="flex flex-col gap-3"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.4 }}
          >
            <Link to="/cabinet/tariffs" onClick={(event) => { if (renewalPlan) { event.preventDefault(); setRenewOpen(true); } }} className="btn-primary px-6 py-4 text-base">
              <RefreshCw className="h-5 w-5" />
              Продлить подписку
            </Link>
            {!isExpiredTrial(main) && <button type="button" onClick={() => setConversionOpen(true)} className="btn-ghost px-6 py-4 text-base">
              <RefreshCw className="h-5 w-5" />
              Конвертация тарифа
            </button>}
            <Link to={`/cabinet/subscribe?sub=${main.id}`} className="btn-ghost px-6 py-4 text-base">
              <KeyRound className="h-5 w-5" />
              Открыть ключи доступа
            </Link>
            {availableTrials.length > 0 && <Link to="/cabinet/dashboard?trial=1" className="btn-ghost px-6 py-4 text-base"><Gift className="h-5 w-5" />Активировать пробный период</Link>}
            <Link to="/cabinet/tariffs" className="btn-ghost px-6 py-4 text-base">
              <ShoppingBag className="h-5 w-5" />
              Все тарифы
            </Link>
          </motion.div>

          {rest.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-bold tracking-wider text-fog-500 uppercase">Другие подписки</h3>
              {rest.map((s, i) => (
                <CompactSubscriptionCard key={s.id} sub={s} index={i} onSelect={() => setSelectedId(s.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <BindTelegramDialog open={bindOpen} onClose={() => setParams({})} />
      <EmailHintDialog />
      {registrationDialog}
      {trialDialog}
      <PlanDialog plan={renewalPlan} open={renewOpen} onOpenChange={setRenewOpen} />
      <ManualConversionDialog
        source={main}
        tariffGroups={tariffGroups}
        open={conversionOpen}
        onOpenChange={setConversionOpen}
      />
    </div>
  );
}
