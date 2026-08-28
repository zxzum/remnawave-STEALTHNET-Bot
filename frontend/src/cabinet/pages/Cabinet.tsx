import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import { Gift, KeyRound, ShoppingBag, Smartphone, X, ChevronRight, Monitor, Send, Package, PackagePlus, RefreshCw } from "lucide-react";
import { useApp } from "../store/AppContext";
import { useClientAuth } from "@/contexts/client-auth";
import { TrialsPickerDialog } from "@/components/cabinet/trials-picker-dialog";
import { AnimatedNumber } from "../components/ui/animated-number";
import { Button, buttonVariants } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { IconTile } from "../components/ui/icon-tile";
import { Progress } from "../components/ui/progress";
import { Separator } from "../components/ui/separator";
import { cn } from "../lib/cn";
import { isExpiredTrial, type CabinetSubscription as Subscription } from "../model";
import { PlanDialog } from "./Tariffs";

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
      className="glass-strong liquid min-w-0 max-w-full rounded-4xl p-5 sm:p-6"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fog-500">
            Подписка · <span className="font-semibold text-fog-300">{sub.name}</span>
          </p>
        </div>
        <span className={cn("flex shrink-0 items-center gap-2 text-sm font-bold", expiredTrial ? "text-fog-500" : "text-mint-400")}>
          <span className={cn("status-dot", expiredTrial && "bg-fog-500 shadow-none")} />
          {expiredTrial ? "Завершена" : "Активна"}
        </span>
      </div>

      {expiredTrial ? (
        <EmptyState
          icon={Gift}
          title="Пробный период закончился"
          description="Выберите тариф, чтобы продолжить пользоваться Лазейкой ВПН."
          className="min-h-72 justify-center"
        >
          <Link to="/cabinet/tariffs" className={buttonVariants({ size: "lg" })}>
            <ShoppingBag />
            Все тарифы
          </Link>
        </EmptyState>
      ) : <>
      <div className="mt-4 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-1">
        <span className="bg-gradient-to-br from-white to-fog-300 bg-clip-text text-5xl leading-none font-extrabold tracking-tight text-transparent min-[380px]:text-6xl">
          <AnimatedNumber value={sub.daysLeft} />
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
        {sub.trafficLimitGB && <Progress value={sub.trafficUsedGB} max={limit} />}
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
            {/* Whitelist-трафик выделяем янтарным тоном — как chips в ключах доступа */}
            <Progress value={sub.whitelistUsedGB} max={sub.whitelistGB} tone="amber" />
          </div>
        )}
      </div>

      <Separator className="my-6" />

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
            transition={{ delay: 0.2 + i * 0.05 }}
            className="flex items-center gap-3"
          >
            <IconTile size="sm">
              {d.os === "macOS" || d.os === "Windows" ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
            </IconTile>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{d.name}</p>
              <p className={cn("text-sm", d.connectedNow ? "text-mint-400" : "text-fog-600")}>
                {d.connectedNow ? "Подключено сейчас" : "Не в сети"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-fog-500 hover:bg-red-500/10 hover:text-red-400"
              onClick={() => disconnectDevice(sub.id, d.id)}
            >
              Отключить
            </Button>
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
  const { availableTrials, config, reload, subscriptions, tariffGroups, toast } = useApp();
  const { state } = useClientAuth();
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | undefined>(subscriptions[0]?.id);
  const [renewOpen, setRenewOpen] = useState(false);

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
      <div className="flex flex-col gap-4">
        <PageHeader />
        <div><h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Кабинет</h1><p className="mt-1 text-fog-500">Ваша подписка и подключённые устройства</p></div>
        <section className="glass-strong liquid mx-auto w-full max-w-xl rounded-4xl p-6 text-center sm:p-8">
          <EmptyState
            icon={Package}
            title="Подписка ещё не выбрана"
            description="Выберите тариф, чтобы получить ключ доступа и подключить VPN."
            className="py-2"
          >
            {availableTrials.length > 0 && (
              <Link to="/cabinet/dashboard?trial=1" className={cn(buttonVariants({ size: "lg" }), "w-full max-w-xs")}>
                <Gift />
                Активировать пробный период
              </Link>
            )}
            <Link to="/cabinet/tariffs" className={cn(buttonVariants({ size: "lg" }), "w-full max-w-xs")}>
              <ShoppingBag />
              Выбрать тариф
            </Link>
          </EmptyState>
        </section>
        {trialDialog}
        <BindTelegramDialog open={bindOpen} onClose={() => setParams({})} />
        <EmailHintDialog />
        {registrationDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader />

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Кабинет</h1>
        <p className="mt-1 text-fog-500">Ваша подписка и подключённые устройства</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <AnimatePresence mode="wait">
          {main && <MainSubscriptionCard key={main.id} sub={main} />}
        </AnimatePresence>

        <div className="flex flex-col gap-4">
          <motion.section
            className="glass rounded-4xl p-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
          >
            <h3 className="text-base font-extrabold">Быстрые действия</h3>
            <div className="mt-4 flex flex-col gap-2.5">
              <Link
                to="/cabinet/tariffs"
                onClick={(event) => { if (renewalPlan) { event.preventDefault(); setRenewOpen(true); } }}
                className={cn(buttonVariants({ size: "lg" }), "w-full justify-start")}
              >
                <RefreshCw />
                Продлить подписку
              </Link>
              {config?.sellOptions?.some((option) => option.kind === "traffic") && (
                <Link to="/cabinet/tariffs#traffic" className={cn(buttonVariants({ variant: "secondary", size: "md" }), "w-full justify-start")}>
                  <PackagePlus />
                  Докупить трафик
                </Link>
              )}
              <Link to={`/cabinet/subscribe?sub=${main.id}`} className={cn(buttonVariants({ variant: "secondary", size: "md" }), "w-full justify-start")}>
                <KeyRound />
                Открыть ключи доступа
              </Link>
              {availableTrials.length > 0 && (
                <Link to="/cabinet/dashboard?trial=1" className={cn(buttonVariants({ variant: "secondary", size: "md" }), "w-full justify-start")}>
                  <Gift />
                  Активировать пробный период
                </Link>
              )}
              <Link to="/cabinet/tariffs" className={cn(buttonVariants({ variant: "secondary", size: "md" }), "w-full justify-start")}>
                <ShoppingBag />
                Все тарифы
              </Link>
            </div>
          </motion.section>

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
    </div>
  );
}
