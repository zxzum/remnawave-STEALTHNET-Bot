type TrafficPolicy = {
  trafficLimitBytes: bigint | null;
  trafficLimitMode?: "REMNAWAVE" | "LOCAL_SQUAD" | null;
  trafficResetMode?: string | null;
};

export function remnaTrafficSettings(tariff: TrafficPolicy) {
  return {
    trafficLimitBytes: tariff.trafficLimitBytes == null ? 0 : Number(tariff.trafficLimitBytes),
    trafficLimitStrategy: tariff.trafficResetMode === "monthly"
      ? "MONTH"
      : tariff.trafficResetMode === "monthly_rolling" ? "MONTH_ROLLING" : "NO_RESET",
  };
}
