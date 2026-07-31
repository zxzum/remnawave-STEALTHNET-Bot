import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const extras = (await import("./extras.helper.js")) as Record<string, unknown>;

type Response = { data?: unknown; error?: string; status: number };
type Requests = {
  get: (uuid: string) => Promise<Response>;
  remove: (uuid: string, hwid: string) => Promise<Response>;
  update: (payload: { uuid: string; hwidDeviceLimit: number }) => Promise<Response>;
};

type Remove = (
  uuid: string,
  keepLimit: number,
  commit: () => Promise<void>,
  requests: Requests,
) => Promise<{ ok: boolean; removed: number; error?: string }>;

function devices(...hwids: string[]): Response {
  return {
    status: 200,
    data: { response: { devices: hwids.map((hwid, index) => ({ hwid, createdAt: new Date(index).toISOString() })) } },
  };
}

test("extras removal stops on Remnawave get error without clearing paid extras", async () => {
  assert.equal(typeof extras.removePaidExtrasFromRemna, "function");
  const remove = extras.removePaidExtrasFromRemna as Remove;
  let committed = 0;
  let deletes = 0;
  let updates = 0;
  const result = await remove("owner-uuid", 1, async () => { committed++; }, {
    get: async (uuid) => ({ status: 502, error: `get ${uuid} failed` }),
    remove: async () => { deletes++; return { status: 200 }; },
    update: async () => { updates++; return { status: 200 }; },
  });
  assert.deepEqual(result, { ok: false, removed: 0, error: "get owner-uuid failed" });
  assert.equal(deletes, 0);
  assert.equal(updates, 0);
  assert.equal(committed, 0);
});

test("extras removal does not count a failed HWID deletion or clear paid extras", async () => {
  assert.equal(typeof extras.removePaidExtrasFromRemna, "function");
  const remove = extras.removePaidExtrasFromRemna as Remove;
  const calls: string[] = [];
  let committed = 0;
  const result = await remove("owner-uuid", 1, async () => { committed++; }, {
    get: async (uuid) => { calls.push(`get:${uuid}`); return devices("old", "new"); },
    remove: async (uuid, hwid) => { calls.push(`delete:${uuid}:${hwid}`); return { status: 500, error: "delete failed" }; },
    update: async (payload) => { calls.push(`update:${payload.uuid}`); return { status: 200 }; },
  });
  assert.deepEqual(result, { ok: false, removed: 0, error: "delete failed" });
  assert.deepEqual(calls, ["get:owner-uuid", "delete:owner-uuid:old"]);
  assert.equal(committed, 0);
});

test("extras removal keeps paid extras when the Remnawave limit update fails", async () => {
  assert.equal(typeof extras.removePaidExtrasFromRemna, "function");
  const remove = extras.removePaidExtrasFromRemna as Remove;
  let committed = 0;
  const result = await remove("owner-uuid", 1, async () => { committed++; }, {
    get: async () => devices("only"),
    remove: async () => ({ status: 204 }),
    update: async (payload) => ({ status: 503, error: `update ${payload.uuid} failed` }),
  });
  assert.deepEqual(result, { ok: false, removed: 0, error: "update owner-uuid failed" });
  assert.equal(committed, 0);
});

test("extras removal updates the owning UUID and clears local extras only after remote success", async () => {
  assert.equal(typeof extras.removePaidExtrasFromRemna, "function");
  const remove = extras.removePaidExtrasFromRemna as Remove;
  const calls: string[] = [];
  let committed = 0;
  const result = await remove("owner-uuid", 1, async () => { committed++; }, {
    get: async (uuid) => { calls.push(`get:${uuid}`); return devices("old", "new"); },
    remove: async (uuid, hwid) => { calls.push(`delete:${uuid}:${hwid}`); return { status: 204 }; },
    update: async (payload) => { calls.push(`update:${payload.uuid}:${payload.hwidDeviceLimit}`); return { status: 200 }; },
  });
  assert.deepEqual(result, { ok: true, removed: 1 });
  assert.deepEqual(calls, ["get:owner-uuid", "delete:owner-uuid:old", "update:owner-uuid:1"]);
  assert.equal(committed, 1);
});
