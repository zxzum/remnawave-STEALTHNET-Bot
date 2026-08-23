export const SLOT_ACTIVATION_ELIGIBLE = "ELIGIBLE";
export const SLOT_ACTIVATION_LEGACY_BLOCKED = "LEGACY_BLOCKED";

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
