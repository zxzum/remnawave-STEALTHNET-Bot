export function formatTariffOptionLabel(tariff: { name: string; archivedAt?: string | null }): string {
  return `${tariff.name}${tariff.archivedAt ? " (архив)" : ""}`;
}
