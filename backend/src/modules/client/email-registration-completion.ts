import { EMAIL_DELIVERY_STATE_SENT } from "./email-registration-delivery.js";

export type EmailRegistrationPending = {
  id: string;
  email: string;
  verificationToken: string;
  emailVerifiedAt: Date | null;
  revokedAt: Date | null;
  deliveryState: string;
  expiresAt: Date;
  preferredLang: string;
  preferredCurrency: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  registrationIp: string | null;
};

export type EmailRegistrationCompletionStore<TClient extends { id: string }> = {
  withEmailLock<T>(email: string, work: () => Promise<T>): Promise<T>;
  findPending(id: string): Promise<EmailRegistrationPending | null>;
  findClientByEmail(email: string): Promise<{ id: string } | null>;
  createClient(pending: EmailRegistrationPending, passwordHash: string): Promise<TClient>;
  deletePending(id: string): Promise<void>;
};

export type EmailRegistrationCompletionResult<TClient extends { id: string }> =
  | { kind: "invalid" }
  | { kind: "existing" }
  | { kind: "created"; client: TClient };

export function isClientEmailUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; meta?: { target?: unknown } };
  if (value.code !== "P2002") return false;
  if (!Array.isArray(value.meta?.target)) return true;
  return value.meta.target.some((target) => String(target).toLowerCase().includes("email"));
}

export async function completeEmailRegistration<TClient extends { id: string }>(
  store: EmailRegistrationCompletionStore<TClient>,
  input: {
    pendingId: string;
    email: string;
    verificationToken: string;
    passwordHash: string;
    now: Date;
  },
): Promise<EmailRegistrationCompletionResult<TClient>> {
  return store.withEmailLock(input.email, async () => {
    const pending = await store.findPending(input.pendingId);
    if (
      !pending
      || pending.email !== input.email
      || pending.verificationToken !== input.verificationToken
      || pending.emailVerifiedAt === null
      || pending.revokedAt !== null
      || pending.deliveryState !== EMAIL_DELIVERY_STATE_SENT
      || pending.expiresAt <= input.now
    ) {
      return { kind: "invalid" };
    }

    if (await store.findClientByEmail(pending.email)) return { kind: "existing" };

    const client = await store.createClient(pending, input.passwordHash);
    await store.deletePending(pending.id);
    return { kind: "created", client };
  });
}
