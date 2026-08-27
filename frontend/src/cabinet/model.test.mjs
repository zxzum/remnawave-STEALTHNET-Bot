import test from "node:test";
import assert from "node:assert/strict";
import {
  mapClient,
  mapClientApps,
  formatCurrency,
  groupDevicesBySubscription,
  mapSubscription,
  mapTariffGroups,
  quoteTariff,
  resolveOptionalNav,
  resolvePaymentUrl,
  isExpiredTrial,
  shouldOfferTelegramLink,
} from "./model.ts";

test("prefers Crypto Bot Mini App URL only inside Telegram", () => {
  const urls = {
    miniAppPayUrl: "tg://pay",
    webAppPayUrl: "https://web/pay",
    payUrl: "https://fallback/pay",
  };
  assert.equal(resolvePaymentUrl(urls, true), "tg://pay");
  assert.equal(resolvePaymentUrl(urls, false), "https://web/pay");
  assert.equal(resolvePaymentUrl({ paymentUrl: "https://platega/pay" }, false), "https://platega/pay");
  assert.equal(resolvePaymentUrl({ paymentUrl: "javascript:alert(1)" }, false), null);
});

test("formats top-up amounts in the currency sent to the provider", () => {
  assert.match(formatCurrency(500, "usd"), /500/);
  assert.match(formatCurrency(500, "usd"), /\$|USD/);
  assert.doesNotMatch(formatCurrency(500, "usd"), /₽/);
});

test("maps public tariff options and computes extra devices like the backend", () => {
  const groups = mapTariffGroups([{ id: "g1", name: "VPN", emoji: "🚀", tariffs: [{
    id: "t1", name: "Premium", description: "Fast · Private", durationDays: 30, price: 300,
    currency: "rub", trafficLimitBytes: 107374182400, deviceLimit: 3, includedDevices: 3,
    pricePerExtraDevice: 100, maxExtraDevices: 5,
    deviceDiscountTiers: [{ minExtraDevices: 3, discountPercent: 20 }],
    priceOptions: [{ id: "year", durationDays: 365, price: 3000, sortOrder: 1 }],
  }] }]);
  const plan = groups[0].plans[0];
  assert.equal(plan.durationOptions[1].id, "year");
  assert.equal(plan.traffic, "100 ГБ");
  assert.deepEqual(quoteTariff(plan, 365, 3), { base: 3000, extras: 2920, total: 5920, discountPercent: 20 });
});

test("preserves tariff description whitespace for cabinet rendering", () => {
  const description = "  Выбор большинства  \n\n  50GB белых списков  ";
  const [group] = mapTariffGroups([{ id: "g1", name: "VPN", emoji: "⭐", tariffs: [{
    id: "t1", name: "Стандарт", description, durationDays: 30, price: 200,
    currency: "rub", deviceLimit: 5, includedDevices: 5,
    pricePerExtraDevice: 0, maxExtraDevices: 0, deviceDiscountTiers: [], priceOptions: [],
  }] }]);

  assert.equal(group.plans[0].emojiLine, description);
});

test("maps local squad limits as whitelist traffic and best choice", () => {
  const [group] = mapTariffGroups([{ id: "g1", name: "VPN", emoji: "🚀", tariffs: [{
    id: "t1", name: "Whitelist", description: null, durationDays: 30, price: 300,
    currency: "rub", trafficLimitBytes: 53687091200, trafficLimitMode: "LOCAL_SQUAD",
    meteredSquadUuid: "whitelist", isBestChoice: true, deviceLimit: 3, includedDevices: 3,
    pricePerExtraDevice: 0, maxExtraDevices: 0, deviceDiscountTiers: [], priceOptions: [],
  }] }]);
  assert.equal(group.plans[0].traffic, "Безлимит");
  assert.equal(group.plans[0].whitelistGB, 50);
  assert.equal(group.plans[0].popular, true);
});

test("maps configured subscription apps and substitutes the real key", () => {
  const apps = mapClientApps({
    platforms: {
      ios: {
        displayName: { ru: "iOS" },
        apps: [{
          name: "Happ",
          blocks: [{
            title: { ru: "Подключение" },
            description: { ru: "Добавьте подписку" },
            buttons: [
              { type: "subscriptionLink", link: "happ://add/{{SUBSCRIPTION_LINK}}", text: { ru: "Добавить" } },
              { type: "appStore", link: "https://apps.apple.com/app/happ", text: { ru: "App Store" } },
            ],
          }],
        }, {
          name: "Streisand",
          blocks: [{
            title: { ru: "Установка" },
            buttons: [{ type: "appStore", link: "https://apps.apple.com/app/streisand", text: { ru: "App Store" } }],
          }],
        }],
      },
    },
  });
  assert.equal(apps[0].name, "Happ");
  assert.equal(apps[0].canConnect, true);
  assert.equal(apps[0].deeplink("https://vpn.example/sub"), "happ://add/https://vpn.example/sub");
  assert.deepEqual(apps[0].steps, ["Подключение", "Добавьте подписку"]);
  assert.deepEqual(apps[0].downloads, [{ type: "appStore", url: "https://apps.apple.com/app/happ", label: "App Store" }]);
  assert.equal(apps[1].name, "Streisand");
  assert.equal(apps[1].canConnect, false);
});

test("offers Telegram linking only to authenticated unlinked clients", () => {
  assert.equal(shouldOfferTelegramLink({ id: "c1", telegramId: null }), true);
  assert.equal(shouldOfferTelegramLink({ id: "c1", telegramId: "123" }), false);
  assert.equal(shouldOfferTelegramLink(null), false);
});

test("shows overflow only for enabled optional services", () => {
  assert.deepEqual(resolveOptionalNav({ showProxyEnabled: true }), ["proxy"]);
  assert.deepEqual(resolveOptionalNav({}), []);
});

test("maps the authenticated client without inventing identity data", () => {
  const user = mapClient({
    id: "c1",
    email: "a@example.com",
    telegramId: "42",
    telegramUsername: "alice",
    balance: 1250,
    createdAt: "2026-01-02T00:00:00.000Z",
  });
  assert.equal(user.email, "a@example.com");
  assert.equal(user.name, "alice");
  assert.equal(user.balance, 1250);
});

test("maps a wrapped Remnawave subscription", () => {
  const subscription = mapSubscription(
    {
      type: "root",
      id: "s1",
      subscriptionIndex: 0,
      tariffDisplayName: "Premium",
      tariffId: "tariff-premium",
      trialId: "trial-welcome",
      extraDevices: 2,
      extraDevicesMonthlyPrice: 190,
      subscription: {
        response: {
          status: "ACTIVE",
          expireAt: "2026-08-22T00:00:00.000Z",
          trafficLimitBytes: 107374182400,
          userTraffic: { usedTrafficBytes: 21474836480 },
          hwidDeviceLimit: 5,
          subscriptionUrl: "https://vpn.example/sub",
        },
      },
    },
    new Date("2026-07-22T00:00:00.000Z"),
  );
  assert.equal(subscription.daysLeft, 31);
  assert.equal(subscription.trafficUsedGB, 20);
  assert.equal(subscription.trafficLimitGB, 100);
  assert.equal(subscription.keyUrl, "https://vpn.example/sub");
  assert.equal(subscription.source.type, "root");
  assert.equal(subscription.tariffId, "tariff-premium");
  assert.equal(subscription.isTrial, true);
  assert.equal(subscription.extraDevices, 2);
  assert.equal(subscription.extraDevicesMonthlyPrice, 190);
});

test("maps standalone trial conversion policy for tariff selection", () => {
  const subscription = mapSubscription({
    type: "root",
    id: "trial-sub",
    subscriptionIndex: 0,
    tariffDisplayName: "🎁 Trial",
    tariffId: null,
    trialId: "trial-1",
    convertTariffIds: ["paid-1"],
    trialConvertEnabled: true,
    trialConvertAllTariffs: false,
    subscription: { response: { status: "ACTIVE", expireAt: "2026-08-22T00:00:00.000Z" } },
  }, new Date("2026-07-22T00:00:00.000Z"));

  assert.deepEqual(
    {
      convertTariffIds: subscription.convertTariffIds,
      trialConvertEnabled: subscription.trialConvertEnabled,
      trialConvertAllTariffs: subscription.trialConvertAllTariffs,
    },
    { convertTariffIds: ["paid-1"], trialConvertEnabled: true, trialConvertAllTariffs: false },
  );
});

test("recognizes only an expired trial for the dedicated cabinet state", () => {
  assert.equal(isExpiredTrial({ isTrial: true, status: "expired" }), true);
  assert.equal(isExpiredTrial({ isTrial: true, status: "active" }), false);
  assert.equal(isExpiredTrial({ isTrial: false, status: "expired" }), false);
});

test("maps local whitelist usage separately from Remnawave traffic", () => {
  const subscription = mapSubscription({
    type: "root", id: "s1", subscriptionIndex: 0, tariffDisplayName: "Whitelist",
    trafficQuota: { status: "ACTIVE", usedBytes: "10737418240", limitBytes: "53687091200" },
    subscription: { response: {
      status: "ACTIVE", expireAt: "2026-08-22T00:00:00.000Z",
      trafficLimitBytes: 0, userTraffic: { usedTrafficBytes: 21474836480 },
    } },
  }, new Date("2026-07-22T00:00:00.000Z"));
  assert.equal(subscription.trafficUsedGB, 20);
  assert.equal(subscription.trafficLimitGB, null);
  assert.equal(subscription.whitelistUsedGB, 10);
  assert.equal(subscription.whitelistGB, 50);
});

test("groups devices under their actual subscription", () => {
  const grouped = groupDevicesBySubscription([
    { hwid: "root-device", platform: "iOS", subscriptionType: "root", subscriptionId: "root", subscriptionIndex: 0, tariffName: "Main" },
    { hwid: "secondary-device", platform: "Android", appName: "Happ", subscriptionType: "secondary", subscriptionId: "secondary", subscriptionIndex: 1, tariffName: "Extra" },
  ]);
  assert.deepEqual(grouped.get("root")?.map((item) => item.id), ["root-device"]);
  assert.deepEqual(grouped.get("secondary")?.map((item) => item.id), ["secondary-device"]);
  assert.equal(grouped.get("secondary")?.[0].app, "Happ");
});
