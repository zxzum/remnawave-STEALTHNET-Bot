import assert from "node:assert/strict";
import test from "node:test";

import { getRemnaUserIdentifier } from "../src/lib/remna-user.ts";

test("Remnawave v3 numeric user id is safe to render without a legacy uuid", () => {
  assert.equal(getRemnaUserIdentifier({ id: 42 }, "stored-id"), "42");
});

test("legacy uuid remains the preferred Remnawave identifier", () => {
  assert.equal(getRemnaUserIdentifier({ id: 42, uuid: "legacy-uuid" }, "stored-id"), "legacy-uuid");
});

test("stored subscription identifier is used for incomplete Remnawave responses", () => {
  assert.equal(getRemnaUserIdentifier({}, "stored-id"), "stored-id");
});
