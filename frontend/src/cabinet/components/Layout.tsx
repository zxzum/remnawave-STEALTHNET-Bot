import { useEffect, useLayoutEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, useOutlet } from "react-router-dom";
import { motion } from "framer-motion";
import { Home, KeyRound, Package, UserRound, LogOut, Wallet } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { FloatingChat } from "@/components/floating-chat";
import { cn } from "../lib/cn";
import { formatCurrency } from "../model";
import { useApp } from "../store/AppContext";
import { Toasts } from "./ui/Toasts";

const navItems = [
  { to: "/cabinet/dashboard", label: "Кабинет", icon: Home, end: true },
  { to: "/cabinet/subscribe", label: "Мои ключи", icon: KeyRound },
  { to: "/cabinet/tariffs", label: "Тарифы", icon: Package },
];

export function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,#171031_0%,#070512_55%)]" />
      <div className="animate-float-slow absolute -top-40 left-1/4 h-[34rem] w-[34rem] rounded-full bg-accent-600/16 blur-[130px]" />
      <div
        className="animate-float-slow absolute top-1/3 -right-40 h-[30rem] w-[30rem] rounded-full bg-violet-glow/10 blur-[140px]"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="animate-float-slow absolute -bottom-48 -left-32 h-[30rem] w-[30rem] rounded-full bg-mint-500/8 blur-[150px]"
        style={{ animationDelay: "-3s" }}
      />
      {/* subtle grid */}
      <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:56px_56px]" />
    </div>
  );
}

function Avatar({ size = "md" }: { size?: "md" | "lg" }) {
  const { user } = useApp();
  const [photoFailed, setPhotoFailed] = useState(false);
  const photoUrl = typeof window !== "undefined"
    ? (window as Window & { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { photo_url?: string } } } } }).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url
    : undefined;
  const showPhoto = Boolean(photoUrl && !photoFailed);
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-extrabold text-ink-950",
        "bg-gradient-to-br from-mint-400 to-emerald-500 shadow-neon-mint",
        size === "md" ? "h-11 w-11 text-sm" : "h-14 w-14 text-lg",
      )}
    >
      {showPhoto ? <img src={photoUrl} alt="" className="h-full w-full rounded-full object-cover" onError={() => setPhotoFailed(true)} /> : user.initials}
    </div>
  );
}

function Sidebar() {
  const { user } = useApp();
  const { logout } = useClientAuth();
  const navigate = useNavigate();
  return (
    <aside className="fixed top-6 bottom-6 left-6 z-40 hidden w-72 lg:block">
      <div className="glass liquid flex h-full flex-col rounded-4xl p-5">
        {/* account */}
        <div className="flex items-center gap-3 px-1">
          <Avatar />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold">{user.name}</p>
            <p className="text-xs text-fog-500">ID: {user.telegramId}</p>
          </div>
        </div>

        <div className="my-5 h-px bg-white/8" />

        {/* nav */}
        <nav className="flex flex-col gap-1.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all duration-200",
                  isActive
                    ? "bg-accent-500/15 text-accent-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_-6px_rgba(77,124,254,0.5)]"
                    : "text-fog-500 hover:bg-white/5 hover:text-fog-100",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute left-0 h-6 w-1 rounded-full bg-accent-400 shadow-[0_0_12px_2px_rgba(109,155,255,0.7)]"
                    />
                  )}
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        {/* balance plate */}
        <NavLink
          to="/cabinet/profile"
          className="glass-inset group mb-3 flex items-center gap-3 rounded-2xl p-4 transition-colors hover:border-accent-400/30"
        >
          <div className="icon-tile h-10 w-10 rounded-xl">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-wider text-fog-500 uppercase">Баланс</p>
            <p className="text-lg font-extrabold">{formatCurrency(user.balance, user.currency)}</p>
          </div>
        </NavLink>

        {/* profile + logout */}
        <NavLink
          to="/cabinet/profile"
          className={({ isActive }) =>
            cn(
              "group relative flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition-all duration-200",
              isActive
                ? "border-accent-400/30 bg-accent-500/15 text-accent-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_-6px_rgba(77,124,254,0.5)]"
                : "border-white/8 bg-white/4 text-fog-300 hover:border-white/16 hover:bg-white/8 hover:text-fog-100",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute left-0 h-6 w-1 rounded-full bg-accent-400 shadow-[0_0_12px_2px_rgba(109,155,255,0.7)]"
                />
              )}
              <UserRound className="h-[18px] w-[18px]" strokeWidth={2.2} />
              Профиль
            </>
          )}
        </NavLink>
        <button
          className="mt-1 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-fog-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
          onClick={async () => {
            await logout();
            navigate("/cabinet/login", { replace: true });
          }}
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={2.2} />
          Выйти
        </button>
      </div>
    </aside>
  );
}

function BottomNav() {
  const items = [...navItems, { to: "/cabinet/profile", label: "Профиль", icon: UserRound }];
  const location = useLocation();
  const activeIndex = Math.max(0, items.findIndex(({ to }) => location.pathname === to));
  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 max-[420px]:inset-x-2 lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="bottom-nav-glass glass-strong mx-auto max-w-md rounded-4xl border border-violet-glow/50 bg-ink-950/80 p-3 shadow-[0_18px_50px_-14px_rgba(0,0,0,0.92),0_0_28px_-10px_rgba(139,92,246,0.65)] ring-1 ring-white/10">
        <div className="relative grid grid-cols-4">
          <motion.span
            className="pointer-events-none absolute inset-y-0 left-0 w-1/4 rounded-3xl border border-accent-400/60 bg-gradient-to-br from-accent-500/30 via-violet-glow/20 to-violet-glow/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_0_26px_-4px_rgba(167,139,250,0.95)]"
            animate={{ x: `${activeIndex * 100}%` }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          />
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/cabinet/dashboard"}
            className={({ isActive }) =>
              cn(
                "relative flex flex-1 flex-col items-center gap-1 rounded-3xl py-2.5 text-xs font-semibold transition-colors",
                isActive ? "text-accent-400 drop-shadow-[0_0_10px_rgba(196,181,253,0.75)]" : "text-fog-100",
              )
            }
          >
            <Icon className="relative z-10 h-6 w-6" strokeWidth={2.2} />
            <span className="relative z-10">{label}</span>
          </NavLink>
        ))}
        </div>
      </div>
    </nav>
  );
}

function InitialSkeleton() {
  return (
    <div className="animate-pulse space-y-5" aria-label="Загрузка кабинета" aria-busy="true">
      <div className="h-9 w-48 rounded-xl bg-white/8" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="glass h-36 rounded-3xl" />)}
      </div>
      <div className="glass h-72 rounded-4xl" />
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="glass mx-auto mt-16 max-w-lg rounded-4xl p-7 text-center">
      <h1 className="text-xl font-extrabold">Не удалось загрузить кабинет</h1>
      <p className="mt-2 text-sm text-fog-500">{message}</p>
      <button className="mt-5 rounded-2xl bg-accent-500 px-5 py-3 text-sm font-bold text-white" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

export function Layout() {
  const location = useLocation();
  const { loading, error, reload } = useApp();
  const outlet = useOutlet();
  const routeKey = `${location.pathname}${location.search}`;
  const [displayedOutlet, setDisplayedOutlet] = useState(outlet);
  const [displayedRouteKey, setDisplayedRouteKey] = useState(routeKey);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    document.body.classList.add("cabinet-ui-active");
    return () => document.body.classList.remove("cabinet-ui-active");
  }, []);

  // При переходе по вкладкам скролл возвращается в начало
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (routeKey === displayedRouteKey) return;
    setIsLeaving(true);
    const timer = window.setTimeout(() => {
      setDisplayedOutlet(outlet);
      setDisplayedRouteKey(routeKey);
      setIsLeaving(false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [displayedRouteKey, outlet, routeKey]);

  return (
    <div className="relative min-h-dvh">
      <Background />
      <Sidebar />
      <BottomNav />
      <Toasts />
      <FloatingChat />
      <main className="relative z-10 mx-auto w-full max-w-2xl px-4 pt-6 pb-32 max-[420px]:px-3 max-[420px]:pt-4 sm:px-6 lg:max-w-none lg:pr-8 lg:pl-84 lg:pb-12 xl:pr-12 2xl:max-w-[1800px]">
        <motion.div
          key={displayedRouteKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: isLeaving ? 0 : 1 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {loading ? <InitialSkeleton /> : error ? <LoadError message={error} onRetry={reload} /> : displayedOutlet}
        </motion.div>
      </main>
    </div>
  );
}
