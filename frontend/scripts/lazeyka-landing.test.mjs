import assert from "node:assert/strict";
import test from "node:test";

import {
  FALLBACK_FAQ,
  FALLBACK_TARIFFS,
  mapPublicTariffs,
  resolveFaq,
  telegramUrl,
} from "../src/pages/lazeyka-landing-model.ts";

test("maps live public tariffs into landing cards", () => {
  const description = "  Выбор большинства  \n\n  50GB белых списков  ";
  const result = mapPublicTariffs([
    {
      id: "vpn",
      name: "Белые списки",
      emojiKey: null,
      emoji: "",
      tariffs: [
        {
          id: "optimal-id",
          name: "Оптимальный",
          description,
          durationDays: 30,
          price: 300,
          currency: "rub",
          trafficLimitBytes: 107374182400,
          deviceLimit: null,
          includedDevices: 5,
          pricePerExtraDevice: 0,
          maxExtraDevices: 0,
          deviceDiscountTiers: [],
          priceOptions: [],
        },
      ],
    },
  ]);

  assert.deepEqual(result, [
    {
      id: "optimal-id",
      name: "Оптимальный",
      description,
      price: 300,
      trafficGb: 100,
      devices: 5,
      popular: true,
    },
  ]);
});

test("keeps safe tariff and FAQ fallbacks for unavailable public data", () => {
  assert.equal(mapPublicTariffs([]), FALLBACK_TARIFFS);
  assert.deepEqual(FALLBACK_TARIFFS.map(({ name, price }) => ({ name, price })), [
    { name: "Стандарт", price: 200 },
    { name: "Оптимальный", price: 300 },
    { name: "Премиум", price: 400 },
    { name: "Обычный ВПН", price: 120 },
  ]);
  assert.equal(resolveFaq(null), FALLBACK_FAQ);
  assert.equal(resolveFaq({ blocks: [], theme: {}, lang: "ru" }), FALLBACK_FAQ);
});

test("uses published FAQ and normalizes Telegram usernames", () => {
  const landing = {
    blocks: [
      {
        id: "faq",
        type: "faq",
        variant: "default",
        order: 1,
        props: {},
        text: { items: [{ q: "Вопрос?", a: "Ответ." }] },
      },
    ],
    theme: {},
    lang: "ru",
  };

  assert.deepEqual(resolveFaq(landing), [["Вопрос?", "Ответ."]]);
  assert.equal(telegramUrl("@lazeika_vpn_bot", "fallback_bot"), "https://t.me/lazeika_vpn_bot");
  assert.equal(telegramUrl(null, "fallback_bot"), "https://t.me/fallback_bot");
});
