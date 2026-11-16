import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = (p) => readFile(new URL(p, import.meta.url), "utf8");

// INVOXY_ONLY: покупка открывает окно «Оплата теперь в Invoxy VPN», а не оплату с ошибкой.
test("purchase windows and inline checkouts show the Invoxy move instead of payment", async () => {
  const [modal, cabinet, services, tariffs, profile] = await Promise.all(
    ["./components/ui/modal.tsx", "./pages/Cabinet.tsx", "./pages/Services.tsx", "./pages/Tariffs.tsx", "./pages/Profile.tsx"].map(src),
  );
  assert.match(modal, /purchase && invoxyOnly \? <ModalBody[^>]*><InvoxyMoveContent \/>/);
  assert.match(cabinet, /<Modal purchase open=\{buyDevice\}/);
  assert.match(services, /<Modal purchase open=\{open\}/);
  assert.match(tariffs, /<Modal\s+purchase\s/);
  assert.match(services, /useInvoxyOnly\(\) \? <div[^>]*><InvoxyMoveContent \/><\/div> : <CheckoutActionsInner/);
  assert.match(profile, /useInvoxyOnly\(\) \? <div[^>]*><InvoxyMoveContent \/><\/div> : <TopUpInner/);
});
