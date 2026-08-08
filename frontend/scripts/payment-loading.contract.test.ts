import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("payment actions expose loading state", async () => {
  const files = [
    "src/cabinet/pages/Tariffs.tsx",
    "src/components/payment/extend-subscription-dialog.tsx",
    "src/cabinet/pages/Services.tsx",
  ];
  for (const file of files) {
    const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
    assert.match(source, /disabled=\{(?:paying|payLoading|loading)/, file);
    assert.match(source, /Loader2[\s\S]*animate-spin/, file);
  }
});
