import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/cabinet/pages/Auth.tsx", import.meta.url), "utf8");
const copyButton = readFileSync(new URL("../src/cabinet/components/ui/CopyButton.tsx", import.meta.url), "utf8");

test("registration steps submit through Enter-enabled forms", () => {
  assert.match(source, /<form onSubmit=\{\(event\) => \{ event\.preventDefault\(\); continueEmail\(\); \}\}>/);
  assert.match(source, /<form onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void submitRegistration\(\); \}\}>/);
  assert.match(source, /<form onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void confirm2FA\(\); \}\}>/);
  assert.equal((source.match(/type="submit"/g) ?? []).length, 3);
  assert.match(copyButton, /<motion\.button\s+type="button"/);
});
