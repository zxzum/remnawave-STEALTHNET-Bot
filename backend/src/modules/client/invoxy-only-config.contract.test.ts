import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// Бот и кабинет узнают о закрытии оплат из публичного конфига: флаг обязан туда попасть, иначе нет баннера.
test("INVOXY_ONLY reaches the public config (bot and cabinet show the move banner)", async () => {
  const src = await readFile(new URL("./client.service.ts", import.meta.url), "utf8");
  const pub = src.slice(src.indexOf("export async function getPublicConfig"));
  assert.match(pub.slice(pub.indexOf("  return {")), /invoxyOnly:\s*full\.invoxyOnly/);
});
