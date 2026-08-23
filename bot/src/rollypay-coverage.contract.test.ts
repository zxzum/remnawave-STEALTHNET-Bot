import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RollyPay bot handlers cover proxy, Sing-box, and extra-option flows", async () => {
  const [index, api, keyboard] = await Promise.all([
    readFile(new URL("./index.ts", import.meta.url), "utf8"),
    readFile(new URL("./api.ts", import.meta.url), "utf8"),
    readFile(new URL("./keyboard.ts", import.meta.url), "utf8"),
  ]);

  assert.match(keyboard, /pay_proxy_rollypay/);
  assert.match(keyboard, /pay_singbox_rollypay/);
  assert.match(keyboard, /pay_option_rollypay/);
  assert.match(index, /pay_proxy_rollypay:/);
  assert.match(index, /pay_singbox_rollypay:/);
  assert.match(index, /pay_option_rollypay:/);
  assert.match(index, /createRollypayPayment\([^;]+proxyTariffId/s);
  assert.match(index, /createRollypayPayment\([^;]+singboxTariffId/s);
  assert.match(index, /createRollypayPayment\([^;]+targetSubscriptionId/s);
  assert.match(api, /targetSubscriptionId\?: string/);
});
