export type TrialSquadOption = { uuid: string; name?: string };

export function parseInternalSquadsResponse(value: unknown): TrialSquadOption[] {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const response = root?.response && typeof root.response === "object"
    ? root.response as Record<string, unknown>
    : null;
  const items = Array.isArray(response?.internalSquads)
    ? response.internalSquads
    : Array.isArray(root?.internalSquads) ? root.internalSquads : Array.isArray(value) ? value : [];
  const seen = new Set<string>();

  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const uuid = typeof record.uuid === "string" ? record.uuid.trim() : "";
    if (!uuid || seen.has(uuid)) return [];
    seen.add(uuid);
    const name = typeof record.name === "string" ? record.name.trim() : "";
    return [name ? { uuid, name } : { uuid }];
  });
}

export function toggleSquadUuid(selected: string[], uuid: string): string[] {
  const normalizedUuid = uuid.trim();
  if (!normalizedUuid) return selected;
  return selected.includes(normalizedUuid)
    ? selected.filter((item) => item !== normalizedUuid)
    : [...selected, normalizedUuid];
}

export function isMeteredSquadAllowed(selected: string[], uuid: string): boolean {
  return Boolean(uuid) && selected.includes(uuid);
}
