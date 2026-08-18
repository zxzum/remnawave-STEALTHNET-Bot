import { renderEmailTemplate } from "../email-templates/email-templates.service.js";
import { isMailConfigured, mailConfigFromSystem, sendEmail } from "../mail/mail.service.js";

export type ExpiryEmailKind = "trial" | "subscription";

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE[character]);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function russianUnit(value: number, one: string, few: string, many: string): string {
  if (!Number.isInteger(value)) return few;
  const last = value % 10;
  const lastTwo = value % 100;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

export function expiryEmailTemplateKey(kind: ExpiryEmailKind): "trial_expiring" | "subscription_expiring" {
  return kind === "trial" ? "trial_expiring" : "subscription_expiring";
}

export function formatExpiryEmailTime(minutesLeft: number): string {
  const minutes = Math.max(0, Math.round(minutesLeft));
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${formatNumber(days)} ${russianUnit(days, "день", "дня", "дней")}`;
  }
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${formatNumber(hours)} ${russianUnit(hours, "час", "часа", "часов")}`;
  }
  return `${minutes} ${russianUnit(minutes, "минута", "минуты", "минут")}`;
}

export function buildExpiryEmailVariables(
  kind: ExpiryEmailKind,
  name: string,
  minutesLeft: number,
  config: { serviceName?: string | null; publicAppUrl?: string | null },
): Record<string, string> {
  const base = (config.publicAppUrl ?? "").trim().replace(/\/+$/, "");
  const escapedName = escapeHtml(name);
  return {
    serviceName: escapeHtml(config.serviceName?.trim() || "Лазейка ВПН"),
    trialName: escapedName,
    tariffName: escapedName,
    timeLeft: formatExpiryEmailTime(minutesLeft),
    daysLeft: String(Math.max(1, Math.ceil(minutesLeft / 1440))),
    renewUrl: `${base}/cabinet`,
  };
}

export async function sendExpiryReminderEmail(
  config: Parameters<typeof mailConfigFromSystem>[0] & { serviceName?: string | null; publicAppUrl?: string | null },
  kind: ExpiryEmailKind,
  to: string,
  name: string,
  minutesLeft: number,
): Promise<boolean> {
  const mailConfig = mailConfigFromSystem(config);
  if (!isMailConfigured(mailConfig) || !config.publicAppUrl?.trim() || !to.trim()) return false;

  try {
    const rendered = await renderEmailTemplate(
      expiryEmailTemplateKey(kind),
      buildExpiryEmailVariables(kind, name, minutesLeft, config),
    );
    if (!rendered) return false;
    const result = await sendEmail(mailConfig, to.trim(), rendered.subject, rendered.body);
    const details = {
      recipient: to.trim(),
      kind,
      minutesLeft,
      sentAt: new Date().toISOString(),
      subject: rendered.subject,
      text: rendered.body,
    };
    if (result.ok) console.info("[expiry reminder] Email notification", details);
    else console.warn("[expiry reminder] Email notification failed", { ...details, error: result.error ?? "unknown error" });
    return result.ok;
  } catch (error) {
    console.warn("[expiry email] send failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}
