import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("keeps the approved page transition", async () => {
  const layout = await readFile(new URL("./components/Layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /setDisplayedOutlet\(outlet\)/);
  assert.match(layout, /setIsLeaving\(true\)/);
  assert.match(layout, /duration: 0\.2/);
});

test("uses production cabinet routes and the real client logout", async () => {
  const layout = await readFile(new URL("./components/Layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /useClientAuth/);
  assert.match(layout, /await logout\(\)/);
  assert.match(layout, /navigate\("\/cabinet\/login"/);
  assert.match(layout, /to: "\/cabinet\/dashboard"/);
  assert.match(layout, /to: "\/cabinet\/subscribe"/);
  assert.match(layout, /to: "\/cabinet\/tariffs"/);
  assert.doesNotMatch(layout, /to: "\/cabinet\/referral"/);
  assert.match(layout, /to="\/cabinet\/profile"/);
});

test("provides cabinet state to public authentication screens", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(
    app,
    /<ClientAuthProvider>\s*<ClientAppProvider><Outlet \/><\/ClientAppProvider>\s*<\/ClientAuthProvider>/,
  );
  assert.equal(app.match(/<ClientAppProvider>/g)?.length, 1);
});

test("shows an initial skeleton and a retryable load error", async () => {
  const layout = await readFile(new URL("./components/Layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /loading \? <InitialSkeleton pathname=\{location\.pathname\}/);
  for (const page of ["dashboard", "subscribe", "tariffs", "profile", "referral"]) {
    assert.match(layout, new RegExp(`data-skeleton-page=["']${page}["']`));
  }
  assert.match(layout, /error \? <LoadError/);
  assert.match(layout, /onRetry=\{reload\}/);
});

test("Aurora reuses shared cabinet feedback services", async () => {
  const layout = await readFile(new URL("../pages/cabinet/aurora/aurora-layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /from "@\/cabinet\/components\/Layout"/);
  assert.match(layout, /from "@\/cabinet\/components\/ui\/Toasts"/);
  assert.match(layout, /from "@\/cabinet\/store\/AppContext"/);
  assert.match(layout, /loading \? <InitialSkeleton pathname=\{location\.pathname\}/);
  assert.match(layout, /error \? <LoadError message=\{error\} onRetry=\{reload\}/);
  assert.match(layout, /<Toasts \/>/);
});

test("isolates cabinet styles from admin while retaining portal styles", async () => {
  const main = await readFile(new URL("../main.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const indexCss = await readFile(new URL("../index.css", import.meta.url), "utf8");
  const layout = await readFile(new URL("./components/Layout.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("./pages/Auth.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../cabinet.css", import.meta.url), "utf8");
  assert.match(layout, /cabinet-ui-active/);
  assert.match(auth, /cabinet-ui-active/);
  assert.doesNotMatch(css, /@import\s+["']tailwindcss["']/);
  assert.doesNotMatch(css, /(^|\n)body\s*\{/);
  assert.match(css, /body\.cabinet-ui-active/);
  assert.match(indexCss, /--color-accent-500:\s*#8b5cf6/);
  assert.match(indexCss, /--shadow-neon-blue:/);
  assert.doesNotMatch(css, /@theme/);
  assert.ok(main.indexOf('import "./index.css"') < main.indexOf('import "./cabinet.css"'));
  assert.doesNotMatch(app, /import "@\/cabinet\.css"/);
  assert.match(css, /\[role="dialog"\]\[data-state="closed"\]/);
  assert.match(css, /cabinet-dialog-close 180ms/);
});

test("tariff and option payment dialogs share the same restrained motion shell", async () => {
  const tariffs = await readFile(new URL("./pages/Tariffs.tsx", import.meta.url), "utf8");
  const services = await readFile(new URL("./pages/Services.tsx", import.meta.url), "utf8");
  for (const source of [tariffs, services]) {
    assert.match(source, /initial=\{\{ opacity: 0, y: 60, scale: 0\.96 \}\}/);
    assert.match(source, /transition=\{\{ type: "spring", stiffness: 300, damping: 30 \}\}/);
    assert.match(source, /max-h-\[92dvh\]/);
  }
  assert.match(tariffs, /<PaymentMethods/);
  assert.match(services, /<PaymentMethods/);
});

test("contains no prototype mock imports", async () => {
  const files = ["Auth", "Cabinet", "Keys", "Tariffs", "Referrals", "Profile"];
  for (const file of files) {
    const source = await readFile(new URL(`./pages/${file}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /data\/mock/);
  }
  const store = await readFile(new URL("./store/AppContext.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(store, /data\/mock/);
});

test("does not cache the frontend or render a PWA update toast", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const vite = await readFile(new URL("../../vite.config.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /PwaUpdatePrompt/);
  assert.match(vite, /selfDestroying:\s*true/);
  assert.match(vite, /injectRegister:\s*false/);
  assert.doesNotMatch(vite, /registerType|workbox:/);
});

test("exports every production account flow in the approved cabinet runtime", async () => {
  const flows = await readFile(new URL("./pages/AccountFlows.tsx", import.meta.url), "utf8");
  for (const name of [
    "ForgotPassword",
    "ResetPassword",
    "VerifyEmail",
    "VerifyLinkEmail",
    "Onboarding",
    "PaymentWait",
    "YooMoneyPay",
  ]) {
    assert.match(flows, new RegExp(`export function ${name}`));
  }
});

test("uses one production Telegram-link action in dashboard and profile", async () => {
  const store = await readFile(new URL("./store/AppContext.tsx", import.meta.url), "utf8");
  const dashboard = await readFile(new URL("./pages/Cabinet.tsx", import.meta.url), "utf8");
  const profile = await readFile(new URL("./pages/Profile.tsx", import.meta.url), "utf8");
  assert.match(store, /linkTelegram: \(\) => Promise<void>/);
  assert.match(store, /api\.clientLinkTelegramRequest/);
  assert.match(store, /api\.clientLinkTelegram/);
  assert.match(dashboard, /linkTelegram/);
  assert.match(profile, /linkTelegram/);
});

test("refreshes the account after Telegram bot linking", async () => {
  const store = await readFile(new URL("./store/AppContext.tsx", import.meta.url), "utf8");
  assert.match(store, /const checkTelegramLink = async/);
  assert.match(store, /window\.addEventListener\("focus", checkTelegramLink\)/);
  assert.match(store, /document\.addEventListener\("visibilitychange", checkTelegramLink\)/);
  assert.match(store, /const linkedClient = await refreshProfile\(\)/);
  assert.match(store, /if \(linkedClient\?\.telegramId\)/);
});

test("authentication has no prototype timers or fake 2FA secret", async () => {
  const auth = await readFile(new URL("./pages/Auth.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(auth, /TOTP_KEY|FakeQr|Прототип/);
  assert.match(auth, /useClientAuth/);
  assert.match(auth, /api\.client2FASetup/);
  assert.match(auth, /api\.client2FAConfirm/);
  assert.match(auth, /api\.clientTelegramLoginToken/);
  assert.match(auth, /api\.clientTelegramLoginCheck/);
  assert.match(auth, /loginByGoogle/);
  assert.match(auth, /loginByApple/);
});

test("Mini App refreshes its account from Telegram even with a saved token", async () => {
  const auth = await readFile(new URL("../contexts/client-auth.tsx", import.meta.url), "utf8");
  assert.match(auth, /if \(miniappAttemptedRef\.current \|\| typeof window === "undefined"\) return;/);
  assert.doesNotMatch(auth, /if \(state\.token \|\| miniappAttemptedRef\.current/);
});

test("checkout preserves the approved Platega block and uses production payment APIs", async () => {
  const tariffs = await readFile(new URL("./pages/Tariffs.tsx", import.meta.url), "utf8");
  assert.match(tariffs, /Platega — основной способ, акцентный блок/);
  assert.match(tariffs, /api\.clientCheckPromoCode/);
  assert.match(tariffs, /api\.clientPayByBalance/);
  assert.match(tariffs, /api\.clientCreatePlategaPayment/);
  assert.match(tariffs, /api\.cryptopayCreatePayment/);
  assert.match(tariffs, /api\.clientTariffConversionPreview/);
  assert.match(tariffs, /removeExtrasOnActivate/);
  assert.match(tariffs, /replaceTrialSubId/);
  assert.doesNotMatch(tariffs, /SALE10|Здесь будет редирект|Прототип/);
});

test("eligible standalone trials use UUID-preserving extension checkout", async () => {
  const tariffs = await readFile(new URL("./pages/Tariffs.tsx", import.meta.url), "utf8");
  assert.match(tariffs, /trialExtensionId/);
  assert.match(tariffs, /extendsSecondarySubId: extensionId/);
  assert.match(tariffs, /replaceTrialSubId/);
});

test("Mini App exposes a direct trial activation entry", async () => {
  const cabinet = await readFile(new URL("./pages/Cabinet.tsx", import.meta.url), "utf8");
  const keys = await readFile(new URL("./pages/Keys.tsx", import.meta.url), "utf8");
  assert.match(cabinet, /to="\/cabinet\/dashboard\?trial=1"/);
  assert.match(keys, /to="\/cabinet\/dashboard\?trial=1"/);
  assert.match(cabinet, /<TrialsPickerDialog/);
});

test("profile top-up and payment history use production APIs", async () => {
  const profile = await readFile(new URL("./pages/Profile.tsx", import.meta.url), "utf8");
  const store = await readFile(new URL("./store/AppContext.tsx", import.meta.url), "utf8");
  assert.match(profile, /api\.clientCreatePlategaPayment/);
  assert.match(profile, /api\.cryptopayCreatePayment/);
  assert.match(profile, /resolvePaymentUrl/);
  assert.match(profile, /kind=topup/);
  assert.match(store, /api\.clientPayments/);
  assert.doesNotMatch(store, /const topUp = useCallback/);
});

test("profile security controls call the real account APIs", async () => {
  const profile = await readFile(new URL("./pages/Profile.tsx", import.meta.url), "utf8");
  for (const call of [
    "client2FASetup",
    "client2FAConfirm",
    "client2FADisable",
    "clientChangePassword",
    "clientSetPassword",
    "clientLinkEmailRequest",
    "clientLinkEmailDirect",
  ]) assert.match(profile, new RegExp(`api\\.${call}`));
  assert.doesNotMatch(profile, /Здесь будет форма изменения|title: "Прототип"/);
});

test("the client runtime is eager and does not bundle archived cabinet designs", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /from "@\/cabinet\/pages\/Auth"/);
  assert.match(app, /from "@\/cabinet\/components\/Layout"/);
  assert.doesNotMatch(app, /import\("@\/pages\/cabinet\/(?!aurora\/)/);
  assert.doesNotMatch(app, /ClientDashboardPage|ClientTariffsPage|CabinetLayout/);
  assert.doesNotMatch(app, /Загрузка кабинета…|animate-spin rounded-full border-2 border-primary border-t-transparent/);
});

test("admin settings no longer expose the archived design selector", async () => {
  const settings = await readFile(new URL("../pages/settings.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(settings, /Дизайн мини-аппа клиента|Cabinet design selector/);
});

test("optional client services use new cabinet screens and production APIs", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const services = await readFile(new URL("./pages/Services.tsx", import.meta.url), "utf8");
  for (const screen of ["CustomBuild", "ExtraOptions", "ProxyService", "SingboxService", "Gifts", "Tickets"]) {
    assert.match(app, new RegExp(`<${screen} \\/>`));
  }
  for (const call of [
    "customBuildPayBalance", "clientPayOptionByBalance", "getPublicProxyTariffs",
    "getPublicSingboxTariffs", "giftCreateCode", "giftRedeemCode", "getTickets",
    "createTicket", "replyTicket",
  ]) assert.match(services, new RegExp(`api\\.${call}`));
});

test("extra options keep payment methods behind one compact checkout action", async () => {
  const services = await readFile(new URL("./pages/Services.tsx", import.meta.url), "utf8");
  const tariffs = await readFile(new URL("./pages/Tariffs.tsx", import.meta.url), "utf8");
  const paymentMethods = await readFile(new URL("./components/PaymentMethods.tsx", import.meta.url), "utf8");
  assert.match(services, /function OptionPaymentDialog/);
  assert.match(services, /Перейти к оплате/);
  assert.doesNotMatch(services, /\(config\?\.plategaMethods \?\? \[\]\)\.map/);
  assert.match(services, /<PaymentMethods/);
  assert.match(tariffs, /<PaymentMethods/);
  assert.match(paymentMethods, /groupPlategaMethods/);
  assert.match(paymentMethods, /СБП/);
  assert.match(tariffs, /config\?\.sellOptions\?\.some/);
});

test("cabinet traffic top-up explains the selected subscription before purchase", async () => {
  const services = await readFile(new URL("./pages/Services.tsx", import.meta.url), "utf8");
  assert.match(services, /Для подписки/);
  assert.match(services, /Пакет добавится к текущему лимиту/);
  assert.match(services, /activeSubscriptions/);
  assert.match(services, /trafficOptionLabel/);
});

test("admin separates archived tariffs from the active catalog", async () => {
  const tariffs = await readFile(new URL("../pages/tariffs.tsx", import.meta.url), "utf8");
  assert.match(tariffs, /splitTariffsByArchive/);
  assert.match(tariffs, /Архив тарифов/);
  assert.match(tariffs, /archiveOpen/);
  assert.match(tariffs, /activeCategories/);
});

test("keys tolerate empty application configuration", async () => {
  const keys = await readFile(new URL("./pages/Keys.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(keys, /clientApps\[0\]\.steps/);
  assert.match(keys, /apps\.length === 0/);
});

test("subscription link renewal is clear and opens the regular website", async () => {
  const keys = await readFile(new URL("./pages/Keys.tsx", import.meta.url), "utf8");
  assert.match(keys, /whitespace-nowrap text-base leading-tight font-extrabold tracking-tight sm:text-lg/);
  assert.match(keys, />Ключ доступа</);
  assert.match(keys, />VPN-подписка</);
  assert.doesNotMatch(keys, /\{active\.protocol\}/);
  assert.match(keys, /const showEmailHint = Boolean\(state\.client && !state\.client\.email\?\.trim\(\)\)/);
  assert.match(keys, /Важно: выполняйте обновление только при подключённом Wi-Fi/);
  assert.match(keys, /сразу добавить подписку в Happ\/INCY/);
  assert.match(keys, /bot\.lazeika\.xyz\/cabinet/);
  assert.match(keys, /основная подписка будет остановлена/);
  assert.match(keys, /доступ к Telegram пропадёт/);
  assert.match(keys, /привяжите почту в «Профиль» → «Безопасность»/);
  assert.match(keys, /showEmailHint &&/);
  assert.match(keys, /max-h-\[calc\(100dvh-2rem\)\] .*overflow-y-auto/);
  assert.match(keys, /Обновить ссылку\s*<\/button>/);
  assert.match(keys, /initial=\{\{ opacity: 0, scale: 0\.94, y: 24 \}\}/);
  assert.match(keys, /text-sm leading-relaxed text-fog-300/);
  assert.match(keys, /href=\{siteUrl\}[^>]*>\s*<ExternalLink[^>]*\/> Открыть кабинет на сайте/);
});

test("new clients see a tariff action instead of empty dashboard and keys", async () => {
  const dashboard = await readFile(new URL("./pages/Cabinet.tsx", import.meta.url), "utf8");
  const keys = await readFile(new URL("./pages/Keys.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /Подписка ещё не выбрана/);
  assert.match(keys, /Ключа пока нет/);
  assert.match(keys, /to="\/cabinet\/tariffs"/);
});

test("payment polling stops after a terminal result", async () => {
  const flows = await readFile(new URL("./pages/AccountFlows.tsx", import.meta.url), "utf8");
  const paymentWait = flows.slice(flows.indexOf("export function PaymentWait"), flows.indexOf("type YooMoneyForm"));
  assert.doesNotMatch(paymentWait, /setInterval/);
  assert.match(paymentWait, /setTimeout\(check, 3000\)/);
});

test("mobile website keeps logout and Mini App uses Telegram external-link bridge", async () => {
  const layout = await readFile(new URL("./components/Layout.tsx", import.meta.url), "utf8");
  const keys = await readFile(new URL("./pages/Keys.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /!isMiniapp && <button/);
  assert.match(keys, /tg\.openLink\(bridgeUrl/);
  assert.match(keys, /api\/public\/deeplink\?url=/);
  assert.doesNotMatch(keys, /skip_auto=1/);
  assert.doesNotMatch(keys, /window\.location\.href = app\.deeplink/);
});

test("profile exposes logout at the bottom", async () => {
  const profile = await readFile(new URL("./pages/Profile.tsx", import.meta.url), "utf8");
  assert.match(profile, /!isMiniapp && <button/);
  assert.match(profile, /Выйти из аккаунта/);
  assert.match(profile, /await logout\(\)/);
});

test("profile preferences and referral withdrawal use production mutations", async () => {
  const profile = await readFile(new URL("./pages/Profile.tsx", import.meta.url), "utf8");
  const referrals = await readFile(new URL("./pages/Referrals.tsx", import.meta.url), "utf8");
  assert.match(profile, /api\.clientUpdateProfile/);
  assert.match(profile, /api\.yookassaUnlinkPaymentMethod/);
  assert.match(referrals, /api\.createWithdrawal/);
});

test("optional services are feature-gated and support chat remains mounted", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("./components/Layout.tsx", import.meta.url), "utf8");
  assert.match(app, /RequireClientFeature/);
  assert.doesNotMatch(layout, /resolveOptionalNav|Ещё/);
  assert.match(layout, /<FloatingChat \/>/);
});

test("ticket messages distinguish client and support authors", async () => {
  const services = await readFile(new URL("./pages/Services.tsx", import.meta.url), "utf8");
  assert.match(services, /item\.authorType\.toLowerCase\(\) === "client"/);
  assert.match(services, /Поддержка/);
  assert.match(services, /selected\.status\.toLowerCase\(\) !== "closed"/);
});

test("logs out the browser cabinet after the client account is deleted", async () => {
  const middleware = await readFile(new URL("../../../backend/src/modules/client/client.middleware.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../lib/api.ts", import.meta.url), "utf8");
  const auth = await readFile(new URL("../contexts/client-auth.tsx", import.meta.url), "utf8");
  const login = await readFile(new URL("./pages/Auth.tsx", import.meta.url), "utf8");

  assert.match(middleware, /code:\s*["']CLIENT_DELETED["']/);
  assert.match(api, /export function setClientSessionLostFn/);
  assert.match(api, /clientSessionLostFn\?\./);
  assert.match(api, /account-deleted/);
  assert.match(auth, /inTelegram/);
  assert.match(auth, /window\.location\.replace\([^)]*reason=\$\{reason\}/);
  assert.match(auth, /logout\(\)/);
  assert.match(login, /account-deleted/);
  assert.match(login, /Аккаунт удалён/);
});

test("registration verifies email before account creation", async () => {
  const auth = await readFile(new URL("./pages/Auth.tsx", import.meta.url), "utf8");
  const flows = await readFile(new URL("./pages/AccountFlows.tsx", import.meta.url), "utf8");
  const context = await readFile(new URL("../contexts/client-auth.tsx", import.meta.url), "utf8");
  assert.match(auth, /skipEmailVerification/);
  assert.match(auth, /completeRegistration/);
  assert.match(auth, /registrationToken/);
  assert.match(flows, /cabinet\/register\?registrationToken=/);
  assert.match(context, /completeRegistration/);
});

test("registration success modal recommends Telegram settings", async () => {
  const cabinet = await readFile(new URL("./pages/Cabinet.tsx", import.meta.url), "utf8");
  assert.match(cabinet, /registration=success/);
  assert.match(cabinet, /Аккаунт успешно создан/);
  assert.match(cabinet, /настройк/);
});

test("registration waits for public config before choosing email flow", async () => {
  const auth = await readFile(new URL("./pages/Auth.tsx", import.meta.url), "utf8");
  assert.match(auth, /if \(!config\) return;/);
  assert.match(auth, /disabled=\{!config \|\| !emailValid/);
});

test("registration resend locks submitted email and shows backend errors", async () => {
  const auth = await readFile(new URL("./pages/Auth.tsx", import.meta.url), "utf8");
  assert.match(auth, /submittedEmail/);
  assert.match(auth, /disabled=\{sent \|\| loading\}/);
  assert.match(auth, /на \{submittedEmail\}/);
  assert.match(auth, /error && step === "email"/);
});

test("password registration cannot submit while a request is loading", async () => {
  const auth = await readFile(new URL("./pages/Auth.tsx", import.meta.url), "utf8");
  const passwordStep = auth.slice(auth.indexOf('{step === "password"'), auth.indexOf('{step === "twofa"'));
  assert.match(passwordStep, /disabled=\{pw1\.length < 8 \|\| pw1 !== pw2 \|\| loading\}/);
});

test("refreshes the client profile on cabinet load and tab return", async () => {
  const store = await readFile(new URL("./store/AppContext.tsx", import.meta.url), "utf8");
  assert.match(store, /void Promise\.all\(\[reload\(\), refreshProfile\(\)\]\)/);
  assert.match(store, /const refreshOnReturn = \(\) =>/);
  assert.match(store, /window\.addEventListener\("focus", refreshOnReturn\)/);
  assert.match(store, /window\.addEventListener\("pageshow", refreshOnReturn\)/);
  assert.match(store, /document\.addEventListener\("visibilitychange", refreshOnReturn\)/);
  assert.match(store, /window\.removeEventListener\("focus", refreshOnReturn\)/);
  assert.match(store, /document\.removeEventListener\("visibilitychange", refreshOnReturn\)/);
});
