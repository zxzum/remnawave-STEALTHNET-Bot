import { prisma } from "../../db.js";
import { logAdminEvent } from "../audit/audit.service.js";
import {
  extractRemnaUuid,
  remnaGetUser,
  remnaRevokeUserSubscription,
} from "../remna/remna.client.js";
import { extractRemnaSubscriptionUrl } from "./subscription-url.js";

const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const LOCK_PREFIX = "subscription-link-rotation:";

export type SubscriptionLinkRotationType = "root" | "secondary";

export type SubscriptionLinkRotationInput = {
  accountId: string;
  type: SubscriptionLinkRotationType;
  id: string;
  confirmed: boolean;
  now?: Date;
  ip?: string | null;
};

export type SubscriptionLinkRotationResult =
  | {
      ok: true;
      subscriptionUrl: string;
      shortUuid: string;
      linkRotatedAt: Date;
    }
  | {
      ok: false;
      status: number;
      message: string;
      retryAt?: Date;
    };

type SubscriptionRow = {
  id: string;
  ownerId: string;
  giftedToClientId: string | null;
  subscriptionIndex: number;
  remnawaveUuid: string | null;
  remnawaveShortUuid: string | null;
  linkRotatedAt: Date | null;
  tariffId: string | null;
  expireAt: Date | null;
};

type RemoteResult = {
  status: number;
  data?: unknown;
  error?: string;
};

type AuditEvent = {
  kind: string;
  actorId: string;
  actorIp: string | null;
  target: { type: string; id: string };
  payload: Record<string, unknown>;
};

export type SubscriptionLinkRotationDependencies = {
  // Prisma's generated transaction type is intentionally kept behind this small seam for service tests.
  prisma: {
    $transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>;
  };
  revokeUser: (uuid: string) => Promise<RemoteResult>;
  getUser: (uuid: string) => Promise<RemoteResult>;
  audit: (event: AuditEvent) => Promise<void>;
};

class RotationError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAt?: Date,
  ) {
    super(message);
    this.name = "RotationError";
  }
}

function resultFromError(error: RotationError): SubscriptionLinkRotationResult {
  return {
    ok: false,
    status: error.status,
    message: error.message,
    ...(error.retryAt ? { retryAt: error.retryAt } : {}),
  };
}

function isSuccessful(result: RemoteResult, needsData: boolean): boolean {
  return result.status >= 200 && result.status < 300 && (!needsData || result.data !== undefined);
}

function remoteError(result: RemoteResult, operation: string): RotationError {
  const status = result.status >= 400 && result.status <= 599 ? result.status : 502;
  return new RotationError(status, `Remnawave ${operation} failed`);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const nested = root.response ?? root.data;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : root;
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function firstScalar(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const found = scalar(value[key]);
    if (found !== null) return found;
  }
  return null;
}

function normalizedDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizedSquads(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      return firstScalar(record, ["uuid", "id", "name"]);
    })
    .filter((item): item is string => item !== null)
    .sort();
}

type RemoteInvariants = {
  uuid: string | null;
  tariff: string | null;
  expiry: string | null;
  traffic: { limit: string | null; strategy: string | null };
  devices: { limit: string | null; active: string | null };
  squads: string[] | null;
  externalSquads: string[] | null;
};

function remoteInvariants(data: unknown): RemoteInvariants {
  const value = objectValue(data) ?? {};
  return {
    uuid: extractRemnaUuid(data),
    tariff: firstScalar(value, [
      "tariffId",
      "tariffUuid",
      "subscriptionUuid",
      "subscriptionId",
      "planId",
      "planUuid",
      "templateUuid",
      "subscriptionTemplateUuid",
    ]),
    expiry: normalizedDate(value.expireAt ?? value.expirationDate ?? value.expire_at),
    traffic: {
      limit: firstScalar(value, ["trafficLimitBytes", "trafficLimit", "traffic_limit_bytes"]),
      strategy: firstScalar(value, ["trafficLimitStrategy", "traffic_limit_strategy"]),
    },
    devices: {
      limit: firstScalar(value, ["hwidDeviceLimit", "deviceLimit", "hwid_device_limit"]),
      active: firstScalar(value, ["activeHwidDeviceCount", "activeDeviceCount"]),
    },
    squads: normalizedSquads(value.activeInternalSquads ?? value.internalSquads ?? value.squads),
    externalSquads: normalizedSquads(value.activeExternalSquads ?? value.externalSquads),
  };
}

function remoteShortUuid(data: unknown): string | null {
  const value = objectValue(data);
  return value ? firstScalar(value, ["shortUuid", "short_uuid"]) : null;
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

function dbInvariantsEqual(left: SubscriptionRow, right: SubscriptionRow): boolean {
  return left.remnawaveUuid === right.remnawaveUuid
    && left.remnawaveShortUuid === right.remnawaveShortUuid
    && left.tariffId === right.tariffId
    && sameDate(left.expireAt, right.expireAt);
}

const defaultDependencies: SubscriptionLinkRotationDependencies = {
  prisma: prisma as unknown as SubscriptionLinkRotationDependencies["prisma"],
  revokeUser: remnaRevokeUserSubscription,
  getUser: remnaGetUser,
  audit: async (event) => {
    await logAdminEvent(
      event.kind,
      event.actorId,
      event.actorIp,
      event.target,
      event.payload,
    );
  },
};

export async function reissueSubscriptionLink(
  input: SubscriptionLinkRotationInput,
  dependencies: SubscriptionLinkRotationDependencies = defaultDependencies,
): Promise<SubscriptionLinkRotationResult> {
  if (!input.accountId || !input.id) {
    return { ok: false, status: 400, message: "Subscription identifier is required" };
  }
  if (input.type !== "root" && input.type !== "secondary") {
    return { ok: false, status: 400, message: "Invalid subscription type" };
  }
  if (input.confirmed !== true) {
    return { ok: false, status: 400, message: "Confirmation is required" };
  }

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return { ok: false, status: 400, message: "Invalid timestamp" };
  }

  let previousShortUuid: string | null = null;
  let auditTargetId = input.id;

  try {
    const result = await dependencies.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${LOCK_PREFIX}${input.accountId}`}))`;

      const where = input.type === "root"
        ? {
            subscriptionIndex: 0,
            OR: [{ ownerId: input.accountId }, { giftedToClientId: input.accountId }],
          }
        : {
            id: input.id,
            OR: [{ ownerId: input.accountId }, { giftedToClientId: input.accountId }],
          };
      const subscription = await tx.subscription.findFirst({
        where,
        select: {
          id: true,
          ownerId: true,
          giftedToClientId: true,
          subscriptionIndex: true,
          remnawaveUuid: true,
          remnawaveShortUuid: true,
          linkRotatedAt: true,
          tariffId: true,
          expireAt: true,
        },
      }) as SubscriptionRow | null;

      if (!subscription) throw new RotationError(403, "You cannot reissue this subscription link");
      if (!subscription.remnawaveUuid) {
        throw new RotationError(404, "Subscription is not connected to Remnawave");
      }
      previousShortUuid = subscription.remnawaveShortUuid;
      auditTargetId = subscription.id;

      const recent = await tx.subscription.findFirst({
        where: {
          linkRotatedAt: { gte: new Date(now.getTime() - COOLDOWN_MS) },
          OR: [{ ownerId: input.accountId }, { giftedToClientId: input.accountId }],
        },
        orderBy: { linkRotatedAt: "desc" },
        select: { linkRotatedAt: true },
      }) as Pick<SubscriptionRow, "linkRotatedAt"> | null;
      if (recent?.linkRotatedAt) {
        throw new RotationError(
          429,
          "Subscription link rotation is temporarily unavailable",
          new Date(recent.linkRotatedAt.getTime() + COOLDOWN_MS),
        );
      }

      const before = await dependencies.getUser(subscription.remnawaveUuid);
      if (!isSuccessful(before, true)) throw remoteError(before, "user lookup");
      if (extractRemnaUuid(before.data) !== subscription.remnawaveUuid) {
        throw new RotationError(502, "Remnawave user UUID changed");
      }
      const oldRemoteShortUuid = remoteShortUuid(before.data);
      if (subscription.remnawaveShortUuid && oldRemoteShortUuid && oldRemoteShortUuid !== subscription.remnawaveShortUuid) {
        throw new RotationError(409, "Subscription link is out of sync");
      }
      const beforeInvariants = remoteInvariants(before.data);

      const revoked = await dependencies.revokeUser(subscription.remnawaveUuid);
      if (!isSuccessful(revoked, false)) throw remoteError(revoked, "subscription revoke");

      const after = await dependencies.getUser(subscription.remnawaveUuid);
      if (!isSuccessful(after, true)) throw remoteError(after, "user refresh");
      if (extractRemnaUuid(after.data) !== subscription.remnawaveUuid) {
        throw new RotationError(502, "Remnawave user UUID changed");
      }

      const subscriptionUrl = extractRemnaSubscriptionUrl(after.data);
      if (!subscriptionUrl) throw new RotationError(502, "Remnawave returned an invalid subscription URL");
      const shortUuid = new URL(subscriptionUrl).pathname.slice(1);
      if (subscription.remnawaveShortUuid === shortUuid) {
        throw new RotationError(502, "Remnawave did not rotate the subscription link");
      }
      const newRemoteShortUuid = remoteShortUuid(after.data);
      if (newRemoteShortUuid && newRemoteShortUuid !== shortUuid) {
        throw new RotationError(502, "Remnawave returned inconsistent subscription identifiers");
      }
      if (JSON.stringify(beforeInvariants) !== JSON.stringify(remoteInvariants(after.data))) {
        throw new RotationError(502, "Remnawave changed subscription attributes during reissue");
      }

      const current = await tx.subscription.findUnique({
        where: { id: subscription.id },
        select: {
          id: true,
          ownerId: true,
          giftedToClientId: true,
          subscriptionIndex: true,
          remnawaveUuid: true,
          remnawaveShortUuid: true,
          linkRotatedAt: true,
          tariffId: true,
          expireAt: true,
        },
      }) as SubscriptionRow | null;
      if (!current || !dbInvariantsEqual(subscription, current)) {
        throw new RotationError(409, "Subscription changed during link reissue");
      }

      await tx.subscription.update({
        where: { id: subscription.id },
        data: { remnawaveShortUuid: shortUuid, linkRotatedAt: now },
      });

      return { ok: true as const, subscriptionUrl, shortUuid, linkRotatedAt: now };
    });

    await dependencies.audit({
      kind: "subscription.link_rotated",
      actorId: input.accountId,
      actorIp: input.ip ?? null,
      target: { type: "subscription", id: auditTargetId },
      payload: {
        previousShortUuid,
        newShortUuid: result.shortUuid,
      },
    }).catch(() => {});
    return result;
  } catch (error) {
    if (error instanceof RotationError) return resultFromError(error);
    return { ok: false, status: 500, message: "Subscription link reissue failed" };
  }
}
