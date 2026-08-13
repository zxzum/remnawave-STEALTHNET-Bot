type SendUsername = (telegramId: number, username: string) => Promise<unknown>;

export function createTelegramUsernameSync(send: SendUsername) {
  const seen = new Map<number, string>();
  return async (telegramId: number, username?: string): Promise<void> => {
    const value = username?.trim();
    if (!value || seen.get(telegramId) === value) return;
    seen.set(telegramId, value);
    try {
      await send(telegramId, value);
    } catch (error) {
      if (seen.get(telegramId) === value) seen.delete(telegramId);
      throw error;
    }
  };
}
