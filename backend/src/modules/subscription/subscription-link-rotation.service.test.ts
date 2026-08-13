import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret";

type RotationInput = {
  accountId: string;
  type: "root" | "secondary";
  id: string;
  confirmed: boolean;
  now: Date;
  ip: string;
};

type RotationResult = {
  ok: boolean;
  status?: number;
  message?: string;
  retryAt?: Date;
  subscriptionUrl?: string;
  shortUuid?: string;
  linkRotatedAt?: Date;
};

type SubscriptionRow = {
  id: string;
  ownerId: string;
  giftedToClientId: string | null;
  remnawaveUuid: string;
  remnawaveShortUuid: string;
  linkRotatedAt: Date | null;
  tariffId: string;
  expireAt: Date;
};

type RemoteResult = {
  status: number;
  data?: unknown;
  error?: string;
};

type AuditEvent = {
  kind: string;
  actorId: string;
  actorIp: string;
  target: { type: string; id: string };
  payload: Record<string, unknown>;
};

type FakeTx = {
  $executeRaw: (...args: unknown[]) => Promise<number>;
  subscription: {
    findFirst: (args: unknown) => Promise<SubscriptionRow | null>;
    findUnique: (args: unknown) => Promise<SubscriptionRow | null>;
    update: (args: unknown) => Promise<SubscriptionRow>;
  };
};

type FakeDependencies = {
  prisma: {
    $transaction: <T>(callback: (tx: FakeTx) => Promise<T>) => Promise<T>;
  };
  revokeUser: (uuid: string) => Promise<RemoteResult>;
  getUser: (uuid: string) => Promise<RemoteResult>;
  audit: (event: AuditEvent) => Promise<void>;
};

type RotateSubscriptionLink = (
  input: RotationInput,
  dependencies: FakeDependencies,
) => Promise<RotationResult>;

const now = new Date("2026-08-13T10:00:00.000Z");

function remoteUser(shortUuid: string, overrides: Record<string, unknown> = {}): RemoteResult {
  return {
    status: 200,
    data: {
      response: {
        uuid: "remna-user-1",
        shortUuid,
        subscriptionUuid: "tariff-1",
        expireAt: "2030-01-01T00:00:00.000Z",
        trafficLimitBytes: 1_000,
        hwidDeviceLimit: 2,
        activeInternalSquads: [{ uuid: "squad-1" }],
        subscriptionUrl: `https://sub.lazeika.xyz/${shortUuid}`,
        ...overrides,
      },
    },
  };
}

function makeDependencies(options: {
  authorized?: boolean;
  recentRotation?: Date | null;
  revokeResult?: RemoteResult;
  after?: RemoteResult;
} = {}): { dependencies: FakeDependencies; updates: unknown[]; audits: AuditEvent[]; revoked: string[] } {
  const row: SubscriptionRow = {
    id: "subscription-1",
    ownerId: "owner-1",
    giftedToClientId: "recipient-1",
    remnawaveUuid: "remna-user-1",
    remnawaveShortUuid: "old-short",
    linkRotatedAt: null,
    tariffId: "tariff-1",
    expireAt: new Date("2030-01-01T00:00:00.000Z"),
  };
  const updates: unknown[] = [];
  const audits: AuditEvent[] = [];
  const revoked: string[] = [];
  const remoteResults = [remoteUser("old-short"), options.after ?? remoteUser("new-short")];
  let getUserCall = 0;

  const findSubscription = async (args: unknown): Promise<SubscriptionRow | null> => {
    const where = (args as { where?: Record<string, unknown> }).where;
    if (where && "linkRotatedAt" in where) {
      return options.recentRotation ? { ...row, linkRotatedAt: options.recentRotation } : null;
    }
    if (options.authorized === false) return null;
    const candidates = where?.OR;
    if (Array.isArray(candidates)) {
      const allowed = candidates.some((candidate) => {
        if (!candidate || typeof candidate !== "object") return false;
        const value = candidate as Record<string, unknown>;
        return value.ownerId === row.ownerId || value.giftedToClientId === row.giftedToClientId;
      });
      return allowed ? row : null;
    }
    return row;
  };

  const tx: FakeTx = {
    $executeRaw: async () => 1,
    subscription: {
      findFirst: findSubscription,
      findUnique: findSubscription,
      update: async (args: unknown) => {
        updates.push(args);
        return row;
      },
    },
  };

  return {
    dependencies: {
      prisma: {
        $transaction: async <T>(callback: (transaction: FakeTx) => Promise<T>) => callback(tx),
      },
      revokeUser: async (uuid: string) => {
        revoked.push(uuid);
        return options.revokeResult ?? { status: 204 };
      },
      getUser: async () => remoteResults[Math.min(getUserCall++, remoteResults.length - 1)],
      audit: async (event: AuditEvent) => {
        audits.push(event);
      },
    },
    updates,
    audits,
    revoked,
  };
}

async function rotate(input: RotationInput, dependencies: FakeDependencies): Promise<RotationResult> {
  const module = await import("./subscription-link-rotation.service.js").catch(() => null);
  const reissueSubscriptionLink = module?.reissueSubscriptionLink as
    | RotateSubscriptionLink
    | undefined;
  assert.equal(typeof reissueSubscriptionLink, "function", "subscription link rotation service is missing");
  return reissueSubscriptionLink!(input, dependencies);
}

test("owner can reissue a root subscription link after confirmation", async () => {
  const { dependencies, updates, audits, revoked } = makeDependencies();

  const result = await rotate(
    { accountId: "owner-1", type: "root", id: "owner-1", confirmed: true, now, ip: "203.0.113.10" },
    dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(result.subscriptionUrl, "https://sub.lazeika.xyz/new-short");
  assert.equal(result.shortUuid, "new-short");
  assert.deepEqual(revoked, ["remna-user-1"]);
  assert.equal(updates.length, 1);
  assert.deepEqual((updates[0] as { data: unknown }).data, {
    remnawaveShortUuid: "new-short",
    linkRotatedAt: now,
  });
  assert.equal(audits.length, 1);
  assert.equal(JSON.stringify(audits[0]).includes("https://"), false);
});

test("recipient can reissue a gifted secondary subscription link", async () => {
  const { dependencies, updates } = makeDependencies();

  const result = await rotate(
    {
      accountId: "recipient-1",
      type: "secondary",
      id: "subscription-1",
      confirmed: true,
      now,
      ip: "203.0.113.11",
    },
    dependencies,
  );

  assert.equal(result.ok, true);
  assert.equal(updates.length, 1);
});

test("rejects an account that is neither owner nor recipient", async () => {
  const { dependencies, updates, revoked } = makeDependencies({ authorized: false });

  const result = await rotate(
    { accountId: "stranger-1", type: "secondary", id: "subscription-1", confirmed: true, now, ip: "203.0.113.12" },
    dependencies,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(updates.length, 0);
  assert.deepEqual(revoked, []);
});

test("requires confirmed true", async () => {
  const { dependencies, updates, revoked } = makeDependencies();

  const result = await rotate(
    { accountId: "owner-1", type: "root", id: "owner-1", confirmed: false, now, ip: "203.0.113.13" },
    dependencies,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(updates.length, 0);
  assert.deepEqual(revoked, []);
});

test("returns cooldown retryAt without consuming it", async () => {
  const { dependencies, updates, revoked } = makeDependencies({
    recentRotation: new Date("2026-08-13T09:00:00.000Z"),
  });

  const result = await rotate(
    { accountId: "owner-1", type: "root", id: "owner-1", confirmed: true, now, ip: "203.0.113.14" },
    dependencies,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.deepEqual(result.retryAt, new Date("2026-08-13T15:00:00.000Z"));
  assert.equal(updates.length, 0);
  assert.deepEqual(revoked, []);
});

test("does not update the database when Remnawave fails", async () => {
  const { dependencies, updates } = makeDependencies({
    revokeResult: { status: 503, error: "unavailable" },
  });

  const result = await rotate(
    { accountId: "owner-1", type: "root", id: "owner-1", confirmed: true, now, ip: "203.0.113.15" },
    dependencies,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(updates.length, 0);
});

test("rejects an invalid URL or changed invariant before committing", async () => {
  const invalid = makeDependencies({
    after: {
      ...remoteUser("new-short"),
      data: {
        response: {
          ...((remoteUser("new-short").data as { response: Record<string, unknown> }).response),
          subscriptionUrl: "https://evil.example/new-short",
        },
      },
    },
  });
  const invalidResult = await rotate(
    { accountId: "owner-1", type: "root", id: "owner-1", confirmed: true, now, ip: "203.0.113.16" },
    invalid.dependencies,
  );
  assert.equal(invalidResult.ok, false);
  assert.equal(invalid.updates.length, 0);

  const changed = makeDependencies({ after: remoteUser("new-short", { trafficLimitBytes: 2_000 }) });
  const changedResult = await rotate(
    { accountId: "owner-1", type: "root", id: "owner-1", confirmed: true, now, ip: "203.0.113.17" },
    changed.dependencies,
  );
  assert.equal(changedResult.ok, false);
  assert.equal(changed.updates.length, 0);
});
