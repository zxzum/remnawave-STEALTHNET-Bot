import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Aurora cabinet design is opt-in, validated, seeded safely, and exposed publicly", async () => {
  const [clientService, adminRoutes, seed] = await Promise.all([
    readFile(new URL("./client.service.ts", import.meta.url), "utf8"),
    readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/seed-system-settings.ts", import.meta.url), "utf8"),
  ]);

  assert.match(clientService, /"cabinet_design"/);
  assert.match(clientService, /serviceName:\s*map\.service_name \|\| "Лазейка ВПН"/);
  assert.match(clientService, /cabinetDesign:\s*map\.cabinet_design === "aurora" \? "aurora" : "default"/);
  assert.match(clientService, /cabinetDesign:\s*full\.cabinetDesign === "aurora" \? "aurora" : "default"/);
  assert.match(adminRoutes, /cabinetDesign:\s*z\.enum\(\["default", "aurora"\]\)\.optional\(\)/);
  assert.match(adminRoutes, /where:\s*\{ key: "cabinet_design" \}/);
  assert.match(seed, /\["cabinet_design", "default"\]/);
});
