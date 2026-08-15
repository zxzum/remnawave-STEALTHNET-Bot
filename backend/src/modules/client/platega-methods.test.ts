import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret-at-least-thirty-two-characters";

const { parsePlategaMethods } = await import("./client.service.js");

test("uses CardRu 10 for defaults and legacy saved Russian cards", () => {
  const legacy = parsePlategaMethods(JSON.stringify([
    { id: 2, enabled: true, label: "СБП" },
    { id: 11, enabled: true, label: "Карты РФ" },
  ]));

  assert.equal(legacy.find((method) => method.label === "Карты РФ")?.id, 10);
  assert.equal(parsePlategaMethods(undefined).find((method) => method.label === "Карты")?.id, 10);
});
