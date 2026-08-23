/**
 * Создание sing-box слотов по успешной оплате (singboxTariffId).
 * Вызывается из: webhook YooMoney/YooKassa/Platega, оплата балансом, admin mark-as-paid.
 */

import { randomBytes } from "crypto";
import { randomUUID } from "crypto";
import { prisma } from "../../db.js";

export type CreateSingboxSlotsResult =
  | { ok: true; slotsCreated: number; slotIds: string[]; alreadyApplied?: boolean }
  | { ok: false; error: string; status: number };

function generatePassword(): string {
  return randomBytes(16).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) || String(Date.now());
}

/**
 * Выбирает ONLINE ноды (SingboxNode), распределяет слоты round-robin.
 * userIdentifier: UUID для VLESS/Trojan, иначе случайный логин; secret: пароль для SS/Hy2/Trojan.
 */
export async function createSingboxSlotsByPaymentId(paymentId: string): Promise<CreateSingboxSlotsResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE', paymentId);
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { singboxTariffId: true, clientId: true },
      });
      if (!payment?.singboxTariffId) {
        return { ok: false, error: "Sing-box тариф не привязан к платежу", status: 400 };
      }

      const existing = await tx.singboxSlot.findMany({
        where: { paymentId },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (existing.length > 0) {
        return { ok: true, slotsCreated: existing.length, slotIds: existing.map((slot) => slot.id), alreadyApplied: true };
      }

      const tariff = await tx.singboxTariff.findUnique({ where: { id: payment.singboxTariffId } });
      if (!tariff || !tariff.enabled) {
        return { ok: false, error: "Тариф Sing-box не найден или отключён", status: 404 };
      }

      const client = await tx.client.findUnique({ where: { id: payment.clientId }, select: { id: true } });
      if (!client) {
        return { ok: false, error: "Клиент не найден", status: 404 };
      }

      const nodes = await tx.singboxNode.findMany({
        where: { status: "ONLINE" },
        select: { id: true, protocol: true, capacity: true },
        orderBy: { updatedAt: "asc" },
      });
      if (nodes.length === 0) {
        return { ok: false, error: "Нет доступных Sing-box нод. Попробуйте позже.", status: 503 };
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + tariff.durationDays * 24 * 60 * 60 * 1000);
      const slotsToCreate = tariff.slotCount;
      const slots: { nodeId: string; userIdentifier: string; secret: string | null }[] = [];
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
        const protocol = (node.protocol || "VLESS").toUpperCase();
        const userIdentifier = protocol === "VLESS" || protocol === "TROJAN"
          ? randomUUID()
          : `u${randomBytes(8).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
        slots.push({ nodeId: node.id, userIdentifier, secret: protocol === "VLESS" ? null : generatePassword() });
        nodeSlots.set(node.id, (nodeSlots.get(node.id) ?? 0) + 1);
        nodeIndex++;
      }

      if (slots.length === 0) {
        return { ok: false, error: "Нет свободных мест на нодах", status: 503 };
      }

      const created = [];
      for (const slot of slots) {
        created.push(await tx.singboxSlot.create({
          data: {
            nodeId: slot.nodeId,
            clientId: client.id,
            singboxTariffId: tariff.id,
            paymentId,
            userIdentifier: slot.userIdentifier,
            secret: slot.secret,
            expiresAt,
            trafficLimitBytes: tariff.trafficLimitBytes,
            status: "ACTIVE",
          },
        }));
      }
      return { ok: true, slotsCreated: created.length, slotIds: created.map((slot) => slot.id) };
    });
  } catch (error) {
    console.error(`[singbox-slots] failed for payment ${paymentId}:`, error);
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось создать Sing-box слоты", status: 503 };
  }
}
