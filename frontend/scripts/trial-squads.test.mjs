import assert from "node:assert/strict";
import test from "node:test";
import {
  isMeteredSquadAllowed,
  parseInternalSquadsResponse,
  toggleSquadUuid,
} from "../src/lib/trial-squads.ts";

test("parses unique usable internal squads from the Remnawave response", () => {
  assert.deepEqual(
    parseInternalSquadsResponse({
      response: {
        internalSquads: [
          { uuid: "squad-a", name: "Whitelist" },
          { uuid: "squad-a", name: "Duplicate" },
          { name: "Missing UUID" },
          null,
          { uuid: "squad-b" },
        ],
      },
    }),
    [
      { uuid: "squad-a", name: "Whitelist" },
      { uuid: "squad-b" },
    ],
  );
});

test("toggles selected squads while preserving selection order", () => {
  assert.deepEqual(toggleSquadUuid(["squad-a", "squad-c"], "squad-b"), ["squad-a", "squad-c", "squad-b"]);
  assert.deepEqual(toggleSquadUuid(["squad-a", "squad-c"], "squad-a"), ["squad-c"]);
});

test("accepts a local-quota meter only from selected squads", () => {
  assert.equal(isMeteredSquadAllowed(["squad-a", "squad-b"], "squad-b"), true);
  assert.equal(isMeteredSquadAllowed(["squad-a", "squad-b"], "squad-c"), false);
  assert.equal(isMeteredSquadAllowed(["squad-a"], ""), false);
});
