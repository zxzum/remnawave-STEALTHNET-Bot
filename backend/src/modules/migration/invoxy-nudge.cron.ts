import cron from "node-cron";
import { env } from "../../config/index.js";
import { prisma } from "../../db.js";
import { registerCron, wrapCronTick } from "../diagnostics/cron-registry.js";
import { sendTelegramToUser } from "../notification/telegram-notify.service.js";
import { getSystemConfig } from "../client/client.service.js";
import { isMailConfigured, mailConfigFromSystem, sendEmail } from "../mail/mail.service.js";

/**
 * Напоминание «перенесите подписку в Invoxy» клиентам с живой платной подпиской, которые ещё не перенеслись
 * (перенесённых Invoxy блокирует через annulClientForMigration → isBlocked). Telegram — через день в 12:00 МСК;
 * только-почта — по понедельникам (у Resend лимит 100 писем в сутки, держим не больше EMAIL_CAP за прогон).
 */
const NAME = "invoxy-migration-nudge";
const EXPRESSION = "0 12 */2 * *";
const EMAIL_CAP = 50;
const BOT_URL = "https://t.me/invoxy_bot";
const ARTICLE_URL = "https://telegra.ph/Bolshoe-obnovlenie-Invoxy-VPN-11-16";
const LAZEIKA_PROFILE = "https://bot.lazeika.xyz/cabinet/profile";

export function daysLeft(expireAt: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((expireAt.getTime() - now.getTime()) / 86_400_000));
}

const dayWord = (n: number) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "день";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "дня";
  return "дней";
};

export function nudgeTelegramText(days: number): string {
  return [
    "⏳ <b>Ваша подписка всё ещё в Лазейке</b>",
    `Осталось ${days} ${dayWord(days)}. Лазейка больше не развивается — новые серверы, оплата и поддержка теперь в Invoxy VPN.`,
    "",
    "<b>Перенос — меньше минуты:</b>",
    `1. Откройте <a href="${BOT_URL}">@invoxy_bot</a> с этого аккаунта Telegram и нажмите «Старт».`,
    "2. Примите условия и подпишитесь на канал @invoxyvpn.",
    "3. Подписка перенесётся сама: оставшиеся дни сохранятся, плюс <b>5 дней в подарок</b>.",
    "",
    `Что изменилось — <a href="${ARTICLE_URL}">в статье</a>.`,
  ].join("\n");
}

export function nudgeEmailHtml(days: number): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:560px">
<p><b>Ваша подписка всё ещё в Лазейке — осталось ${days} ${dayWord(days)}.</b></p>
<p>Лазейка больше не развивается: новые серверы, оплата и поддержка теперь в Invoxy VPN. Перенесите подписку — оставшиеся дни сохранятся, и мы добавим <b>5 дней в подарок</b>.</p>
<p><b>Как перенести, если вы входили по почте:</b></p>
<ol>
<li>Войдите в <a href="${LAZEIKA_PROFILE}">кабинет Лазейки</a> по этой почте, откройте «Профиль» и нажмите «Привязать Telegram».</li>
<li>Откройте <a href="${BOT_URL}">@invoxy_bot</a> с этого же Telegram и нажмите «Старт».</li>
<li>Примите условия и подпишитесь на канал @invoxyvpn — подписка перенесётся сама.</li>
</ol>
<p>Регистрация на сайте Invoxy по почте подписку не перенесёт — нужен привязанный Telegram.</p>
<p>Все изменения — <a href="${ARTICLE_URL}">в статье</a>. Если не получается — напишите в <a href="${BOT_URL}">@invoxy_bot</a>, поможем вручную.</p>
</div>`;
}

/** Клиенты с живой платной (не пробной, не подаренной) подпиской, ещё не перенесённые. */
async function pending(now: Date) {
  const subWhere = { expireAt: { gt: now }, trialId: null, giftedToClientId: null };
  const clients = await prisma.client.findMany({
    where: { isBlocked: false, ownedSubscriptions: { some: subWhere } },
    select: {
      id: true,
      email: true,
      telegramId: true,
      telegramUnreachable: true,
      ownedSubscriptions: { where: subWhere, select: { expireAt: true } },
    },
  });
  return clients.map((c) => ({
    ...c,
    days: daysLeft(new Date(Math.max(...c.ownedSubscriptions.map((s) => s.expireAt!.getTime()))), now),
  }));
}

export async function runInvoxyNudge(now = new Date()) {
  const clients = await pending(now);
  let telegram = 0, email = 0;
  for (const c of clients) {
    if (!c.telegramId || c.telegramUnreachable) continue;
    await sendTelegramToUser(c.telegramId, nudgeTelegramText(c.days), null, {
      inline_keyboard: [[{ text: "Перенести в Invoxy", url: BOT_URL }], [{ text: "Что изменилось", url: ARTICLE_URL }]],
    }, { clientIdForBotToken: c.id });
    telegram++;
    await new Promise((r) => setTimeout(r, 100));
  }
  // Почта — только тем, до кого не достучаться в Telegram, и раз в неделю (12:00 МСК понедельника).
  const isMonday = new Date(now.getTime() + 3 * 3_600_000).getUTCDay() === 1;
  if (isMonday) {
    const mail = mailConfigFromSystem(await getSystemConfig());
    if (isMailConfigured(mail)) {
      for (const c of clients.filter((x) => x.email && (!x.telegramId || x.telegramUnreachable)).slice(0, EMAIL_CAP)) {
        const r = await sendEmail(mail, c.email!, "Перенесите подписку Лазейки в Invoxy VPN — 5 дней в подарок", nudgeEmailHtml(c.days));
        if (r.ok) email++;
        else console.warn(`[${NAME}] email failed`, r.error);
      }
    }
  }
  console.log(`[${NAME}] pending=${clients.length} telegram=${telegram} email=${email}`);
  return { pending: clients.length, telegram, email };
}

export function startInvoxyNudge() {
  if (!env.INVOXY_ONLY) return; // напоминаем только в режиме переезда
  const run = () => runInvoxyNudge();
  registerCron({ name: NAME, cron: EXPRESSION, description: "Напоминание перенести подписку в Invoxy (TG через день, почта по пн)", trigger: run });
  cron.schedule(EXPRESSION, wrapCronTick(NAME, run), { timezone: "Europe/Moscow" });
}
