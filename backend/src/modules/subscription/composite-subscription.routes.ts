import { Router } from "express";
import {
  remnaFetchSubscription,
  remnaGetUser,
  type RemnaSubscriptionFetchResult,
} from "../remna/remna.client.js";
import {
  detectSubscriptionClient,
  extractRemnaSubscriptionUrl,
  mergeSubscriptionBodies,
  mergeSubscriptionResponseHeaders,
  selectForwardHeaders,
} from "./composite-subscription.js";
import {
  getSubscriptionByPublicToken,
  resolveRemnawaveComponents,
  type ResolvedRemnawaveComponent,
} from "./subscription.helpers.js";

export const publicSubscriptionRouter = Router();

type FetchedComponent = {
  component: ResolvedRemnawaveComponent;
  result: RemnaSubscriptionFetchResult;
};

async function fetchComponent(
  component: ResolvedRemnawaveComponent,
  headers: Record<string, string>,
): Promise<FetchedComponent> {
  if (!component.remnawaveUuid) {
    return { component, result: { status: 404, error: "Remnawave component UUID is missing" } };
  }
  const user = await remnaGetUser(component.remnawaveUuid);
  if (user.error) {
    return { component, result: { status: user.status, error: user.error } };
  }
  const subscriptionUrl = extractRemnaSubscriptionUrl(user.data);
  if (!subscriptionUrl) {
    return { component, result: { status: 502, error: "Remnawave subscription URL is missing" } };
  }
  return { component, result: await remnaFetchSubscription(subscriptionUrl, headers) };
}

publicSubscriptionRouter.get("/:publicSubscriptionToken", async (req, res) => {
  const subscription = await getSubscriptionByPublicToken(req.params.publicSubscriptionToken);
  if (!subscription) return res.status(404).type("text/plain").send("Подписка не найдена");

  const components = resolveRemnawaveComponents(subscription);
  const main = components.find((component) => component.required) ?? components[0];
  if (!main) return res.status(404).type("text/plain").send("Подписка не настроена");

  const client = detectSubscriptionClient(req.get("user-agent") ?? "");
  const requestedComponents = client.mergeMode === "base64-json"
    ? [main, ...components.filter((component) => component.id !== main.id)]
    : [main];
  const forwardedHeaders = selectForwardHeaders(req.headers);
  const fetched = await Promise.all(
    requestedComponents.map((component) => fetchComponent(component, forwardedHeaders)),
  );
  const mainFetch = fetched.find(({ component }) => component.id === main.id);
  if (!mainFetch?.result.body) {
    console.error("[composite-subscription] main component unavailable", {
      subscriptionId: subscription.id,
      status: mainFetch?.result.status,
      error: mainFetch?.result.error,
    });
    return res.status(502).type("text/plain").send("Основная подписка временно недоступна");
  }

  const successful = fetched.filter((item): item is FetchedComponent & {
    result: RemnaSubscriptionFetchResult & { body: string; headers: Record<string, string> };
  } => typeof item.result.body === "string" && item.result.headers != null);
  successful.sort((a, b) => {
    if (a.component.id === main.id) return -1;
    if (b.component.id === main.id) return 1;
    return a.component.mergeOrder - b.component.mergeOrder;
  });
  const merged = mergeSubscriptionBodies(successful.map(({ component, result }) => ({
    key: component.key,
    body: result.body,
    contentType: result.headers["content-type"],
  })));
  const degradedKeys = [
    ...fetched.filter(({ result }) => typeof result.body !== "string").map(({ component }) => component.key),
    ...successful.filter(({ component }) => !merged.mergedKeys.includes(component.key)).map(({ component }) => component.key),
  ];

  const publicUrl = new URL(req.originalUrl, `${req.protocol}://${req.get("host")}`).toString();
  const responseHeaders = mergeSubscriptionResponseHeaders(
    successful.map(({ component, result }) => ({ key: component.key, headers: result.headers })),
    publicUrl,
    [...new Set(degradedKeys)],
  );
  for (const [name, value] of Object.entries(responseHeaders)) res.setHeader(name, value);
  res.setHeader("Content-Type", merged.contentType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "User-Agent, X-Hwid, X-Device-Os, X-Ver-Os, X-Device-Model");
  res.setHeader("X-Stealthnet-Client", client.name);
  res.setHeader("X-Stealthnet-Component-Count", String(merged.mergedKeys.length));
  return res.status(200).send(merged.body);
});
