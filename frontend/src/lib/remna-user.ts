export function getRemnaUserIdentifier(
  user: { uuid?: string; id?: string | number },
  fallback: string,
): string {
  return user.uuid || String(user.id ?? fallback);
}
