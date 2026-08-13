import assert from "node:assert/strict";
import test from "node:test";
import { buildMainMenuSummary, selectPrimarySubscription } from "./main-menu-summary.js";

const gb = 1024 ** 3;
const active = {
  type: "root" as const,
  id: "client-1",
  subscriptionIndex: 0,
  tariffId: "standard",
  tariffDisplayName: "Стандартный",
  subscription: {
    status: "ACTIVE",
    expireAt: "2026-09-13T10:00:00.000Z",
    userTraffic: { usedTrafficBytes: 67 * gb },
    trafficLimitBytes: 0,
  },
  trafficQuota: {
    usedBytes: String(12 * gb),
    limitBytes: String(50 * gb),
  },
};

test("активная подписка показывает тариф, белый и общий трафик", () => {
  const text = buildMainMenuSummary({
    subscription: active,
    tariff: { id: "standard", name: "Стандартный", price: 299, currency: "RUB", durationDays: 30, trafficLimitBytes: 50 * gb },
    now: new Date("2026-08-13T00:00:00.000Z"),
  });
  assert.match(text, /👋 Добро пожаловать в Лазейка ВПН!/);
  assert.match(text, /🛡 Ваша подписка: 🟢 Активна/);
  assert.match(text, /📅 Дата окончания: 13 сентября 2026 г\./);
  assert.match(text, /☁️ Белый интернет: 12 ГБ из 50 ГБ/);
  assert.match(text, /📊 Общий трафик: 67 ГБ · безлимит/);
  assert.match(text, /📦 Ваш тариф: Стандартный · 299 ₽\/мес\./);
  assert.match(text, /🌐 Включено: 50 ГБ белого интернета/);
});

test("отсутствующая подписка не выдумывает дату и трафик", () => {
  assert.equal(buildMainMenuSummary({ subscription: null, tariff: null }), [
    "👋 Добро пожаловать в Лазейка ВПН!",
    "",
    "🛡 Ваша подписка: 🔴 Не активна",
    "📦 Ваш тариф: не выбран",
    "",
    "Выберите действие 👇",
  ].join("\n"));
});

test("истёкшая подписка и ограниченный общий трафик форматируются явно", () => {
  const text = buildMainMenuSummary({
    subscription: {
      ...active,
      subscription: {
        status: "EXPIRED",
        expireAt: "2026-08-01T00:00:00.000Z",
        userTraffic: { usedTrafficBytes: 20 * gb },
        trafficLimitBytes: 100 * gb,
      },
      trafficQuota: null,
    },
    tariff: { id: "standard", name: "Стандартный", price: 299, currency: "RUB", durationDays: 30 },
  });
  assert.match(text, /🛡 Ваша подписка: 🔴 Истекла/);
  assert.match(text, /📊 Общий трафик: 20 ГБ из 100 ГБ/);
  assert.doesNotMatch(text, /Белый интернет/);
});

test("primary выбирается раньше secondary", () => {
  assert.equal(selectPrimarySubscription([{ ...active, type: "secondary", id: "s1", subscriptionIndex: 1 }, active])?.id, "client-1");
});
