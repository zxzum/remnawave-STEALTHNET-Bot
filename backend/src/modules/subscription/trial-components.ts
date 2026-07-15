export function copyTrialComponents<T extends { internalSquadUuids: string[] }>(components: readonly T[]): T[] {
  return components.map((component) => ({
    ...component,
    internalSquadUuids: [...component.internalSquadUuids],
  }));
}
