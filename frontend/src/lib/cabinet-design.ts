export type CabinetDesign = "default" | "aurora";

export function resolveCabinetDesign(value: unknown): CabinetDesign {
  return value === "aurora" ? "aurora" : "default";
}
