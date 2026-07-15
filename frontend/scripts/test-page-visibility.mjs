import assert from "node:assert/strict";
import { isPageVisible } from "../.tmp-tests/use-page-visibility.js";

assert.equal(isPageVisible("visible"), true);
assert.equal(isPageVisible("hidden"), false);
