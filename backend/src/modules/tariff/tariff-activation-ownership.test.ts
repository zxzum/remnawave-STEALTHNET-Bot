import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL = "https://remna.test";
process.env.REMNA_ADMIN_TOKEN = "test-token";

const service = (await import("./tariff-activation.service.js")) as Record<string, unknown>;

test("activation target accepts only live owned or gifted subscriptions", () => {
  assert.equal(typeof service.subscriptionBelongsToClient, "function");
  const belongs = service.subscriptionBelongsToClient as (
    row: { ownerId: string; giftedToClientId: string | null; deletionRequestedAt: Date | null },
    clientId: string,
  ) => boolean;
  assert.equal(belongs({ ownerId: "client", giftedToClientId: null, deletionRequestedAt: null }, "client"), true);
  assert.equal(belongs({ ownerId: "buyer", giftedToClientId: "client", deletionRequestedAt: null }, "client"), true);
  assert.equal(belongs({ ownerId: "other", giftedToClientId: null, deletionRequestedAt: null }, "client"), false);
  assert.equal(belongs({ ownerId: "client", giftedToClientId: null, deletionRequestedAt: new Date() }, "client"), false);
  assert.equal(belongs({ ownerId: "buyer", giftedToClientId: "client", deletionRequestedAt: new Date() }, "client"), false);
});

test("extend validates payment client ownership before every Remnawave call", async () => {
  const source = await readFile(new URL("./tariff-activation.service.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function extendSecondarySubscription");
  const end = source.indexOf("export async function findConvertibleSubscription", start);
  const body = source.slice(start, end);
  const guard = body.indexOf("subscriptionBelongsToClient");
  assert.ok(guard > 0);
  for (const call of ["const userRes =", "remnaResetUserTraffic(", "remnaUpdateUser("]) {
    assert.ok(body.indexOf(call) > guard, `${call} must follow ownership guard`);
  }
  assert.match(body.slice(0, guard), /giftedToClientId:\s*true/);
  assert.match(body.slice(0, guard), /deletionRequestedAt:\s*true/);
});

test("payment activation validates its explicit target before trial conversion logic", async () => {
  const source = await readFile(new URL("./tariff-activation.service.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function activateTariffByPaymentId");
  const end = source.indexOf("function getExtendsSecondarySubId", start);
  const body = source.slice(start, end);
  const branch = body.indexOf("if (extendsSecondaryId)");
  const guard = body.indexOf("subscriptionBelongsToClient", branch);
  const trialLogic = body.indexOf("if (targetSub?.trialId)", branch);
  assert.ok(branch > 0 && guard > branch && trialLogic > guard);
  assert.match(body.slice(branch, guard), /giftedToClientId:\s*true/);
  assert.match(body.slice(branch, guard), /deletionRequestedAt:\s*true/);
});

test("extend entrypoint reaches Remnawave only for a live owned or gifted target", async () => {
  const extend = service.extendSecondarySubscription as (...args: unknown[]) => Promise<{ ok: boolean; status?: number }>;
  const base = {
    id: "sub-1",
    remnawaveUuid: "uuid-1",
    tariffId: "tariff-1",
    ownerId: "other",
    giftedToClientId: null,
    deletionRequestedAt: null,
    customPrice: 10,
    extraDevices: 0,
    extraDevicesMonthlyPrice: 0,
    trialId: null,
    currentPricePerDay: 1,
  };
  const tariff = {
    id: "tariff-1",
    durationDays: 30,
    trafficLimitBytes: 1000n,
    deviceLimit: 1,
    includedDevices: 1,
    internalSquadUuids: [],
  };
  for (const row of [
    base,
    { ...base, ownerId: "client", deletionRequestedAt: new Date() },
    { ...base, ownerId: "client" },
    { ...base, giftedToClientId: "client" },
  ]) {
    let remnaCalls = 0;
    const result = await extend("sub-1", "client", tariff, undefined, undefined, undefined, undefined, undefined, {
      findSubscription: async () => row,
      getUser: async () => {
        remnaCalls++;
        return { status: 404, error: "stop after access guard" };
      },
    });
    assert.equal(remnaCalls, row.ownerId === "client" && row.deletionRequestedAt == null || row.giftedToClientId === "client" ? 1 : 0);
    assert.equal(result.ok, false);
  }
});
