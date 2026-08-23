import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Globe, MessageCircle, UserPlus, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AuroraTab = { to: string; label: string; icon: LucideIcon };

const TABS: AuroraTab[] = [
  { to: "/cabinet/dashboard", label: "Подписка", icon: Globe },
  { to: "/cabinet/tariffs", label: "Тарифы", icon: Wallet },
  { to: "/cabinet/referral", label: "Друзья", icon: UserPlus },
  { to: "/cabinet/tickets", label: "Поддержка", icon: MessageCircle },
];

export function AuroraTabs() {
  const location = useLocation();

  return (
    <nav
      aria-label="Основная навигация кабинета Лазейка ВПН"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-5"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
    >
      <div
        className="pointer-events-auto mx-auto flex max-w-[340px] items-center justify-between gap-1 rounded-full px-2 py-2"
        style={{
          background: "color-mix(in srgb, var(--au-nav) 78%, transparent)",
          backdropFilter: "blur(22px) saturate(180%)",
          WebkitBackdropFilter: "blur(22px) saturate(180%)",
          border: "1px solid color-mix(in srgb, var(--au-ink) 10%, transparent)",
          boxShadow: "0 8px 32px -8px color-mix(in srgb, var(--au-ink) 22%, transparent), inset 0 1px 0 rgba(255,255,255,0.85)",
        }}
      >
        {TABS.map((tab) => {
          const active = location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
            >
              {active && (
                <motion.span
                  layoutId="aurora-tab-dot"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "linear-gradient(135deg, var(--au-from), var(--au-to))",
                    boxShadow: "0 6px 16px -4px color-mix(in srgb, var(--au-from) 55%, transparent), inset 0 1px 0 rgba(255,255,255,0.45)",
                  }}
                />
              )}
              <Icon
                aria-hidden="true"
                className={cn("relative z-10 h-[22px] w-[22px] transition-colors", active ? "text-white" : "text-[var(--au-muted)]")}
                strokeWidth={active ? 2.5 : 2}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
