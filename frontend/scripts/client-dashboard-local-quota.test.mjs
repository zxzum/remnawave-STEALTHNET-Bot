import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/pages/cabinet/client-dashboard.tsx", import.meta.url), "utf8");
const secondary = source.slice(source.indexOf("{secondarySubscriptions.length > 0"));

test("secondary subscription cards render their local traffic quota", () => {
  assert.match(source, /trafficQuota\?: ClientTrafficQuota \| null/);
  assert.match(secondary, /const secLocalQuota = sec\.trafficQuota\?\.status \? sec\.trafficQuota : null/);
  assert.match(secondary, /secLocalQuota \? `\$\{formatBytes\(Number\(secLocalQuota\.usedBytes\)\)\} \/ \$\{formatBytes\(Number\(secLocalQuota\.limitBytes\)\)\}`/);
});
