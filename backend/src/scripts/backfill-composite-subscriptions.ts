import { prisma } from "../db.js";
import { isRemnaConfigured } from "../modules/remna/remna.client.js";
import { synchronizeSubscriptionComponents } from "../modules/subscription/subscription-components.service.js";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const dryRun = process.argv.includes("--dry-run");
const requestedLimit = Number(arg("limit") ?? 100);
const limit = Number.isFinite(requestedLimit)
  ? Math.max(1, Math.min(10_000, Math.trunc(requestedLimit)))
  : 100;
const tariffId = arg("tariff-id");

async function main() {
  if (!dryRun && !isRemnaConfigured()) {
    throw new Error("Remnawave не настроен. Для просмотра используйте --dry-run");
  }

  const subscriptions = await prisma.subscription.findMany({
    where: {
      deletionRequestedAt: null,
      ...(tariffId ? { tariffId } : {}),
      OR: [{ remnawaveUuid: { not: null } }, { components: { some: {} } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      subscriptionIndex: true,
      publicSubscriptionToken: true,
      tariff: {
        select: {
          name: true,
          remnawaveComponents: { where: { enabled: true }, orderBy: { mergeOrder: "asc" }, select: { key: true } },
        },
      },
      trial: {
        select: {
          name: true,
          remnawaveComponents: { where: { enabled: true }, orderBy: { mergeOrder: "asc" }, select: { key: true } },
        },
      },
      components: { select: { key: true, remnawaveUuid: true } },
    },
  });

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    const templates = subscription.trial?.remnawaveComponents.length
      ? subscription.trial.remnawaveComponents
      : subscription.tariff?.remnawaveComponents ?? [];
    const desiredKeys = templates.length ? templates.map((component) => component.key) : ["primary"];
    const present = new Map(subscription.components.map((component) => [component.key, component.remnawaveUuid]));
    const missing = desiredKeys.filter((key) => !present.get(key));
    const label = `${subscription.id} #${subscription.subscriptionIndex} (${subscription.tariff?.name ?? subscription.trial?.name ?? "legacy"})`;

    if (dryRun) {
      console.log(`[dry-run] ${label}: ${missing.length ? `создать ${missing.join(", ")}` : "уже синхронизировано"}`);
      missing.length ? migrated++ : skipped++;
      continue;
    }

    const result = await synchronizeSubscriptionComponents(subscription.id);
    const verified = await prisma.subscription.findUnique({
      where: { id: subscription.id },
      select: {
        publicSubscriptionToken: true,
        components: { where: { key: { in: desiredKeys } }, select: { key: true, remnawaveUuid: true } },
      },
    });
    const linked = new Map(verified?.components.map((component) => [component.key, component.remnawaveUuid]) ?? []);
    const verificationErrors = desiredKeys.filter((key) => !linked.get(key));
    if (result.requiredFailure || !verified?.publicSubscriptionToken || verificationErrors.length) {
      failed++;
      console.error(`[error] ${label}: ${[
        ...result.failures.map((failure) => `${failure.key}: ${failure.error}`),
        ...(verificationErrors.length ? [`нет UUID: ${verificationErrors.join(", ")}`] : []),
        ...(!verified?.publicSubscriptionToken ? ["нет publicSubscriptionToken"] : []),
      ].join("; ")}`);
    } else {
      migrated++;
      console.log(`[ok] ${label}${result.failures.length ? " (дополнительный компонент ожидает retry)" : ""}`);
    }
  }

  console.log(JSON.stringify({ dryRun, checked: subscriptions.length, migrated, skipped, failed }, null, 2));
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
