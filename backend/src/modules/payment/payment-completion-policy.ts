export const SLOT_ACTIVATION_ELIGIBLE = "ELIGIBLE";
export const SLOT_ACTIVATION_LEGACY_BLOCKED = "LEGACY_BLOCKED";

export function canonicalFiatAmount(value: string | number | undefined): string | null {
  if (typeof value === "string") return /^\d+\.\d{2}$/.test(value) ? value : null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const formatted = value.toFixed(2);
  return Number(formatted) === value ? formatted : null;
}

export function exactFiatAmountMatches(stored: number, incoming: string | number): boolean {
  const expected = canonicalFiatAmount(stored);
  return expected != null && canonicalFiatAmount(incoming) === expected;
}

export function canTransitionPaymentToPaid(status: string, allowFailedRecovery: boolean): boolean {
  return status === "PENDING" || (allowFailedRecovery && status === "FAILED");
}

export function decideSlotActivation(input: {
  linkedSlotCount: number;
  state: string | null;
}): "ALREADY_APPLIED" | "PROVISION" | "LEGACY_BLOCKED" {
  if (input.linkedSlotCount > 0) return "ALREADY_APPLIED";
  return input.state === SLOT_ACTIVATION_ELIGIBLE ? "PROVISION" : "LEGACY_BLOCKED";
}

const SHARED_TOP_UP_PROVIDERS = new Set([
  "yoomoney_form",
  "platega",
  "yookassa",
  "rollypay",
  "cryptopay",
  "heleket",
  "lava",
  "lavatop",
]);

export function isSharedTopUpPayment(payment: {
  provider?: string | null;
  tariffId?: string | null;
  proxyTariffId?: string | null;
  singboxTariffId?: string | null;
  hasExtraOption: boolean;
  isVpnProduct: boolean;
}): boolean {
  return SHARED_TOP_UP_PROVIDERS.has(payment.provider ?? "")
    && !payment.tariffId
    && !payment.proxyTariffId
    && !payment.singboxTariffId
    && !payment.hasExtraOption
    && !payment.isVpnProduct;
}
