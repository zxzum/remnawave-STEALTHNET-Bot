export function changedTelegramUsername(
  current: string | null | undefined,
  received: string | null | undefined,
): string | null {
  const username = received?.trim();
  return username && username !== current ? username : null;
}
