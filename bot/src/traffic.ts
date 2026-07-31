type LocalTrafficQuota = { usedBytes: string; limitBytes: string } | null | undefined;

const GB = 1024 ** 3;

export function formatTrafficLine(input: {
  remoteUsedBytes: number;
  remoteLimitBytes: number;
  localQuota?: LocalTrafficQuota;
}): string {
  const used = input.localQuota ? Number(input.localQuota.usedBytes) : input.remoteUsedBytes;
  const limit = input.localQuota ? Number(input.localQuota.limitBytes) : input.remoteLimitBytes;
  const usedGb = (Number.isFinite(used) ? used / GB : 0).toFixed(2);
  if (!Number.isFinite(limit) || limit <= 0) return `📈 Трафик — ${usedGb} GB / ♾`;

  const percent = Math.min(100, Math.max(0, used / limit * 100));
  const filled = used > 0 ? Math.max(1, Math.ceil(percent / 10)) : 0;
  return `📈 Трафик — ${usedGb} / ${(limit / GB).toFixed(2)} GB\n${"█".repeat(filled)}${"░".repeat(10 - filled)} ${percent.toFixed(1)}%`;
}
