import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import * as Accordion from "@radix-ui/react-accordion";
import * as Dialog from "@radix-ui/react-dialog";
import {
  KeyRound,
  Lock,
  ChevronDown,
  Download,
  CircleHelp,
  CircleAlert,
  TriangleAlert,
  Zap,
  ShoppingBag,
  Gift,
  X,
} from "lucide-react";
import { useApp } from "../store/AppContext";
import { CopyButton } from "../components/ui/CopyButton";
import { cn } from "../lib/cn";

const appColors: Record<string, { tile: string; btn: string }> = {
  blue: {
    tile: "bg-accent-500/15 border-accent-400/25 text-accent-400",
    btn: "btn-primary",
  },
  violet: {
    tile: "bg-violet-glow/15 border-violet-glow/25 text-violet-glow",
    btn: "btn-ghost border-violet-glow/30 hover:border-violet-glow/50",
  },
};

const manualConnectionSteps = [
  "Скопируйте ссылку подписки кнопкой выше.",
  "Откройте приложение HAPP или INCY.",
  "Нажмите «+» для добавления подписки.",
  "Вставьте ссылку из буфера обмена и подтвердите добавление.",
  "В списке серверов выберите «Авто».",
  "Нажмите большую кнопку подключения и пользуйтесь VPN.",
];

function detectPlatform() {
  const telegramPlatform = (window as { Telegram?: { WebApp?: { platform?: string } } }).Telegram?.WebApp?.platform;
  if (telegramPlatform === "ios") return "ios";
  if (telegramPlatform === "android" || telegramPlatform === "android_x") return "android";
  if (telegramPlatform === "macos") return "macos";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/mac/.test(ua)) return "macos";
  if (/linux/.test(ua)) return "linux";
  return "windows";
}

function DeeplinkButtons({ apps, keyUrl }: { apps: ReturnType<typeof useApp>["clientApps"]; keyUrl: string }) {
  const { toast } = useApp();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const showHelpAfterReturn = () => {
      if (document.visibilityState !== "visible") return;
      const pending = sessionStorage.getItem("stealthnet-connect-pending");
      if (pending !== keyUrl) return;
      sessionStorage.removeItem("stealthnet-connect-pending");
      setHelpOpen(true);
    };
    document.addEventListener("visibilitychange", showHelpAfterReturn);
    return () => document.removeEventListener("visibilitychange", showHelpAfterReturn);
  }, [keyUrl]);

  const openAppLink = (href: string) => {
    const tg = (window as { Telegram?: { WebApp?: { initData?: string; openLink?: (url: string, options?: { try_instant_view?: boolean }) => void } } }).Telegram?.WebApp;
    const isMiniapp = Boolean(tg?.initData);
    const bridgeUrl = isMiniapp
      ? `${window.location.origin}/api/public/deeplink?url=${encodeURIComponent(href)}`
      : href;
    if (isMiniapp && tg?.openLink) tg.openLink(bridgeUrl, { try_instant_view: false });
    else if (isMiniapp) window.open(bridgeUrl, "_blank", "noopener,noreferrer");
    else window.location.href = href;
  };
  return (
    <>
      <div className="grid gap-3 min-[420px]:grid-cols-2">
        {apps.filter((app) => app.canConnect).map((app, index) => (
          <motion.button
          key={app.id}
          whileTap={{ scale: 0.96 }}
          onClick={() => {
            sessionStorage.setItem("stealthnet-connect-pending", keyUrl);
            openAppLink(app.deeplink(keyUrl));
            toast({
              title: `Открываем ${app.name}…`,
              description: "Если приложение не открылось — скачайте его ниже",
              variant: "info",
            });
          }}
          className={cn(index === 0 ? "btn-primary" : "btn-ghost border-violet-glow/30 hover:border-violet-glow/50", "flex-col gap-1.5 rounded-3xl px-3 py-4 text-sm")}
        >
          <span className="flex items-center gap-2 text-base font-bold">
            <Zap className="h-4 w-4" />
            Подключиться в {app.name}
          </span>
          <span className="text-xs font-medium opacity-70">Ключ подставится сам — без копирования</span>
          </motion.button>
        ))}
      </div>
      <Dialog.Root open={helpOpen} onOpenChange={setHelpOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm" />
          <Dialog.Content className="glass-strong fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-4xl p-6">
            <Dialog.Close className="absolute top-4 right-4 rounded-lg p-2 text-fog-500 hover:bg-white/10 hover:text-white" aria-label="Закрыть">
              <X className="h-5 w-5" />
            </Dialog.Close>
            <Dialog.Title className="pr-8 text-xl font-extrabold">Не получилось добавить подписку?</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-fog-400">
              Ничего страшного — добавьте подписку вручную через ссылку.
            </Dialog.Description>
            <ol className="mt-5 space-y-3 text-sm text-fog-300">
              <li><b className="text-white">1.</b> Скопируйте ссылку ниже.</li>
              <li><b className="text-white">2.</b> Откройте HAPP или INCY и нажмите «+».</li>
              <li><b className="text-white">3.</b> Вставьте ссылку из буфера обмена.</li>
              <li><b className="text-white">4.</b> Выберите сервер «Авто».</li>
              <li><b className="text-white">5.</b> Нажмите кнопку подключения и пользуйтесь VPN.</li>
            </ol>
            <div className="glass-inset mt-5 break-all rounded-2xl p-3 font-mono text-xs text-fog-300">{keyUrl}</div>
            <CopyButton text={keyUrl} label="Скопировать ссылку" className="mt-3" />
            <Dialog.Close className="btn-ghost mt-3 w-full justify-center">Закрыть</Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export default function Keys() {
  const { availableTrials, clientApps, subscriptions } = useApp();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("sub") ?? subscriptions[0]?.id;
  const active = useMemo(
    () => subscriptions.find((s) => s.id === activeId) ?? subscriptions[0],
    [subscriptions, activeId],
  );
  const apps = clientApps.filter((app) => app.platforms.includes(detectPlatform()));
  const primaryApp = apps[0];

  if (!active) return (
    <div className="flex flex-col gap-5">
      <div><h1 className="text-3xl font-extrabold tracking-tight">Ключи доступа</h1><p className="mt-1 text-fog-500">Получите доступ за пару минут</p></div>
      <section className="glass-strong liquid mx-auto w-full max-w-xl rounded-4xl p-7 text-center sm:p-9">
        <div className="icon-tile mx-auto h-16 w-16 rounded-2xl"><KeyRound className="h-7 w-7" /></div>
        <h2 className="mt-5 text-xl font-extrabold">Ключа пока нет</h2>
        <p className="mt-2 text-sm leading-relaxed text-fog-500">Сначала выберите и оплатите тариф — после этого здесь появится ключ для подключения VPN.</p>
        {availableTrials.length > 0 && <Link to="/cabinet?trial=1" className="btn-primary mt-4 px-6 py-4"><Gift className="h-5 w-5" />Активировать пробный период</Link>}
        <Link to="/cabinet/tariffs" className="btn-primary mt-6 px-6 py-4"><ShoppingBag className="h-5 w-5" />Перейти к тарифам</Link>
      </section>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Ключи доступа</h1>
        <p className="mt-1 text-fog-500">Получите доступ за пару минут</p>
      </div>

      {subscriptions.length > 1 && (
        <div>
          <p className="mb-2 text-xs font-bold tracking-wider text-fog-500 uppercase">Выбор подписки</p>
          <div className="no-scrollbar glass flex gap-1 overflow-x-auto rounded-2xl p-1.5">
            {subscriptions.map((s) => {
              const isActive = s.id === active.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setParams({ sub: s.id })}
                  className={cn(
                    "relative min-w-28 shrink-0 grow basis-28 rounded-xl px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors",
                    isActive ? "text-white" : "text-fog-500 hover:text-fog-100",
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="sub-tab"
                      className="absolute inset-0 rounded-xl bg-accent-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_16px_-4px_rgba(77,124,254,0.6)]"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10">{s.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Key card */}
          <AnimatePresence mode="wait">
        <motion.section
          key={active.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="glass-strong liquid rounded-4xl p-6"
        >
          <div className="flex items-center gap-4">
            <div className="icon-tile h-14 w-14 rounded-2xl shadow-neon-blue">
              <KeyRound className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-extrabold">Основной ключ</h2>
              <p className="text-sm text-fog-500">{active.protocol}</p>
            </div>
            <span className="flex items-center gap-2 text-sm font-bold text-mint-400">
              <span className="status-dot" />
              Активен
            </span>
          </div>

          <div className="glass-inset mt-5 flex items-center gap-3 rounded-2xl px-4 py-3.5">
            <Lock className="h-4 w-4 shrink-0 text-fog-600" />
            <span className="truncate font-mono text-sm text-fog-300">{active.keyUrl}</span>
          </div>

          <div className="mt-4">
            <CopyButton text={active.keyUrl} />
          </div>
        </motion.section>
      </AnimatePresence>

      {/* Deep links */}
      <DeeplinkButtons apps={apps} keyUrl={active.keyUrl} />

          {/* Warnings */}
          <div className="glass grid rounded-3xl lg:grid-cols-2">
            <div className="flex items-center gap-3 p-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-400/25 bg-red-500/12 text-red-400">
                <CircleAlert className="h-5 w-5" />
              </div>
              <p className="text-sm leading-snug text-fog-300">
                <span className="font-bold text-red-300">Не передавайте ключ</span> — блокировка без возврата средств.
              </p>
            </div>
            <div className="flex items-center gap-3 border-t border-white/8 p-4 lg:border-t-0 lg:border-l">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-glow/25 bg-amber-glow/10 text-amber-glow">
                <TriangleAlert className="h-5 w-5" />
              </div>
              <p className="text-sm leading-snug text-fog-300">
                Работает только через приложение <span className="font-bold text-amber-glow">Happ</span> или{" "}
                <span className="font-bold text-violet-glow">INCY</span>.
              </p>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          {/* Accordions */}
      <Accordion.Root type="single" collapsible className="flex flex-col gap-3">
        {apps.map((app, index) => (
          <Accordion.Item key={app.id} value={app.id} className="glass overflow-hidden rounded-3xl">
            <Accordion.Header>
              <Accordion.Trigger className="group flex w-full items-center gap-4 p-5 text-left">
                <div className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-2xl border", index === 0 ? appColors.blue.tile : "border-white/10 bg-white/5 text-fog-400")}>
                  <Download className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-extrabold">Скачать {app.name}</p>
                  <p className="text-sm text-fog-500">{app.stores}</p>
                </div>
                <ChevronDown className="h-5 w-5 text-fog-600 transition-transform duration-300 group-data-[state=open]:rotate-180" />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="overflow-hidden data-[state=closed]:animate-[accordion-up_0.25s_ease-out] data-[state=open]:animate-[accordion-down_0.25s_ease-out]">
              <div className="flex flex-wrap gap-3 px-5 pb-5">
                {app.downloads.map((download) => <a key={download.url} href={download.url} target="_blank" rel="noopener noreferrer" className="btn-ghost flex-1 px-4 py-3 text-sm"><Download className="h-4 w-4" /> {download.label}</a>)}
                {app.downloads.length === 0 && <p className="text-sm text-fog-500">Ссылки на загрузку пока не настроены.</p>}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        ))}

        {primaryApp && <Accordion.Item value="howto" className="glass overflow-hidden rounded-3xl">
          <Accordion.Header>
            <Accordion.Trigger className="group flex w-full items-center gap-4 p-5 text-left">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-mint-400/25 bg-mint-500/12 text-mint-400">
                <CircleHelp className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-extrabold">Как подключиться</p>
                <p className="text-sm text-fog-500">6 простых шагов</p>
              </div>
              <ChevronDown className="h-5 w-5 text-fog-600 transition-transform duration-300 group-data-[state=open]:rotate-180" />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="overflow-hidden data-[state=closed]:animate-[accordion-up_0.25s_ease-out] data-[state=open]:animate-[accordion-down_0.25s_ease-out]">
            <ol className="flex flex-col gap-3 px-5 pb-5">
              {manualConnectionSteps.map((step, i) => (
                <li key={i} className="glass-inset flex items-center gap-3 rounded-2xl px-4 py-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-500/15 text-xs font-extrabold text-accent-400">
                    {i + 1}
                  </span>
                  <span className="text-sm text-fog-300">{step}</span>
                </li>
              ))}
            </ol>
          </Accordion.Content>
        </Accordion.Item>}
      </Accordion.Root>
      {apps.length === 0 && <div className="glass rounded-3xl p-6 text-center text-sm text-fog-500">Для этого устройства приложения ещё не настроены администратором.</div>}
        </div>
      </div>
    </div>
  );
}
