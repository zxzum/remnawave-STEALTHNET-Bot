import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL = "https://remna.test";
process.env.REMNA_ADMIN_TOKEN = "test-token";

const { computeConvertedDays, extendSecondarySubscription } = await import("./tariff-activation.service.js");

test("converts remaining value into new tariff days", () => {
  assert.equal(computeConvertedDays({
    remainingDays: 30,
    oldPricePerDay: 10,
    newPricePerDay: 20,
  }), 15);
});

test("same daily price keeps days one to one", () => {
  assert.equal(computeConvertedDays({ remainingDays: 30, oldPricePerDay: 10, newPricePerDay: 10 }), 30);
});

test("Trial conversion starts paid global traffic from the new tariff limit", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const result = await extendSecondarySubscription(
    "sub-1",
    "client-1",
    {
      id: "paid-tariff", durationDays: 30, trafficLimitBytes: 200n, deviceLimit: 1, includedDevices: 1,
      internalSquadUuids: ["paid-squad"], trafficResetMode: "monthly", trafficLimitMode: "REMNAWAVE", price: 100,
    },
    undefined,
    undefined,
    false,
    false,
    false,
    {
      findSubscription: async () => ({
        id: "sub-1", remnawaveUuid: "owning-uuid", tariffId: "trial-tariff", ownerId: "client-1",
        giftedToClientId: null, deletionRequestedAt: null, customPrice: 0, extraDevices: 0,
        extraDevicesMonthlyPrice: 0, trialId: "trial-1", currentPricePerDay: null,
        trial: { tariffId: "trial-tariff", convertEnabled: true, convertAllTariffs: true, convertTariffIds: [] },
      }),
      getUser: async () => ({ data: { response: {
        expireAt: "2026-08-01T00:00:00.000Z", activeInternalSquads: ["trial-squad"],
        trafficLimitBytes: 100, userTraffic: { usedTrafficBytes: 20 },
      } }, status: 200 }),
      resetUserTraffic: async () => ({ data: {}, status: 200 }),
      updateUser: async (body: Record<string, unknown>) => { writes.push(body); return { data: {}, status: 200 }; },
      updateSubscription: async () => ({}),
      applyEntitlement: async () => null,
    } as any,
  );

  assert.equal(result.ok, true);
  assert.equal(writes[0]?.uuid, "owning-uuid");
  assert.equal(writes[0]?.trafficLimitBytes, 200);
  assert.equal(writes[0]?.trafficLimitStrategy, "MONTH");
  assert.deepEqual(writes[0]?.activeInternalSquads, ["paid-squad"]);
});

test("disallowed trial conversion stops before Remnawave access", async () => {
  let getUserCalls = 0;
  const result = await extendSecondarySubscription(
    "sub-1",
    "client-1",
    {
      id: "paid-2", durationDays: 30, trafficLimitBytes: 200n, deviceLimit: 1, includedDevices: 1,
      internalSquadUuids: ["paid-squad"], trafficResetMode: "monthly", trafficLimitMode: "REMNAWAVE", price: 100,
    },
    undefined,
    undefined,
    false,
    false,
    false,
    {
      findSubscription: async () => ({
        id: "sub-1", remnawaveUuid: "owning-uuid", tariffId: "trial-tariff", ownerId: "client-1",
        giftedToClientId: null, deletionRequestedAt: null, customPrice: 0, extraDevices: 0,
        extraDevicesMonthlyPrice: 0, trialId: "trial-1", currentPricePerDay: null,
        trial: { tariffId: "trial-tariff", convertEnabled: true, convertAllTariffs: false, convertTariffIds: ["paid-1"] },
      }),
      getUser: async () => {
        getUserCalls += 1;
        return { data: { response: {} }, status: 200 };
      },
    } as any,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(getUserCalls, 0);
});
