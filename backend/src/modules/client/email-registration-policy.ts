export const EMAIL_VERIFICATION_COOLDOWN_MS = 60_000;
export const EMAIL_VERIFICATION_IP_WINDOW_MS = 60 * 60_000;
export const EMAIL_VERIFICATION_IP_MAX = 5;

export function getEmailRegistrationRetryAfter(
  now: Date,
  lastEmailSentAt: Date | null,
  ipSendTimes: readonly Date[],
): number | null {
  const nowMs = now.getTime();
  let remainingMs = lastEmailSentAt
    ? lastEmailSentAt.getTime() + EMAIL_VERIFICATION_COOLDOWN_MS - nowMs
    : 0;
  const inWindow = ipSendTimes
    .filter((sentAt) => nowMs - sentAt.getTime() < EMAIL_VERIFICATION_IP_WINDOW_MS)
    .sort((a, b) => a.getTime() - b.getTime());

  if (inWindow.length >= EMAIL_VERIFICATION_IP_MAX) {
    const oldestCountedSend = inWindow[inWindow.length - EMAIL_VERIFICATION_IP_MAX];
    remainingMs = Math.max(
      remainingMs,
      oldestCountedSend.getTime() + EMAIL_VERIFICATION_IP_WINDOW_MS - nowMs,
    );
  }

  return remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / 1000)) : null;
}
