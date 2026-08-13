import type { LandingApiResponse } from "@/components/landing-blocks/types";
import type { PublicTariffCategory } from "@/lib/api";

export interface LandingTariff {
  id: string;
  name: string;
  description: string;
  price: number;
  trafficGb: number | null;
  devices: number;
  popular?: boolean;
}

export type LandingFaq = [question: string, answer: string][];

export const FALLBACK_TARIFFS: LandingTariff[] = [
  { id: "standard", name: "Стандарт", description: "Для ежедневного доступа", price: 200, trafficGb: 50, devices: 5 },
  { id: "optimal", name: "Оптимальный", description: "Баланс скорости и запаса", price: 300, trafficGb: 100, devices: 5, popular: true },
  { id: "premium", name: "Премиум", description: "Когда свободы нужно больше", price: 400, trafficGb: 150, devices: 5 },
  { id: "ordinary", name: "Обычный ВПН", description: "Без белых списков", price: 120, trafficGb: 350, devices: 3 },
];

export const FALLBACK_FAQ: LandingFaq = [
  ["Что такое Лазейка ВПН?", "Это сервис защищённого доступа к интернету. Кабинет сам определяет устройство, предлагает приложение и выдаёт готовую подписку."],
  ["Обязательно создавать аккаунт?", "Нет. Можно открыть Telegram-бот и подключиться без регистрации на сайте."],
  ["Сколько занимает подключение?", "Обычно около минуты: выбираешь тариф, добавляешь подписку в приложение и включаешь соединение."],
  ["Сколько устройств можно подключить?", "Лимит зависит от тарифа и всегда указан на его карточке."],
  ["Что делать, если не получается подключиться?", "Напиши в Telegram-поддержку. Мы поможем выбрать приложение и проверить подписку."],
];

export function mapPublicTariffs(categories: PublicTariffCategory[]): LandingTariff[] {
  const tariffs = categories.flatMap((category) => category.tariffs).map((tariff) => {
    const bytes = Number(tariff.trafficLimitBytes);
    return {
      id: tariff.id,
      name: tariff.name,
      description: tariff.description || "Защищённый доступ без лишних настроек",
      price: tariff.price,
      trafficGb: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1024 ** 3) : null,
      devices: tariff.includedDevices || tariff.deviceLimit || 1,
      popular: tariff.name.trim().toLocaleLowerCase("ru-RU") === "оптимальный",
    };
  });
  return tariffs.length ? tariffs : FALLBACK_TARIFFS;
}

export function resolveFaq(landing: LandingApiResponse | null): LandingFaq {
  const items = landing?.blocks.find((block) => block.type === "faq")?.text.items;
  if (!Array.isArray(items)) return FALLBACK_FAQ;
  const faq = items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { q, a } = item as { q?: unknown; a?: unknown };
    return typeof q === "string" && q.trim() && typeof a === "string" && a.trim()
      ? [[q.trim(), a.trim()] as [string, string]]
      : [];
  });
  return faq.length ? faq : FALLBACK_FAQ;
}

export function telegramUrl(username: string | null | undefined, fallback: string): string {
  const value = username?.trim() || fallback;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://t.me/${value.replace(/^@/, "")}`;
}
