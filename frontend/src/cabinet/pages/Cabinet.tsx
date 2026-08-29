import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Gift, KeyRound, ShoppingBag, Smartphone, ChevronRight, Monitor, Send, Package, Gauge, Zap, Layers } from "lucide-react";
import { useApp } from "../store/AppContext";
import { useClientAuth } from "@/contexts/client-auth";
import { TrialsPickerDialog } from "@/components/cabinet/trials-picker-dialog";
import { AnimatedNumber } from "../components/ui/animated-number";
import { Button, buttonVariants } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { IconTile } from "../components/ui/icon-tile";
import { Modal, ModalBody, ModalDescription, ModalTitle } from "../components/ui/modal";
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
              {/* Акцент на имени устройства; строкой ниже — приложение и ОС
                  (appName от remnawave; если приложения нет, app = platform — не дублируем) */}
              <p className="truncate font-bold">{d.name}</p>
              <p className="truncate text-xs text-fog-500">{d.app && d.app !== d.os ? `${d.app} · ${d.os}` : d.os}</p>
              <p className={cn("text-xs", d.connectedNow ? "text-mint-400" : "text-fog-600")}>
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
    <Modal open={open} onOpenChange={(v) => !v && onClose()} className="max-w-sm">
      <ModalBody className="p-6 text-center">
        <div className="icon-tile mx-auto h-14 w-14 rounded-2xl">
          <Send className="h-6 w-6" />
        </div>
        <ModalTitle className="mt-4 text-xl font-extrabold">Привязать Telegram?</ModalTitle>
        <ModalDescription className="mt-2 text-sm leading-relaxed text-fog-500">
          Свяжите аккаунт с Telegram-ботом — подписки, баланс и рефералы будут в одном месте, а вход станет проще.
        </ModalDescription>
        <Button
          size="lg"
          className="mt-5 w-full"
          loading={linking}
          loadingText="Открываем…"
          onClick={async () => {
            setLinking(true);
            try {
              await linkTelegram();
              onClose();
            } finally {
              setLinking(false);
            }
          }}
        >
          <Send /> Привязать Telegram
        </Button>
        <Button variant="link" className="mt-2 w-full" onClick={onClose}>
          Позже
        </Button>
      </ModalBody>
    </Modal>
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
    <Modal open={open} onOpenChange={(value) => !value && close()} className="max-w-sm">
      <ModalBody className="p-6 text-center">
        <ModalTitle className="text-xl font-extrabold">Почта — по желанию</ModalTitle>
        <ModalDescription className="mt-3 text-sm leading-relaxed text-fog-400">
          Вы уже можете пользоваться кабинетом. Если захотите входить и с сайта, привяжите почту и пароль позже в «Профиль» → «Безопасность».
        </ModalDescription>
        <Button size="lg" className="mt-5 w-full" onClick={close}>Понятно</Button>
      </ModalBody>
    </Modal>
  );
}

function RegistrationSuccessDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onOpenChange={(value) => !value && onClose()} className="max-w-sm">
      <ModalBody className="p-6 text-center">
        <div className="icon-tile mx-auto h-14 w-14 rounded-2xl"><Send className="h-6 w-6" /></div>
        <ModalTitle className="mt-4 text-xl font-extrabold">Аккаунт успешно создан</ModalTitle>
        <ModalDescription className="mt-3 text-sm leading-relaxed text-fog-400">
          Рекомендуем привязать Telegram в настройках профиля, чтобы упростить вход и управление подпиской.
        </ModalDescription>
        <Link to="/cabinet/profile" onClick={onClose} className={cn(buttonVariants({ size: "lg" }), "mt-5 w-full")}>
          <Send /> Открыть настройки
        </Link>
        <Button variant="link" className="mt-2 w-full" onClick={onClose}>
          Позже
        </Button>
      </ModalBody>
    </Modal>
  );
}

export default function Cabinet() {
  const { availableTrials, config, reload, subscriptions, tariffGroups } = useApp();
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
      onActivated={async () => {
        // Успех показывает глобальное окно (useSuccess в самом диалоге) — здесь только обновляем данные
        await reload({ soft: true });
      }}
    />
  ) : null;
  const registrationDialog = <RegistrationSuccessDialog open={registrationOpen} onClose={() => setParams({})} />;

  if (!main) {
    return (
      <div className="flex flex-col gap-4">
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
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Кабинет</h1>
        <p className="mt-1 text-fog-500">Ваша подписка и подключённые устройства</p>
      </div>

      {/* Правая колонка фиксированной ширины (300–320px), чтобы «Быстрые действия» не растягивались */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
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
            {/* Лестница акцентов из референса: primary → secondary → outline → link, контент по центру.
                Все ступени одной высоты 46px (h-[46px] перекрывает h-13/h-11 через twMerge). */}
            <div className="mt-4 flex flex-col gap-2.5">
              <Link
                to="/cabinet/tariffs"
                onClick={(event) => { if (renewalPlan) { event.preventDefault(); setRenewOpen(true); } }}
                className={cn(buttonVariants({ variant: "primary", size: "lg" }), "h-[46px] w-full")}
              >
                <Zap />
                Продлить подписку
              </Link>
              {config?.sellOptions?.some((option) => option.kind === "traffic") && (
                <Link to="/cabinet/tariffs#traffic" className={cn(buttonVariants({ variant: "secondary", size: "md" }), "h-[46px] w-full")}>
                  <Gauge />
                  Докупить трафик
                </Link>
              )}
              <Link to={`/cabinet/subscribe?sub=${main.id}`} className={cn(buttonVariants({ variant: "outline", size: "md" }), "h-[46px] w-full hover:border-white/30 hover:bg-white/10")}>
                <KeyRound />
                Открыть ключи доступа
              </Link>
              {/* link вместо ghost: token ghost рисует постоянную подложку, а по референсу 4-я ступень —
                  прозрачный текст; hover-подложку добавляем сами, чтобы все кнопки лестницы реагировали на наведение */}
              <Link to="/cabinet/tariffs" className={cn(buttonVariants({ variant: "link", size: "md" }), "h-[46px] w-full hover:bg-white/10")}>
                <Layers />
                Все тарифы
              </Link>
              {availableTrials.length > 0 && (
                <Link to="/cabinet/dashboard?trial=1" className={cn(buttonVariants({ variant: "link", size: "md" }), "h-[46px] w-full hover:bg-white/10")}>
                  <Gift />
                  Активировать пробный период
                </Link>
              )}
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
