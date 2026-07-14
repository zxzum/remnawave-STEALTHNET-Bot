import cron from "node-cron";
import { registerCron, wrapCronTick } from "../diagnostics/cron-registry.js";
import {
  processExpiredSubscriptionAccess,
  reconcileSubscriptionComponents,
} from "./subscription-components.service.js";

const NAME = "subscription-reconciliation";
const EXPRESSION = "*/5 * * * *";

export function startSubscriptionMaintenance() {
  const run = async () => ({
    expired: await processExpiredSubscriptionAccess(200),
    reconciliation: await reconcileSubscriptionComponents(50),
  });
  registerCron({
    name: NAME,
    cron: EXPRESSION,
    description: "Сверка и восстановление компонентов подписок Remnawave",
    trigger: run,
  });
  cron.schedule(EXPRESSION, wrapCronTick(NAME, run));
}
