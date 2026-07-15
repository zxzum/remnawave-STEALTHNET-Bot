import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("подарочная ссылка не отдаёт Remnawave UUID клиенту", async () => {
  const service = await readFile(new URL("./gift.service.ts", import.meta.url), "utf8");
  const routes = await readFile(new URL("./gift.routes.ts", import.meta.url), "utf8");

  assert.match(service, /Promise<GiftResult<\{ subscriptionUrl: string \| null \}>>/);
  assert.doesNotMatch(routes, /uuid:\s*result\.data\.uuid/);
});
