/**
 * T-extras-drop-after-pay (14.05.2026)
 *
 * Helper для удаления всех доп. устройств подписки с жёстким kick HWID в Remna.
 * Используется в двух точках:
 *   1. UI endpoint /api/client/subscription/:type/:id/remove-extra-devices (юзер сам нажал)
 *   2. ПОСЛЕ успешной активации платежа (если в metadata.removeExtrasOnActivate=true)
 *
 * Что делает:
 *   • Получает текущие HWID-устройства из Remna
 *   • Если их больше нового лимита (tariff.includedDevices) — удаляет лишние (старые первыми)
 *   • Уменьшает hwidDeviceLimit в Remna до базы тарифа
 *   • Обнуляет Subscription.extraDevices + extraDevicesMonthlyPrice
 *
 * Идемпотентно: повторный вызов для подписки без extras — no-op.
 */
import { prisma } from "../../db.js";
import {
  remnaGetUserHwidDevices,
  remnaDeleteUserHwidDevice,
  remnaUpdateUser,
} from "../remna/remna.client.js";
import { isActiveSubscriptionGrace, withSubscriptionClientLock } from "./single-subscription-lifecycle.service.js";

export interface RemoveExtrasResult {
  ok: boolean;
  extraDevicesRemoved: number;
  hwidKicked: number;
  newDeviceLimit: number;
  error?: string;
}

type RemnaResult = { data?: unknown; error?: string; status: number };
type ExtraDeviceRequests = {
  get: (uuid: string) => Promise<RemnaResult>;
  remove: (uuid: string, hwid: string) => Promise<RemnaResult>;
  update: (payload: Record<string, unknown>) => Promise<RemnaResult>;
};

const extraDeviceRequests: ExtraDeviceRequests = {
  get: remnaGetUserHwidDevices,
  remove: remnaDeleteUserHwidDevice,
  update: remnaUpdateUser,
};

function requestError(result: RemnaResult): string | null {
  return result.error ?? (result.status >= 400 ? `Remnawave request failed (${result.status})` : null);
}

async function kickExcessHwidDevicesWith(
  remnawaveUuid: string,
  keepLimit: number,
  requests: Pick<ExtraDeviceRequests, "get" | "remove">,
): Promise<{ ok: boolean; removed: number; error?: string }> {
  try {
    const devicesRes = await requests.get(remnawaveUuid);
    const getError = requestError(devicesRes);
    if (getError) return { ok: false, removed: 0, error: getError };
    const devicesData = devicesRes.data as { response?: { devices?: Array<{ hwid: string; createdAt?: string }> } } | undefined;
    const activeDevices = devicesData?.response?.devices ?? [];
    const sorted = [...activeDevices].sort((a, b) => {
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aT - bT;
    });
    let removed = 0;
    for (const device of sorted.slice(0, Math.max(0, activeDevices.length - keepLimit))) {
      const result = await requests.remove(remnawaveUuid, device.hwid);
      const error = requestError(result);
      if (error) return { ok: false, removed, error };
      removed++;
    }
    return { ok: true, removed };
  } catch (error) {
    return { ok: false, removed: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function removePaidExtrasFromRemna(
  remnawaveUuid: string,
  keepLimit: number,
  commit: () => Promise<void>,
  requests: ExtraDeviceRequests = extraDeviceRequests,
): Promise<{ ok: boolean; removed: number; error?: string }> {
  const kicked = await kickExcessHwidDevicesWith(remnawaveUuid, keepLimit, requests);
  if (!kicked.ok) return kicked;
  try {
    const updated = await requests.update({ uuid: remnawaveUuid, hwidDeviceLimit: keepLimit });
    const error = requestError(updated);
    if (error) return { ok: false, removed: kicked.removed, error };
    await commit();
    return kicked;
  } catch (error) {
    return { ok: false, removed: kicked.removed, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Кикает HWID-устройства сверх лимита `keepLimit` (старые первыми) — без изменения
 * лимита/счётчиков. Используется когда лимит уже выставлен вызывающим кодом
 * (например extendSecondarySubscription при «продлить без устройств»).
 * Возвращает количество киканутых устройств.
 */
export async function kickExcessHwidDevices(remnawaveUuid: string, keepLimit: number): Promise<number> {
  const result = await kickExcessHwidDevicesWith(remnawaveUuid, keepLimit, extraDeviceRequests);
  if (!result.ok) console.error("[remove-extras-helper] devices kick error:", result.error);
  return result.removed;
}

export async function kickExcessSubscriptionHwidDevices(subId: string, keepLimit: number): Promise<number> {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subId },
    select: {
      remnawaveUuid: true,
    },
  });
  if (!subscription?.remnawaveUuid) return 0;
  return kickExcessHwidDevices(subscription.remnawaveUuid, keepLimit);
}

export async function removeAllExtraDevicesForSub(subId: string): Promise<RemoveExtrasResult> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: {
      id: true,
      ownerId: true,
      remnawaveUuid: true,
      tariffId: true,
      extraDevices: true,
    },
  });
  if (!sub) {
    return { ok: false, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: 0, error: "подписка не найдена" };
  }
  if (!sub.remnawaveUuid) {
    return { ok: false, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: 0, error: "подписка не привязана к панели" };
  }
  if ((sub.extraDevices ?? 0) === 0) {
    // Уже нет extras — ничего не делаем.
    return { ok: true, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: 0 };
  }
  const tariff = sub.tariffId
    ? await prisma.tariff.findUnique({
        where: { id: sub.tariffId },
        select: { includedDevices: true, deviceLimit: true },
      })
    : null;
  const includedDevices = tariff?.includedDevices ?? tariff?.deviceLimit ?? 1;

  // Удаление extras под клиентским advisory-локом; grace перепроверяется внутри (§4 финала).
  if (!sub.remnawaveUuid || !sub.ownerId) {
    return { ok: false, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: includedDevices, error: "подписка не привязана к панели" };
  }
  return withSubscriptionClientLock(sub.ownerId, async (): Promise<RemoveExtrasResult> => {
    const graceRow = await prisma.subscription.findUnique({ where: { id: subId }, select: { graceUntil: true } });
    if (isActiveSubscriptionGrace(graceRow?.graceUntil ?? null)) {
      return { ok: false, extraDevicesRemoved: 0, hwidKicked: 0, newDeviceLimit: includedDevices, error: "Подписка в режиме продления Lazeika-Only: сначала продлите тариф" };
    }
    const inner = await removePaidExtrasFromRemna(sub.remnawaveUuid!, includedDevices, async () => {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { extraDevices: 0, extraDevicesMonthlyPrice: 0 },
      });
    });
    if (!inner.ok) {
      return { ok: false, extraDevicesRemoved: 0, hwidKicked: inner.removed, newDeviceLimit: includedDevices, ...(inner.error ? { error: inner.error } : {}) };
    }
    return { ok: true, extraDevicesRemoved: sub.extraDevices ?? 0, hwidKicked: inner.removed, newDeviceLimit: includedDevices };
  });
}

export interface GrantDevicesResult {
  ok: boolean;
  newDeviceLimit: number;
  error?: string;
}

// T-admin-services (портировано из WolfVPN): ВЫДАТЬ доп. устройства подписке (как покупка юзера,
// но инициирует админ — без оплаты). hwidDeviceLimit += N в Remna + extraDevices/monthlyPrice += в БД.
// monthlyPrice (₽/30 дней) попадает в цену продления автоматически (см. client.routes расчёт).
export async function applyDevicesToSubscription(subId: string, deviceCount: number, monthlyPrice: number): Promise<GrantDevicesResult> {
  if (!Number.isFinite(deviceCount) || deviceCount <= 0) {
    return { ok: false, newDeviceLimit: 0, error: "Количество устройств должно быть больше 0" };
  }
  const sub = await prisma.subscription.findUnique({
    where: { id: subId },
    select: {
      id: true,
      remnawaveUuid: true,
      extraDevices: true,
      graceUntil: true,
      tariff: { select: { includedDevices: true, deviceLimit: true } },
    },
  });
  if (!sub) return { ok: false, newDeviceLimit: 0, error: "подписка не найдена" };
  if (!sub.remnawaveUuid) return { ok: false, newDeviceLimit: 0, error: "подписка не привязана к панели" };
  // Активный Lazeika-Only grace: выдача устройств отложена до восстановления тарифа (§4.4).
  if (isActiveSubscriptionGrace(sub.graceUntil ?? null)) {
    return { ok: false, newDeviceLimit: 0, error: "Подписка в режиме продления Lazeika-Only: сначала продлите тариф" };
  }
  const includedDevices = sub.tariff?.includedDevices ?? sub.tariff?.deviceLimit ?? 1;
  const newDevices = includedDevices + sub.extraDevices + deviceCount;

  const updated = await remnaUpdateUser({ uuid: sub.remnawaveUuid, hwidDeviceLimit: newDevices });
  if (updated.error) return { ok: false, newDeviceLimit: newDevices, error: updated.error };

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      extraDevices: { increment: deviceCount },
      extraDevicesMonthlyPrice: { increment: Math.max(0, monthlyPrice) },
    },
  });
  return { ok: true, newDeviceLimit: newDevices };
}
