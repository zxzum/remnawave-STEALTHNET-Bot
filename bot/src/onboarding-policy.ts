export function shouldShowBotWelcome(input: {
  enabled: boolean;
  showOnce: boolean;
  onboardingCompleted: boolean;
  trialUsed: boolean;
}): boolean {
  if (!input.enabled || input.trialUsed) return false;
  return !input.showOnce || !input.onboardingCompleted;
}
