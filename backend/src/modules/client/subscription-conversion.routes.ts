import jwt, { type JwtPayload } from "jsonwebtoken";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { env } from "../../config/index.js";
import { prisma } from "../../db.js";
import { requireClientAuth } from "./client.middleware.js";
import { getSystemConfig } from "./client.service.js";
import {
  findConvertibleSubscription,
  trialAllowsTariff,
  withClientSubscriptionLock,
} from "../tariff/tariff-activation.service.js";
import {
  quoteConvertedDays,
  type ConversionDirection,
  type ConversionInput,
  type ConversionQuote,
} from "../subscription/subscription-change.policy.js";
import {
  extractRemnaSubscriptionUrl,
} from "../subscription/subscription-url.js";
import {
  extractRemnaUuid,
  isRemnaConfigured,
  remnaGetUser,
  remnaResetUserTraffic,
  remnaUpdateUser,
} from "../remna/remna.client.js";
import {
  applyTrafficEntitlement,
  validateTrafficEntitlement,
} from "../squad-traffic/traffic-entitlement.service.js";
import { remnaTrafficSettings } from "../squad-traffic/traffic-remna-policy.js";

export const MANUAL_CONVERSION_QUOTE_TTL = "15m";
const MANUAL_CONVERSION_QUOTE_TYPE = "manual_subscription_conversion_quote";
const DAY_MS = 24 * 60 * 60 * 1000;

type ManualConversionInput = ConversionInput & {
  subscriptionId: string;
  clientId: string;
  tariffId: string;
  priceOptionId: string | null;
  sourceExpireAt: string;
  sourceRevision: string;
};

export type ManualConversionQuote = ConversionQuote & {
  clientId: string;
  subscriptionId: string;
  tariffId: string;
  priceOptionId: string | null;
  sourceExpireAt: string;
  sourceRevision: string;
  remainingDays: number;
  rawConvertedDays: number;
  rounding: "ceil" | "floor" | "none";
  totalDays: number;
  issuedAt: number;
};

type ManualConversionToken = ManualConversionQuote & {
  type: typeof MANUAL_CONVERSION_QUOTE_TYPE;
  iat: number;
  exp: number;
};

type RemnawaveIdentity = {
  uuid: string | null;
  shortUuid: string | null;
  subscriptionUrl: string | null;
};

type ClientRequest = Request & { clientId?: string };

class ManualConversionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function roundedRemainingDays(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function rawConvertedDays(input: ConversionInput, remainingDays: number): number {
  if (input.sameTariff || input.isTrial) return remainingDays;
  if (!Number.isFinite(input.oldPricePerDay) || !Number.isFinite(input.newPricePerDay)) return 0;
  if ((input.oldPricePerDay ?? 0) <= 0 || input.newPricePerDay <= 0) return 0;
  return remainingDays * (input.oldPricePerDay as number) / input.newPricePerDay;
}

function roundingFor(direction: ConversionDirection): "ceil" | "floor" | "none" {
  if (direction === "upgrade") return "ceil";
  if (direction === "same" || direction === "trial") return "none";
  return "floor";
}

export function calculateManualConversionQuote(input: ManualConversionInput): ManualConversionQuote {
  const remainingDays = roundedRemainingDays(input.remainingDays);
  const policy = quoteConvertedDays(input);
  const raw = rawConvertedDays(input, remainingDays);

  return {
    ...policy,
    clientId: input.clientId,
    subscriptionId: input.subscriptionId,
    tariffId: input.tariffId,
    priceOptionId: input.priceOptionId,
    sourceExpireAt: input.sourceExpireAt,
    sourceRevision: input.sourceRevision,
    remainingDays,
    rawConvertedDays: raw,
    rounding: roundingFor(policy.direction),
    totalDays: policy.convertedDays,
    issuedAt: Math.floor(Date.now() / 1000),
  };
}

export function signManualConversionQuote(quote: ManualConversionQuote): string {
  return jwt.sign(
    { ...quote, type: MANUAL_CONVERSION_QUOTE_TYPE },
    env.JWT_SECRET,
    { expiresIn: MANUAL_CONVERSION_QUOTE_TTL },
  );
}

export function verifyManualConversionQuote(token: string): ManualConversionToken {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded !== "object" || decoded === null) throw new Error("Некорректный quote token");
  const payload = decoded as JwtPayload & Partial<ManualConversionToken>;
  if (payload.type !== MANUAL_CONVERSION_QUOTE_TYPE
    || typeof payload.clientId !== "string"
    || typeof payload.subscriptionId !== "string"
    || typeof payload.tariffId !== "string"
    || typeof payload.sourceExpireAt !== "string"
    || typeof payload.sourceRevision !== "string"
    || typeof payload.convertedDays !== "number"
    || typeof payload.iat !== "number"
    || typeof payload.exp !== "number") {
    throw new Error("Некорректный quote token");
  }
  return payload as ManualConversionToken;
}

export function isManualConversionQuoteStale(
  quote: Pick<ManualConversionQuote, "sourceExpireAt" | "sourceRevision">,
  source: { expireAt: Date | null; sourceRevision: string },
): boolean {
  return quote.sourceExpireAt !== (source.expireAt?.toISOString() ?? "")
    || quote.sourceRevision !== source.sourceRevision;
}

export function assertRemnawaveIdentityPreserved(before: RemnawaveIdentity, after: RemnawaveIdentity): void {
  if (before.uuid !== after.uuid
    || before.shortUuid !== after.shortUuid
    || before.subscriptionUrl !== after.subscriptionUrl) {
    throw new Error("Конвертация не должна менять UUID, short UUID или ссылку подписки");
  }
}

const quoteBodySchema = z.object({
  subscriptionId: z.string().min(1),
  tariffId: z.string().min(1),
  priceOptionId: z.string().min(1).nullable().optional(),
});

const applyBodySchema = z.object({
  quoteToken: z.string().min(1),
});

const sourceSelect = {
  id: true,
  ownerId: true,
  remnawaveUuid: true,
  remnawaveShortUuid: true,
  subscriptionIndex: true,
  tariffId: true,
  trialId: true,
  giftStatus: true,
  giftedToClientId: true,
  purchasedAsGift: true,
  deletionRequestedAt: true,
  expireAt: true,
  updatedAt: true,
  currentPricePerDay: true,
  extraDevices: true,
  extraDevicesMonthlyPrice: true,
  tariff: { select: { name: true, categoryId: true } },
  trial: { select: { tariffId: true, convertEnabled: true, convertAllTariffs: true, convertTariffIds: true } },
} as const;

const targetSelect = {
  id: true,
  name: true,
  durationDays: true,
  price: true,
  internalSquadUuids: true,
  trafficLimitBytes: true,
  trafficResetMode: true,
  trafficLimitMode: true,
  meteredSquadUuid: true,
  includedDevices: true,
  categoryId: true,
  priceOptions: {
    select: { id: true, durationDays: true, price: true },
    orderBy: { sortOrder: "asc" },
  },
} as const;

async function loadSource(clientId: string, subscriptionId: string) {
  return prisma.subscription.findFirst({
    where: {
      id: subscriptionId,
      ownerId: clientId,
      purchasedAsGift: false,
      giftStatus: null,
      giftedToClientId: null,
      deletionRequestedAt: null,
      remnawaveUuid: { not: null },
    },
    select: sourceSelect,
  });
}

async function loadTarget(tariffId: string) {
  return prisma.tariff.findUnique({ where: { id: tariffId }, select: targetSelect });
}

function selectPriceOption(
  target: NonNullable<Awaited<ReturnType<typeof loadTarget>>>,
  priceOptionId: string | null,
) {
  if (priceOptionId) {
    const selected = target.priceOptions.find((option) => option.id === priceOptionId);
    if (!selected) throw new ManualConversionError(404, "Опция тарифа не найдена");
    return selected;
  }
  return target.priceOptions[0] ?? {
    id: null,
    durationDays: target.durationDays,
    price: target.price,
  };
}

function sourcePricePerDay(source: NonNullable<Awaited<ReturnType<typeof loadSource>>>): number | null {
  const extrasPerDay = source.extraDevices > 0 ? source.extraDevicesMonthlyPrice / 30 : 0;
  return source.currentPricePerDay != null
    ? source.currentPricePerDay + extrasPerDay
    : (extrasPerDay > 0 ? extrasPerDay : null);
}

function targetPricePerDay(
  target: NonNullable<Awaited<ReturnType<typeof loadTarget>>>,
  option: { durationDays: number; price: number },
  source: NonNullable<Awaited<ReturnType<typeof loadSource>>>,
): number {
  const extrasPerDay = source.extraDevices > 0 ? source.extraDevicesMonthlyPrice / 30 : 0;
  const base = option.durationDays > 0 ? option.price / option.durationDays : 0;
  return base + extrasPerDay;
}

export function sameTariffCategory(sourceCategoryId: string | null | undefined, targetCategoryId: string | null): boolean {
  return sourceCategoryId === targetCategoryId;
}

async function assertConvertible(
  clientId: string,
  source: NonNullable<Awaited<ReturnType<typeof loadSource>>>,
  target: NonNullable<Awaited<ReturnType<typeof loadTarget>>>,
) {
  if (source.tariffId && !sameTariffCategory(source.tariff?.categoryId, target.categoryId)) {
    throw new ManualConversionError(400, "Конвертация доступна только между тарифами одного раздела");
  }
  const config = await getSystemConfig().catch(() => null);
  const multiSubEnabled = (config as { multiSubscriptionsEnabled?: boolean } | null)?.multiSubscriptionsEnabled ?? false;
  const convertible = await findConvertibleSubscription(clientId, target.id, multiSubEnabled);
  if (!convertible || convertible.id !== source.id) {
    throw new ManualConversionError(409, "Подписка изменилась. Обновите предпросмотр конвертации");
  }
  if (source.trialId && !source.trial) {
    throw new ManualConversionError(409, "Пробная подписка больше недоступна для конвертации");
  }
  if (source.trialId && source.trial && !trialAllowsTariff(source.trial, target.id)) {
    throw new ManualConversionError(400, "Переход с пробного тарифа на этот тариф запрещён");
  }
}

async function buildQuote(clientId: string, input: z.infer<typeof quoteBodySchema>) {
  const source = await loadSource(clientId, input.subscriptionId);
  if (!source) throw new ManualConversionError(404, "Подписка не найдена");
  const target = await loadTarget(input.tariffId);
  if (!target) throw new ManualConversionError(404, "Тариф не найден");
  await assertConvertible(clientId, source, target);

  const option = selectPriceOption(target, input.priceOptionId ?? null);
  const remainingDays = source.expireAt
    ? Math.max(0, Math.floor((source.expireAt.getTime() - Date.now()) / DAY_MS))
    : 0;
  const conversion = calculateManualConversionQuote({
    subscriptionId: source.id,
    clientId,
    tariffId: target.id,
    priceOptionId: option.id,
    sourceExpireAt: source.expireAt?.toISOString() ?? "",
    sourceRevision: source.updatedAt.toISOString(),
    remainingDays,
    oldPricePerDay: sourcePricePerDay(source),
    newPricePerDay: targetPricePerDay(target, option, source),
    sameTariff: source.tariffId === target.id && source.trialId == null,
    isTrial: source.trialId != null,
  });
  if (!conversion.allowed) {
    throw new ManualConversionError(400, "Для этой подписки конвертация недоступна");
  }

  return { source, target, option, conversion };
}

function quoteResponse(
  context: Awaited<ReturnType<typeof buildQuote>>,
  quoteToken: string,
) {
  const { source, target, option, conversion } = context;
  return {
    quoteToken,
    subscriptionId: source.id,
    tariffId: target.id,
    priceOptionId: option.id,
    sourceExpireAt: conversion.sourceExpireAt,
    sourceRevision: conversion.sourceRevision,
    currentTariff: { id: source.tariffId, name: source.tariff?.name ?? null },
    targetTariff: { id: target.id, name: target.name },
    remainingDays: conversion.remainingDays,
    rawConvertedDays: conversion.rawConvertedDays,
    rounding: conversion.rounding,
    direction: conversion.direction,
    commissionPercent: conversion.commissionPercent,
    convertedDays: conversion.convertedDays,
    totalDays: conversion.totalDays,
  };
}

function requestClientId(req: Request): string {
  const clientId = (req as ClientRequest).clientId;
  if (!clientId) throw new ManualConversionError(401, "Требуется авторизация клиента");
  return clientId;
}

function sendManualConversionError(res: Response, error: unknown) {
  if (error instanceof ManualConversionError) return res.status(error.status).json({ message: error.message });
  console.error("[subscription-conversion] failed:", error);
  return res.status(500).json({ message: "Не удалось выполнить конвертацию" });
}

async function applyQuote(clientId: string, tokenQuote: ManualConversionToken) {
  return withClientSubscriptionLock(clientId, async () => {
    const context = await buildQuote(clientId, {
      subscriptionId: tokenQuote.subscriptionId,
      tariffId: tokenQuote.tariffId,
      priceOptionId: tokenQuote.priceOptionId,
    });
    const { source, target, option, conversion } = context;
    if (isManualConversionQuoteStale(tokenQuote, {
      expireAt: source.expireAt,
      sourceRevision: source.updatedAt.toISOString(),
    })
      || conversion.convertedDays !== tokenQuote.convertedDays
      || conversion.rawConvertedDays !== tokenQuote.rawConvertedDays
      || conversion.direction !== tokenQuote.direction
      || conversion.commissionPercent !== tokenQuote.commissionPercent) {
      throw new ManualConversionError(409, "Расчёт устарел. Обновите предпросмотр конвертации");
    }
    if (!source.remnawaveUuid || !isRemnaConfigured()) {
      throw new ManualConversionError(503, "Сервис временно недоступен");
    }

    const beforeUser = await remnaGetUser(source.remnawaveUuid);
    if (beforeUser.error || !beforeUser.data) {
      throw new ManualConversionError(404, "Пользователь VPN для этой подписки не найден");
    }
    const beforeIdentity: RemnawaveIdentity = {
      uuid: source.remnawaveUuid,
      shortUuid: source.remnawaveShortUuid,
      subscriptionUrl: extractRemnaSubscriptionUrl(beforeUser.data),
    };
    const traffic = validateTrafficEntitlement({
      tariffId: target.id,
      mode: target.trafficLimitMode as "REMNAWAVE" | "LOCAL_SQUAD",
      internalSquadUuids: target.internalSquadUuids,
      meteredSquadUuid: target.meteredSquadUuid,
      trafficLimitBytes: target.trafficLimitBytes,
    });
    const remoteTraffic = remnaTrafficSettings(target);
    const expireAt = new Date(Date.now() + conversion.convertedDays * DAY_MS);
    if (traffic.mode !== "LOCAL_SQUAD") await remnaResetUserTraffic(source.remnawaveUuid);
    const update = await remnaUpdateUser({
      uuid: source.remnawaveUuid,
      expireAt: expireAt.toISOString(),
      ...remoteTraffic,
      hwidDeviceLimit: Math.max(1, target.includedDevices ?? 1) + Math.max(0, source.extraDevices),
      activeInternalSquads: target.internalSquadUuids,
    });
    if (update.error) throw new ManualConversionError(update.status >= 400 ? update.status : 502, update.error);

    await prisma.subscription.update({
      where: { id: source.id },
      data: {
        tariffId: target.id,
        trialId: null,
        expireAt,
        customPrice: option.price,
        currentPricePerDay: option.durationDays > 0 ? option.price / option.durationDays : null,
      },
    });
    if (source.subscriptionIndex === 0) {
      await prisma.client.update({
        where: { id: clientId },
        data: {
          currentTariffId: target.id,
          currentPricePerDay: option.durationDays > 0 ? option.price / option.durationDays : null,
          customPrimaryPrice: option.price,
        },
      });
    }
    await applyTrafficEntitlement(
      source.id,
      traffic,
      conversion.direction === "same" ? "RENEWAL" : "TARIFF_CHANGE",
    );

    const afterUser = await remnaGetUser(source.remnawaveUuid);
    if (!afterUser.error && afterUser.data) {
      const afterIdentity: RemnawaveIdentity = {
        uuid: extractRemnaUuid(afterUser.data) ?? beforeIdentity.uuid,
        shortUuid: beforeIdentity.shortUuid,
        subscriptionUrl: extractRemnaSubscriptionUrl(afterUser.data) ?? beforeIdentity.subscriptionUrl,
      };
      assertRemnawaveIdentityPreserved(beforeIdentity, afterIdentity);
    }
    return {
      subscriptionId: source.id,
      tariffId: target.id,
      priceOptionId: option.id,
      direction: conversion.direction,
      commissionPercent: conversion.commissionPercent,
      convertedDays: conversion.convertedDays,
      totalDays: conversion.totalDays,
      remnawaveUuid: beforeIdentity.uuid,
      remnawaveShortUuid: beforeIdentity.shortUuid,
      subscriptionUrl: beforeIdentity.subscriptionUrl,
    };
  });
}

export const subscriptionConversionRouter = Router();
subscriptionConversionRouter.use(requireClientAuth);

subscriptionConversionRouter.post("/quote", async (req, res) => {
  try {
    const body = quoteBodySchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Некорректные данные конвертации" });
    const clientId = requestClientId(req);
    const context = await buildQuote(clientId, body.data);
    return res.json(quoteResponse(context, signManualConversionQuote(context.conversion)));
  } catch (error) {
    return sendManualConversionError(res, error);
  }
});

subscriptionConversionRouter.post("/", async (req, res) => {
  try {
    const body = applyBodySchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "quoteToken обязателен" });
    const clientId = requestClientId(req);
    let tokenQuote: ManualConversionToken;
    try {
      tokenQuote = verifyManualConversionQuote(body.data.quoteToken);
    } catch {
      throw new ManualConversionError(409, "Расчёт устарел. Обновите предпросмотр конвертации");
    }
    if (tokenQuote.clientId !== clientId) {
      throw new ManualConversionError(409, "Расчёт принадлежит другому клиенту");
    }
    return res.json(await applyQuote(clientId, tokenQuote));
  } catch (error) {
    return sendManualConversionError(res, error);
  }
});
