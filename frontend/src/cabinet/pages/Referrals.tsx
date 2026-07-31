import { useState } from "react";
import { motion } from "framer-motion";
import { Percent, Users, Wallet, Link2, Globe, Send, Share2, Info, ClipboardCopy, MessageSquareText } from "lucide-react";
import { useApp } from "../store/AppContext";
import { CopyIconButton } from "../components/ui/CopyButton";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { formatCurrency } from "../model";

function LinkRow({
  icon: Icon,
  tile,
  label,
  link,
}: {
  icon: typeof Globe;
  tile: string;
  label: string;
  link: string;
}) {
  const { copy, toast } = useApp();

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Лазейка ВПН", url: link });
        return;
      } catch {
        /* отменено пользователем */
      }
    } else {
      await copy(link, "Ссылка скопирована — отправьте её другу");
    }
    toast({ title: "Поделиться", description: "Выберите, кому отправить ссылку", variant: "info" });
  };

  return (
    <div className="glass-inset flex items-center gap-3 rounded-2xl p-4">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${tile}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold tracking-wider text-fog-600 uppercase">{label}</p>
        <p className="truncate font-mono text-sm text-fog-300">{link}</p>
      </div>
      <CopyIconButton text={link} label="Ссылка скопирована" />
      <button
        onClick={share}
        aria-label="Поделиться"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent-400/25 bg-accent-500/12 text-accent-400 transition-all hover:bg-accent-500/25 hover:shadow-neon-blue active:scale-90"
      >
        <Share2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function Referrals() {
  const { state } = useClientAuth();
  const { copy, referral, config, reload, toast } = useApp();
  const currency = state.client?.preferredCurrency || "rub";
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [wallet, setWallet] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const withdrawMin = config?.withdrawalMinAmount ?? 3000;
  const stats = [
    { icon: Percent, value: `${referral.percent}%`, label: "Процент", hint: "от пополнений (1 уровень)", tile: "bg-accent-500/15 border-accent-400/25 text-accent-400" },
    { icon: Users, value: `${referral.invited}`, label: "Приглашено", hint: "активных рефералов", tile: "bg-violet-glow/15 border-violet-glow/25 text-violet-glow" },
    { icon: Wallet, value: formatCurrency(referral.earned, currency), label: "Заработок", hint: "зачислено на баланс", tile: "bg-mint-500/15 border-mint-400/25 text-mint-400" },
  ];

  const serviceName = config?.serviceName || "Лазейка VPN";
  const readyText = `🚀 Пользуюсь ВПН «${serviceName}» — быстрый и стабильный. Присоединяйся по моей ссылке:\n\n🌐 Сайт: ${referral.siteLink}\n🤖 Бот: ${referral.botLink}`;

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start">
      <div className="order-1 lg:col-span-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Рефералы</h1>
        <p className="mt-1 text-fog-500">Приглашайте друзей и получайте процент с их пополнений.</p>
      </div>

      {/* stats — на ПК сверху, просторные карточки */}
      <div className="order-2 hidden sm:grid sm:grid-cols-3 sm:gap-4 lg:col-span-2">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="glass liquid rounded-3xl p-6"
          >
            <div className={`grid h-12 w-12 place-items-center rounded-xl border ${s.tile}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <p className="mt-5 text-4xl font-extrabold tracking-tight">{s.value}</p>
            <p className="mt-1.5 text-sm font-bold text-fog-300">{s.label}</p>
            <p className="text-xs text-fog-600">{s.hint}</p>
          </motion.div>
        ))}
      </div>

      {/* links */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass order-3 rounded-4xl p-5 sm:p-6"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="icon-tile h-11 w-11 rounded-xl">
            <Link2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-extrabold">Ваши ссылки</h2>
            <p className="text-xs text-fog-500">Копируйте, делитесь с друзьями или отправьте готовый текст</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <LinkRow icon={Globe} tile="bg-white/6 border-white/12 text-fog-300" label="Сайт" link={referral.siteLink} />
          <LinkRow icon={Send} tile="bg-accent-500/15 border-accent-400/25 text-accent-400" label="Бот" link={referral.botLink} />
        </div>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => copy(readyText, "Готовый текст скопирован")}
          className="btn-primary mt-4 w-full px-5 py-3.5 text-sm"
        >
          <MessageSquareText className="h-4 w-4" />
          Скопировать готовый текст со ссылками
        </motion.button>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-fog-600">
          <ClipboardCopy className="h-3 w-3" /> Внутри — короткий текст-приглашение и обе ссылки сразу
        </p>
      </motion.section>

      {config?.withdrawalsEnabled !== false && <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass order-5 rounded-4xl p-5 sm:p-6"><h2 className="font-extrabold">Вывести вознаграждение</h2><p className="mt-1 text-xs text-fog-500">Минимум {withdrawMin.toLocaleString("ru-RU")} ₽ · кошелёк USDT TRC20</p><div className="mt-4 grid gap-3"><input type="number" min={withdrawMin} value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="Сумма, ₽" className="input-glass" /><input value={wallet} onChange={(event) => setWallet(event.target.value.trim())} placeholder="TRC20-кошелёк" className="input-glass" /><button disabled={withdrawing || Number(withdrawAmount) < withdrawMin || !/^T[A-Za-z0-9]{33}$/.test(wallet)} onClick={async () => { if (!state.token) return; setWithdrawing(true); try { const result = await api.createWithdrawal(state.token, { amount: Math.floor(Number(withdrawAmount)), walletTrc20: wallet }); toast({ title: result.message, variant: "success" }); setWithdrawAmount(""); setWallet(""); await reload(); } catch (cause) { toast({ title: "Не удалось создать заявку", description: cause instanceof Error ? cause.message : undefined, variant: "error" }); } finally { setWithdrawing(false); } }} className="btn-primary px-5 py-3 text-sm disabled:opacity-40"><Wallet className="h-4 w-4" /> Отправить заявку</button></div></motion.section>}

      {/* stats — на мобильных под ссылками, компактная полоса */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass order-4 grid grid-cols-3 rounded-3xl sm:hidden"
      >
        {stats.map((s, i) => (
          <div key={s.label} className={`flex flex-col items-center gap-1 px-2 py-4 text-center ${i > 0 ? "border-l border-white/8" : ""}`}>
            <div className={`grid h-8 w-8 place-items-center rounded-lg border ${s.tile}`}>
              <s.icon className="h-4 w-4" />
            </div>
            <p className="mt-1 text-xl leading-none font-extrabold">{s.value}</p>
            <p className="text-[11px] leading-tight font-bold text-fog-300">{s.label}</p>
            <p className="text-[9px] leading-tight text-fog-600">{s.hint}</p>
          </div>
        ))}
      </motion.div>

      {/* how it works */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass order-5 rounded-4xl p-5 sm:p-6"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-orange-400/25 bg-orange-500/12 text-orange-400">
            <Info className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-extrabold">Как это работает</h2>
            <p className="text-xs text-fog-500">Правила начисления бонусов</p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {referral.levels.map((l) => (
            <div key={l.level} className="glass-inset flex items-start gap-3 rounded-2xl p-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/6 text-sm font-extrabold text-fog-300">
                {l.level}
              </span>
              <div>
                <p className="text-sm font-bold">
                  {l.level === 1 ? "1-я линия — ваши друзья" : l.level === 2 ? "2-я линия — друзья друзей" : "3-я линия — глубина сети"} ({l.percent}%)
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-fog-500">{l.text}</p>
              </div>
            </div>
          ))}

          <div className="glass-inset flex items-start gap-3 rounded-2xl border-mint-400/15 p-4">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-mint-500/15 text-mint-400">
              <Wallet className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold">Начисление на баланс</p>
              <p className="mt-0.5 text-xs leading-relaxed text-fog-500">
                Процент начисляется от каждой оплаты. Чем ближе пользователь к вам, тем выше бонус; сейчас сеть может вернуть до {referral.levels.reduce((sum, level) => sum + level.percent, 0)}% с одной оплаты.
              </p>
            </div>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
