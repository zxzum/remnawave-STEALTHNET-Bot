import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("does not render a second chat switcher while scrolling", async () => {
  const source = await readFile(new URL("./floating-chat.tsx", import.meta.url), "utf8");
  const header = source.slice(source.indexOf("const ChatHeader"), source.indexOf("function SupportTab"));

  assert.doesNotMatch(source, /<ChatSwitcher\s+\{\.\.\.headerProps\}\s+isFloating=\{true\}/);
  assert.match(header, /className="sticky top-4 z-30 flex sm:justify-center/);
});
