import { motion } from "framer-motion";
import { Send, ExternalLink, Sparkles, Gift } from "lucide-react";
import { buttonVariants } from "./ui/button";
import { cn } from "../lib/cn";

export function InvoxyMigrationBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-3xl border border-cyan-500/30 bg-gradient-to-r from-cyan-950/70 via-indigo-950/50 to-purple-950/70 p-5 shadow-2xl backdrop-blur-xl"
    >
      {/* Decorative background glow */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-purple-500/15 blur-3xl" />

      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-xs font-bold text-cyan-300 border border-cyan-500/30">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
              ПЕРЕЕЗД В INVOXY VPN
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-extrabold text-emerald-400 border border-emerald-500/30">
              <Gift className="h-3.5 w-3.5 text-emerald-400" />
              +5 ДНЕЙ БОНУСА
            </span>
          </div>

          <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
            Перенесите подписку в Invoxy VPN
          </h3>

          <p className="text-xs sm:text-sm text-fog-400 max-w-2xl leading-relaxed">
            Лазейка ВПН переезжает на новую технологическую платформу <b>Invoxy</b>. Ваши ключи,
            устройства и баланс сохраняются, лимиты трафика сбрасываются, а срок подписки продлевается на <b>+5 дней в подарок</b>!
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <a
            href="https://t.me/invoxy_bot?start=migrate"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "primary", size: "sm" }),
              "gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold hover:brightness-110 shadow-neon-blue h-10 px-4",
            )}
          >
            <Send className="h-4 w-4" />
            В бот @invoxy_bot
          </a>
          <a
            href="https://invoxy.my"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "gap-2 border-white/20 hover:border-white/40 hover:bg-white/10 text-fog-200 h-10 px-4",
            )}
          >
            <ExternalLink className="h-4 w-4" />
            invoxy.my
          </a>
        </div>
      </div>
    </motion.div>
  );
}
