/**
 * Создание прокси-слотов по успешной оплате (proxyTariffId).
 * Вызывается из: webhook YooMoney/YooKassa/Platega, admin mark-as-paid.
 */

import { randomBytes } from "crypto";
import { prisma } from "../../db.js";

export type CreateProxySlotsResult =
  | { ok: true; slotsCreated: number; slotIds: string[]; alreadyApplied?: boolean }
  | { ok: false; error: string; status: number };

function generateLogin(): string {
  const raw = randomBytes(16).toString("base64url");
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) || `u${Date.now().toString(36)}`;
}

function generatePassword(): string {
  return randomBytes(16).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || String(Date.now());
}

/**
 * Выбирает ONLINE ноды, исключая DISABLED. Распределяет слоты round-robin.
 */
export async function createProxySlotsByPaymentId(paymentId: string): Promise<CreateProxySlotsResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE', paymentId);
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { proxyTariffId: true, clientId: true },
      });
      if (!payment?.proxyTariffId) {
        return { ok: false, error: "Прокси-тариф не привязан к платежу", status: 400 };
      }

      const existing = await tx.proxySlot.findMany({
        where: { paymentId },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (existing.length > 0) {
        return { ok: true, slotsCreated: existing.length, slotIds: existing.map((slot) => slot.id), alreadyApplied: true };
      }

      const tariff = await tx.proxyTariff.findUnique({ where: { id: payment.proxyTariffId } });
      if (!tariff || !tariff.enabled) {
        return { ok: false, error: "Прокси-тариф не найден или отключён", status: 404 };
      }

      const client = await tx.client.findUnique({ where: { id: payment.clientId }, select: { id: true } });
      if (!client) {
        return { ok: false, error: "Клиент не найден", status: 404 };
      }

      const assignedNodeIds = await tx.proxyTariffNode.findMany({
        where: { tariffId: tariff.id },
        select: { nodeId: true },
      }).then((rows) => rows.map((row) => row.nodeId));

      const nodeWhere = assignedNodeIds.length > 0
        ? { id: { in: assignedNodeIds }, status: "ONLINE" }
        : { status: "ONLINE" };
      const nodes = await tx.proxyNode.findMany({
        where: nodeWhere,
        select: { id: true, capacity: true },
        orderBy: { updatedAt: "asc" },
      });
      if (nodes.length === 0) {
        return { ok: false, error: "Нет доступных прокси-нод. Попробуйте позже.", status: 503 };
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + tariff.durationDays * 24 * 60 * 60 * 1000);
      const slotsToCreate = tariff.proxyCount;
      const slots: { nodeId: string; login: string; password: string }[] = [];
      const nodeSlots = new Map<string, number>();
      for (const node of nodes) nodeSlots.set(node.id, 0);

      let nodeIndex = 0;
      for (let i = 0; i < slotsToCreate; i++) {
        const node = nodes[nodeIndex % nodes.length]!;
        const used = nodeSlots.get(node.id) ?? 0;
        if (node.capacity != null && used >= node.capacity) {
          const next = nodes.find((candidate) => (nodeSlots.get(candidate.id) ?? 0) < (candidate.capacity ?? Infinity));
          if (!next) break;
          nodeIndex = nodes.indexOf(next);
        }
        slots.push({ nodeId: node.id, login: generateLogin(), password: generatePassword() });
        nodeSlots.set(node.id, (nodeSlots.get(node.id) ?? 0) + 1);
        nodeIndex++;
      }

      if (slots.length === 0) {
        return { ok: false, error: "Нет свободных мест на нодах", status: 503 };
      }

      const created = [];
      for (const slot of slots) {
        created.push(await tx.proxySlot.create({
          data: {
            nodeId: slot.nodeId,
            clientId: client.id,
            proxyTariffId: tariff.id,
            paymentId,
            login: slot.login,
            password: slot.password,
            expiresAt,
            trafficLimitBytes: tariff.trafficLimitBytes,
            connectionLimit: tariff.connectionLimit,
            status: "ACTIVE",
          },
        }));
      }
      return { ok: true, slotsCreated: created.length, slotIds: created.map((slot) => slot.id) };
    });
  } catch (error) {
    console.error(`[proxy-slots] failed for payment ${paymentId}:`, error);
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось создать прокси-слоты", status: 503 };
  }
}
