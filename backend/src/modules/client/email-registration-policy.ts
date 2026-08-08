export const EMAIL_VERIFICATION_COOLDOWN_MS = 60_000;
export const EMAIL_VERIFICATION_IP_WINDOW_MS = 60 * 60_000;
export const EMAIL_VERIFICATION_IP_MAX = 5;

export function getEmailRegistrationRetryAfter(
  now: Date,
  lastEmailSentAt: Date | null,
  ipSendTimes: readonly Date[],
): number | null {
  const nowMs = now.getTime();
  const lastEmailSentMs = lastEmailSentAt?.getTime();
  let remainingMs = lastEmailSentMs != null && lastEmailSentMs <= nowMs
    ? lastEmailSentMs + EMAIL_VERIFICATION_COOLDOWN_MS - nowMs
    : 0;
  const inWindow = ipSendTimes
    .filter((sentAt) => {
      const sentAtMs = sentAt.getTime();
      return sentAtMs <= nowMs && nowMs - sentAtMs < EMAIL_VERIFICATION_IP_WINDOW_MS;
    })
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

export function getEmailRegistrationRateLimit(
  now: Date,
  lastEmailSentAt: Date | null,
  ipSendTimes: readonly Date[],
): { status: 429; retryAfter: number } | null {
  const retryAfter = getEmailRegistrationRetryAfter(now, lastEmailSentAt, ipSendTimes);
  return retryAfter === null ? null : { status: 429, retryAfter };
}
