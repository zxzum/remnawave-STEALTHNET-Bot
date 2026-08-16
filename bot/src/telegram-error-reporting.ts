import { HttpError } from "grammy";

export function isRetryingGetUpdatesError(method: string, error: unknown): boolean {
  return method === "getUpdates" && error instanceof HttpError;
}
