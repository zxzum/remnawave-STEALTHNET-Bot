import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const spaUrl = new URL("./spa-html.ts", import.meta.url);
const indexUrl = new URL("../../../../frontend/index.html", import.meta.url);
const viteUrl = new URL("../../../../frontend/vite.config.js", import.meta.url);

test("public metadata uses Lazeyka branding without legacy platform names", async () => {
  const [spa, index, vite] = await Promise.all([
    readFile(spaUrl, "utf8"),
    readFile(indexUrl, "utf8"),
    readFile(viteUrl, "utf8"),
  ]);

  assert.equal(spa.match(/const DEFAULT_BRAND = "([^"]+)"/)?.[1], "Лазейка ВПН");
  assert.equal(
    spa.match(/const DEFAULT_DESC = "([^"]+)"/)?.[1],
    "Лазейка ВПН — личный кабинет и админка VPN",
  );
  assert.equal(
    spa.match(/: `(\$\{brand\}[^`]+)`/)?.[1],
    "${brand} — личный кабинет и админка VPN",
  );
  assert.equal(
    index.match(/<meta name="description" content="([^"]+)"/)?.[1],
    "Лазейка ВПН — личный кабинет и админка VPN",
  );
  assert.match(vite, /description: "Лазейка ВПН — личный кабинет и админка VPN"/);

  const publicMetadata = [
    spa.match(/const DEFAULT_BRAND = "([^"]+)"/)?.[1],
    spa.match(/const DEFAULT_DESC = "([^"]+)"/)?.[1],
    spa.match(/: `(\$\{brand\}[^`]+)`/)?.[1],
    index.match(/<meta name="description" content="([^"]+)"/)?.[1],
    ...[...vite.matchAll(/description:\s*"([^"]+)"/g)].map((match) => match[1]),
  ].filter((value): value is string => Boolean(value));

  assert.doesNotMatch(publicMetadata.join("\n"), /remnawave|stealthnet/i);
});
