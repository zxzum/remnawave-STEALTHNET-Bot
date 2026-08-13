import assert from "node:assert/strict";
import test from "node:test";
import { MAIN_MENU_REPLY_TEXT, mainMenu, persistentMainMenuKeyboard, type BotButtonConfig } from "./keyboard.js";
import * as keyboard from "./keyboard.js";

const buttons: BotButtonConfig[] = [
  { id: "cabinet", visible: true, label: "🚀 Открыть кабинет", order: 1, style: "primary" },
  { id: "my_subs", visible: true, label: "📋 Мои подписки", order: 2, style: "" },
  { id: "devices", visible: true, label: "📱 Устройства", order: 3, style: "primary" },
  { id: "trial", visible: true, label: "🎁 Попробовать бесплатно", order: 4, style: "success" },
  { id: "referral", visible: true, label: "💸 Пригласить и заработать", order: 5, style: "" },
  { id: "bot_menu", visible: true, label: "☰ Меню бота", order: 6, style: "primary" },
  { id: "support", visible: true, label: "🆘 Поддержка", order: 7, style: "" },
  { id: "about", visible: true, label: "ⓘ О сервисе", order: 8.2, style: "" },
  { id: "site", visible: true, label: "🌐 Сайт", order: 8, style: "" },
  { id: "profile", visible: true, label: "🧩 Профиль", order: 9, style: "" },
  { id: "tariffs", visible: true, label: "💳 Купить доступ / Продлить", order: 10, style: "" },
  { id: "topup", visible: true, label: "💰 Пополнить баланс", order: 11, style: "success" },
  { id: "promocode", visible: true, label: "🎟 Промокод", order: 12, style: "primary" },
  { id: "vpn", visible: true, label: "🌐 Подключиться к VPN", order: 13, style: "danger" },
  { id: "gift", visible: true, label: "🎁 Подарки", order: 14, style: "primary" },
  { id: "extra_options", visible: true, label: "📦 Дополнительные опции", order: 15, style: "primary" },
  { id: "proxy", visible: true, label: "🌐 Прокси", order: 16, style: "primary" },
  { id: "my_proxy", visible: true, label: "📋 Мои прокси", order: 17, style: "primary" },
  { id: "singbox", visible: true, label: "🔑 Доступы", order: 18, style: "primary" },
  { id: "my_singbox", visible: true, label: "📋 Мои доступы", order: 19, style: "primary" },
  { id: "tg_proxy", visible: true, label: "🛡 Прокси для Telegram", order: 20, style: "primary" },
  { id: "tickets", visible: true, label: "🎫 Мои обращения", order: 21, style: "primary" },
];

function labels(markup: ReturnType<typeof mainMenu>): string[][] {
  return markup.inline_keyboard.map((row) => row.map((button) => button.text));
}

function buildMain(overrides: Record<string, unknown> = {}) {
  return mainMenu({
    showTrial: false,
    showVpn: true,
    appUrl: "https://bot.lazeika.xyz",
    supportUrl: "https://t.me/lazeyka_support_bot",
    renewTariffId: "tariff-standard",
    isAdmin: false,
    ...overrides,
  } as Parameters<typeof mainMenu>[0]);
}

type MenuFactory = (options: Parameters<typeof mainMenu>[0]) => ReturnType<typeof mainMenu>;
type SectionFactory = (section: "account" | "payment" | "connection" | "bonuses", options: Parameters<typeof mainMenu>[0]) => ReturnType<typeof mainMenu>;

function callbacks(markup: ReturnType<typeof mainMenu>): (string | null)[][] {
  return markup.inline_keyboard.map((row) => row.map((button) => "callback_data" in button ? button.callback_data : null));
}

test("главное меню плоское и ведёт прямо в mini-app", () => {
  const markup = buildMain();
  assert.deepEqual(labels(markup), [
    ["👤 ВОЙТИ В КАБИНЕТ"],
    ["💳 Тарифы", "🔑 Мои ключи"],
    ["🤝 Рефералка", "🛠 Поддержка"],
    ["🔄 Продлить", "ℹ️ Инфо"],
  ]);
  assert.deepEqual(
    markup.inline_keyboard.map((row) => row.map((button) =>
      "web_app" in button ? button.web_app.url : "url" in button ? button.url : button.callback_data
    )),
    [
      ["https://bot.lazeika.xyz/cabinet"],
      ["https://bot.lazeika.xyz/cabinet/tariffs", "https://bot.lazeika.xyz/cabinet/subscribe"],
      ["https://bot.lazeika.xyz/cabinet/referral", "https://t.me/lazeyka_support_bot"],
      ["pay_tariff:tariff-standard:r", "menu:info"],
    ],
  );
});

test("главное меню использует согласованные цвета", () => {
  assert.deepEqual(
    buildMain({ isAdmin: true }).inline_keyboard.map((row) => row.map((button) => ("style" in button ? button.style : undefined))),
    [["success"], ["primary", "primary"], ["primary", "primary"], ["primary", "primary"], ["primary"]],
  );
});

test("главное меню явно обрабатывает отсутствие тарифа, support и права админа", () => {
  assert.equal(callbacks(buildMain({ renewTariffId: null }))[3]![0], "menu:renew");
  assert.equal(labels(buildMain({ supportUrl: null }))[2]!.includes("🛠 Поддержка"), false);
  assert.deepEqual(labels(buildMain({ isAdmin: true })).at(-1), ["⚙️ Админ-панель"]);
});

test("постоянная клавиатура всегда держит кнопку главного меню", () => {
  assert.deepEqual(persistentMainMenuKeyboard(), {
    keyboard: [[{ text: MAIN_MENU_REPLY_TEXT }]],
    resize_keyboard: true,
    is_persistent: true,
  });
});

test("меню бота показывает четыре раздела и возврат на главную", () => {
  const factory = (keyboard as unknown as { botSectionsMenu?: MenuFactory }).botSectionsMenu;
  assert.equal(typeof factory, "function");
  const markup = factory!(buildOptions(true));
  assert.deepEqual(labels(markup), [
    ["👤 Аккаунт", "💳 Оплата и доступ"],
    ["🔌 Подключение", "🎁 Бонусы"],
    ["◀️ В меню"],
  ]);
  assert.deepEqual(callbacks(markup), [
    ["menu:section:account", "menu:section:payment"],
    ["menu:section:connection", "menu:section:bonuses"],
    ["menu:main"],
  ]);
});

test("каждый раздел сохраняет согласованные действия и возвращает в меню бота", () => {
  const factory = (keyboard as unknown as { botSectionMenu?: SectionFactory }).botSectionMenu;
  assert.equal(typeof factory, "function");
  const options = buildOptions(true);
  assert.deepEqual(labels(factory!("account", options)), [
    ["🧩 Профиль"], ["📋 Мои подписки"], ["📱 Устройства"], ["🎫 Мои обращения"], ["◀️ Назад"],
  ]);
  assert.deepEqual(callbacks(factory!("account", options)), [
    ["menu:profile"], ["menu:my_subs"], ["menu:devices"], [null], ["menu:bot"],
  ]);
  assert.deepEqual(callbacks(factory!("payment", options)), [
    ["menu:tariffs"], ["menu:topup"], ["menu:promocode"], ["menu:extra_options"], ["menu:bot"],
  ]);
  assert.deepEqual(callbacks(factory!("connection", options)), [
    ["menu:vpn"], ["menu:proxy"], ["menu:my_proxy"], ["menu:singbox"], ["menu:my_singbox"], ["menu:tg_proxy"], ["menu:bot"],
  ]);
  assert.deepEqual(callbacks(factory!("bonuses", options)), [
    ["menu:referral"], ["menu:trial"], ["menu:gift"], ["menu:bot"],
  ]);
});

function buildOptions(showTrial: boolean): Parameters<typeof mainMenu>[0] {
  return {
    showTrial,
    showVpn: true,
    showProxy: true,
    showSingbox: true,
    showGift: true,
    showExtraOptions: true,
    appUrl: "https://bot.lazeika.xyz",
    botButtons: buttons,
    botBackLabel: "◀️ В меню",
    hasSupportLinks: true,
    showTickets: true,
    buttonsPerRow: 1,
  };
}
