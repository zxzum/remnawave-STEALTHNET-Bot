export const EMAIL_DELIVERY_STATE_SENDING = "SENDING" as const;
export const EMAIL_DELIVERY_STATE_SENT = "SENT" as const;

export function getEmailDeliveryTransition(delivered: boolean): {
  deliveryState: typeof EMAIL_DELIVERY_STATE_SENDING | typeof EMAIL_DELIVERY_STATE_SENT;
  revokeOlder: boolean;
} {
  return delivered
    ? { deliveryState: EMAIL_DELIVERY_STATE_SENT, revokeOlder: true }
    : { deliveryState: EMAIL_DELIVERY_STATE_SENDING, revokeOlder: false };
}

export type EmailRegistrationDeliveryStore = {
  withEmailLock<T>(email: string, work: () => Promise<T>): Promise<T>;
  findPendingState(id: string): Promise<{ deliveryState: string; revokedAt: Date | null } | null>;
  markSent(id: string): Promise<void>;
  revokeOlder(email: string, id: string, createdAt: Date, revokedAt: Date): Promise<void>;
};

export async function finalizeEmailRegistrationDelivery(
  store: EmailRegistrationDeliveryStore,
  input: {
    pendingId: string;
    email: string;
    createdAt: Date;
    delivered: boolean;
    now: Date;
  },
): Promise<"preserved" | "finalized"> {
  const transition = getEmailDeliveryTransition(input.delivered);
  if (!transition.revokeOlder) return "preserved";

  return store.withEmailLock(input.email, async () => {
    const current = await store.findPendingState(input.pendingId);
    if (!current || current.revokedAt) throw new Error("EMAIL_REGISTRATION_DELIVERY_STATE_LOST");
    if (current.deliveryState !== EMAIL_DELIVERY_STATE_SENT) await store.markSent(input.pendingId);
    await store.revokeOlder(input.email, input.pendingId, input.createdAt, input.now);
    return "finalized" as const;
  });
}
