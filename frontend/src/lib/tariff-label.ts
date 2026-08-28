export function formatTariffOptionLabel(tariff: { name: string; archivedAt?: string | null }): string {
  return `${tariff.name}${tariff.archivedAt ? " (архив)" : ""}`;
}

export function splitTariffsByArchive<T extends { archivedAt?: string | null }>(tariffs: T[]) {
  return {
    active: tariffs.filter((tariff) => !tariff.archivedAt),
    archived: tariffs.filter((tariff) => Boolean(tariff.archivedAt)),
  };
}
