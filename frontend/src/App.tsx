import { Component, lazy as reactLazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";

const routerFutureFlags = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};
import { AuthProvider, useAuth } from "@/contexts/auth";
import { ClientAuthProvider, useClientAuth } from "@/contexts/client-auth";
import { ThemeProvider } from "@/contexts/theme";
import { AnimatedBackground } from "@/components/animated-background";
import { api } from "@/lib/api";
import type { PublicConfig } from "@/lib/api";
import { Toaster } from "@/components/ui/toast";
import { Login as CabinetLogin, Register as CabinetRegister } from "@/cabinet/pages/Auth";
import { ForgotPassword, ResetPassword, VerifyEmail, VerifyLinkEmail, Onboarding, PaymentWait, YooMoneyPay } from "@/cabinet/pages/AccountFlows";
import CabinetDashboard from "@/cabinet/pages/Cabinet";
import CabinetKeys from "@/cabinet/pages/Keys";
import CabinetTariffs from "@/cabinet/pages/Tariffs";
import CabinetReferrals from "@/cabinet/pages/Referrals";
import CabinetProfile from "@/cabinet/pages/Profile";
import { CustomBuild, ExtraOptions, Gifts, ProxyService, SingboxService, Tickets } from "@/cabinet/pages/Services";
import { Layout as ClientLayout } from "@/cabinet/components/Layout";
import { AppProvider as ClientAppProvider, useApp as useClientApp } from "@/cabinet/store/AppContext";

const lazyRouteRetryKey = "__stealthnet_lazy_route_retry__";

function shouldRetryLazyRoute() {
  if (typeof window === "undefined") return false;

  try {
    const lastAttempt = Number(window.sessionStorage.getItem(lazyRouteRetryKey) ?? 0);
    if (Date.now() - lastAttempt < 60_000) return false;
    window.sessionStorage.setItem(lazyRouteRetryKey, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

function lazy<T extends React.ComponentType<any>>(loader: () => Promise<{ default: T }>) {
  return reactLazy(async () => {
    try {
      return await Promise.race([
        loader(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Загрузка раздела превысила 15 секунд")), 15_000)),
      ]);
    } catch (error) {
      // ponytail: one reload per minute prevents an infinite loop on a persistently broken chunk.
      if (shouldRetryLazyRoute()) {
        window.location.reload();
      }
      throw error;
    }
  });
}

class LazyRouteErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error("Не удалось загрузить раздел") };
  }

  componentDidCatch(error: Error) {
    console.error("[admin] lazy route failed", error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-48 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>Не удалось загрузить раздел.</p>
        <button
          type="button"
          className="rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5"
          onClick={() => window.location.reload()}
        >
          Повторить
        </button>
      </div>
    );
  }
}

const LoginPage = lazy(() => import("@/pages/login").then(({ LoginPage }) => ({ default: LoginPage })));
const ChangePasswordPage = lazy(() => import("@/pages/change-password").then(({ ChangePasswordPage }) => ({ default: ChangePasswordPage })));
const DashboardPage = lazy(() => import("@/pages/dashboard").then(({ DashboardPage }) => ({ default: DashboardPage })));
const ClientsPage = lazy(() => import("@/pages/clients").then(({ ClientsPage }) => ({ default: ClientsPage })));
const PaymentsPage = lazy(() => import("@/pages/payments").then(({ PaymentsPage }) => ({ default: PaymentsPage })));
const TariffsPage = lazy(() => import("@/pages/tariffs").then(({ TariffsPage }) => ({ default: TariffsPage })));
const TrialsPage = lazy(() => import("@/pages/trials").then(({ TrialsPage }) => ({ default: TrialsPage })));
const WithdrawalsPage = lazy(() => import("@/pages/withdrawals").then(({ WithdrawalsPage }) => ({ default: WithdrawalsPage })));
const AutoRenewPage = lazy(() => import("@/pages/auto-renew").then(({ AutoRenewPage }) => ({ default: AutoRenewPage })));
const SettingsPage = lazy(() => import("@/pages/settings").then(({ SettingsPage }) => ({ default: SettingsPage })));
const LandingEditorPage = lazy(() => import("@/pages/landing-editor").then(({ LandingEditorPage }) => ({ default: LandingEditorPage })));
const LandingPreviewPage = lazy(() => import("@/pages/landing-preview").then(({ LandingPreviewPage }) => ({ default: LandingPreviewPage })));
const AdminAuditPage = lazy(() => import("@/pages/admin-audit").then(({ AdminAuditPage }) => ({ default: AdminAuditPage })));
const AdminWebhookInboxPage = lazy(() => import("@/pages/admin-webhook-inbox").then(({ AdminWebhookInboxPage }) => ({ default: AdminWebhookInboxPage })));
const AdminDiagnosticsPage = lazy(() => import("@/pages/admin-diagnostics").then(({ AdminDiagnosticsPage }) => ({ default: AdminDiagnosticsPage })));
const AdminBusinessAnalyticsPage = lazy(() => import("@/pages/admin-business-analytics").then(({ AdminBusinessAnalyticsPage }) => ({ default: AdminBusinessAnalyticsPage })));
const AdminAntiFraudPage = lazy(() => import("@/pages/admin-anti-fraud").then(({ AdminAntiFraudPage }) => ({ default: AdminAntiFraudPage })));
const AdminEmailTemplatesPage = lazy(() => import("@/pages/admin-email-templates").then(({ AdminEmailTemplatesPage }) => ({ default: AdminEmailTemplatesPage })));
const AdminBotMessagesPage = lazy(() => import("@/pages/admin-bot-messages").then(({ AdminBotMessagesPage }) => ({ default: AdminBotMessagesPage })));
const AdminBotConversationsPage = lazy(() => import("@/pages/admin-bot-conversations").then(({ AdminBotConversationsPage }) => ({ default: AdminBotConversationsPage })));
const CmdKPalette = lazy(() => import("@/components/cmd-k-palette").then(({ CmdKPalette }) => ({ default: CmdKPalette })));
const PromoPage = lazy(() => import("@/pages/promo").then(({ PromoPage }) => ({ default: PromoPage })));
const PromoCodesPage = lazy(() => import("@/pages/promo-codes").then(({ PromoCodesPage }) => ({ default: PromoCodesPage })));
const RemnaNodesPage = lazy(() => import("@/pages/remna-nodes").then(({ RemnaNodesPage }) => ({ default: RemnaNodesPage })));
const RemnaSquadsPage = lazy(() => import("@/pages/remna-squads").then(({ RemnaSquadsPage }) => ({ default: RemnaSquadsPage })));
const RemnaHostsPage = lazy(() => import("@/pages/remna-hosts").then(({ RemnaHostsPage }) => ({ default: RemnaHostsPage })));
const RemnaProfilesPage = lazy(() => import("@/pages/remna-profiles").then(({ RemnaProfilesPage }) => ({ default: RemnaProfilesPage })));
const RemnaSubTemplatesPage = lazy(() => import("@/pages/remna-sub-templates").then(({ RemnaSubTemplatesPage }) => ({ default: RemnaSubTemplatesPage })));
const AnalyticsPage = lazy(() => import("@/pages/analytics").then(({ AnalyticsPage }) => ({ default: AnalyticsPage })));
const MarketingPage = lazy(() => import("@/pages/marketing").then(({ MarketingPage }) => ({ default: MarketingPage })));
const AdminsPage = lazy(() => import("@/pages/admins").then(({ AdminsPage }) => ({ default: AdminsPage })));
const SalesReportPage = lazy(() => import("@/pages/sales-report").then(({ SalesReportPage }) => ({ default: SalesReportPage })));
const BalanceSalesPage = lazy(() => import("@/pages/balance-sales").then(({ BalanceSalesPage }) => ({ default: BalanceSalesPage })));
const VideoInstructionsPage = lazy(() => import("@/pages/video-instructions").then(({ VideoInstructionsPage }) => ({ default: VideoInstructionsPage })));
const BackupPage = lazy(() => import("@/pages/backup").then(({ BackupPage }) => ({ default: BackupPage })));
const ContestsPage = lazy(() => import("@/pages/contests").then(({ ContestsPage }) => ({ default: ContestsPage })));
const AdminTicketsPage = lazy(() => import("@/pages/admin-tickets").then(({ AdminTicketsPage }) => ({ default: AdminTicketsPage })));
const BroadcastPage = lazy(() => import("@/pages/broadcast").then(({ BroadcastPage }) => ({ default: BroadcastPage })));
const AutoBroadcastPage = lazy(() => import("@/pages/auto-broadcast").then(({ AutoBroadcastPage }) => ({ default: AutoBroadcastPage })));
const ReferralNetworkPage = lazy(() => import("@/pages/referral-network").then(({ ReferralNetworkPage }) => ({ default: ReferralNetworkPage })));
const AdminReferralsPage = lazy(() => import("@/pages/admin-referrals").then(({ AdminReferralsPage }) => ({ default: AdminReferralsPage })));
const PartnersPage = lazy(() => import("@/pages/partners").then(({ PartnersPage }) => ({ default: PartnersPage })));
const GramadsPromoPage = lazy(() => import("@/pages/gramads-promo").then(({ GramadsPromoPage }) => ({ default: GramadsPromoPage })));
const TrafficAbusePage = lazy(() => import("@/pages/traffic-abuse").then(({ TrafficAbusePage }) => ({ default: TrafficAbusePage })));
const ApiKeysPage = lazy(() => import("@/pages/api-keys").then(({ ApiKeysPage }) => ({ default: ApiKeysPage })));
const AntibotPage = lazy(() => import("@/pages/antibot").then(({ AntibotPage }) => ({ default: AntibotPage })));
const ApiDocsPage = lazy(() => import("@/pages/api-docs").then(({ ApiDocsPage }) => ({ default: ApiDocsPage })));
const GeoMapPage = lazy(() => import("@/pages/geo-map").then(({ GeoMapPage }) => ({ default: GeoMapPage })));
const AdminSecondarySubscriptionsPage = lazy(() => import("@/pages/admin-secondary-subscriptions").then(({ AdminSecondarySubscriptionsPage }) => ({ default: AdminSecondarySubscriptionsPage })));
const ProxyPage = lazy(() => import("@/pages/proxy").then(({ ProxyPage }) => ({ default: ProxyPage })));
const SingboxPage = lazy(() => import("@/pages/singbox").then(({ SingboxPage }) => ({ default: SingboxPage })));
const LanguagesPage = lazy(() => import("@/pages/languages"));
const TourConstructorPage = lazy(() => import("@/pages/tour-constructor").then(({ TourConstructorPage }) => ({ default: TourConstructorPage })));
const MarketplaceLayout = lazy(() => import("@/pages/marketplace/marketplace-layout").then(({ MarketplaceLayout }) => ({ default: MarketplaceLayout })));
const MarketplaceBrowsePage = lazy(() => import("@/pages/marketplace/marketplace-browse").then(({ MarketplaceBrowsePage }) => ({ default: MarketplaceBrowsePage })));
const MarketplaceMyListingsPage = lazy(() => import("@/pages/marketplace/marketplace-my").then(({ MarketplaceMyListingsPage }) => ({ default: MarketplaceMyListingsPage })));
const MarketplaceEditListingPage = lazy(() => import("@/pages/marketplace/marketplace-edit").then(({ MarketplaceEditListingPage }) => ({ default: MarketplaceEditListingPage })));
const MarketplaceHubInstallationsPage = lazy(() => import("@/pages/marketplace/marketplace-hub-installations").then(({ MarketplaceHubInstallationsPage }) => ({ default: MarketplaceHubInstallationsPage })));
const MarketplaceHubReportsPage = lazy(() => import("@/pages/marketplace/marketplace-hub-reports").then(({ MarketplaceHubReportsPage }) => ({ default: MarketplaceHubReportsPage })));
const MarketplaceHubCategoriesPage = lazy(() => import("@/pages/marketplace/marketplace-hub-categories").then(({ MarketplaceHubCategoriesPage }) => ({ default: MarketplaceHubCategoriesPage })));
const DashboardLayout = lazy(() => import("@/components/layout/dashboard-layout").then(({ DashboardLayout }) => ({ default: DashboardLayout })));
const GiftActivatePage = lazy(() => import("@/pages/gift-activate").then(({ GiftActivatePage }) => ({ default: GiftActivatePage })));
const LandingPage = lazy(() => import("@/pages/landing").then(({ LandingPage }) => ({ default: LandingPage })));
const LegalOfferPage = lazy(() => import("@/pages/legal").then(({ LegalOfferPage }) => ({ default: LegalOfferPage })));
const LegalPrivacyPage = lazy(() => import("@/pages/legal").then(({ LegalPrivacyPage }) => ({ default: LegalPrivacyPage })));
const lazyPageFallback = <div className="min-h-48 flex items-center justify-center text-sm text-muted-foreground">Загрузка раздела…</div>;

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const hasToken = Boolean(state.accessToken);

  if (!hasToken) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

function ForceChangePassword({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (state.admin?.mustChangePassword) {
    return <Navigate to="/admin/change-password" replace />;
  }
  return <>{children}</>;
}

function RequireClientAuth({ children }: { children: React.ReactNode }) {
  const { state } = useClientAuth();
  const inTelegram = typeof window !== "undefined" && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
  const showMiniappLoading = state.miniappAuthLoading || (inTelegram && !state.token && !state.miniappAuthAttempted);
  if (showMiniappLoading) return null;
  if (!state.token) {
    return <Navigate to="/cabinet/login" replace />;
  }
  return <>{children}</>;
}

type ClientFeature = "customBuild" | "extraOptions" | "proxy" | "singbox" | "gifts" | "tickets";
function RequireClientFeature({ feature, children }: { feature: ClientFeature; children: ReactNode }) {
  const { config } = useClientApp();
  if (!config) return null;
  const enabled = {
    customBuild: Boolean(config.customBuildConfig?.enabled),
    extraOptions: Boolean(config.sellOptionsEnabled),
    proxy: Boolean(config.showProxyEnabled),
    singbox: Boolean(config.showSingboxEnabled),
    gifts: Boolean(config.giftSubscriptionsEnabled),
    tickets: Boolean(config.ticketsEnabled),
  }[feature];
  return enabled ? children : <Navigate to="/cabinet/profile" replace />;
}

function RequireOnboarding({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function CabinetIndexRedirect() {
  const { state } = useClientAuth();
  const location = useLocation();
  const inTelegram = typeof window !== "undefined" && Boolean((window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData);
  const showMiniappLoading = state.miniappAuthLoading || (inTelegram && !state.token && !state.miniappAuthAttempted);
  if (showMiniappLoading) return null;
  return <Navigate to={`${state.token ? "/cabinet/dashboard" : "/cabinet/login"}${location.search}`} replace />;
}

function RootRoute() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getPublicConfig()
      .then((c) => setConfig(c))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  if (config?.landingEnabled) {
    return <LandingPage config={config} />;
  }

  return <Navigate to="/cabinet" replace />;
}

function AppRoutes() {
  const { state, refreshAccess } = useAuth();

  useEffect(() => {
    if (!state.accessToken && state.refreshToken) {
      refreshAccess();
    }
  }, []);

  return (
    <Suspense fallback={lazyPageFallback}>
      <LazyRouteErrorBoundary>
        <Routes>
      {/* Главная: лендинг (если включён в настройках) или редирект в кабинет */}
      <Route path="/" element={<RootRoute />} />
      <Route path="/offer" element={<LegalOfferPage />} />
      <Route path="/privacy" element={<LegalPrivacyPage />} />
      {/* Админка */}
      <Route path="/admin/login" element={state.accessToken ? <Navigate to="/admin" replace /> : <LoginPage />} />
      <Route
        path="/admin/change-password"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <>
              <CmdKPalette />
              <DashboardLayout />
            </>
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <ForceChangePassword>
              <DashboardPage />
            </ForceChangePassword>
          }
        />
        <Route path="clients" element={<ForceChangePassword><ClientsPage /></ForceChangePassword>} />
        <Route path="payments" element={<ForceChangePassword><PaymentsPage /></ForceChangePassword>} />
        <Route path="tariffs" element={<ForceChangePassword><TariffsPage /></ForceChangePassword>} />
        {/* T15 (11.05.2026) */}
        <Route path="trials" element={<ForceChangePassword><TrialsPage /></ForceChangePassword>} />
        {/* T6 (11.05.2026) */}
        <Route path="withdrawals" element={<ForceChangePassword><WithdrawalsPage /></ForceChangePassword>} />
        {/* T-autorenew (12.05.2026) */}
        <Route path="auto-renew" element={<ForceChangePassword><AutoRenewPage /></ForceChangePassword>} />
        <Route path="settings" element={<ForceChangePassword><SettingsPage /></ForceChangePassword>} />
        <Route path="landing-editor" element={<ForceChangePassword><LandingEditorPage /></ForceChangePassword>} />
        <Route path="landing-preview" element={<ForceChangePassword><LandingPreviewPage /></ForceChangePassword>} />
        <Route path="audit" element={<ForceChangePassword><AdminAuditPage /></ForceChangePassword>} />
        <Route path="webhook-inbox" element={<ForceChangePassword><AdminWebhookInboxPage /></ForceChangePassword>} />
        <Route path="diagnostics" element={<ForceChangePassword><AdminDiagnosticsPage /></ForceChangePassword>} />
        <Route path="business-analytics" element={<ForceChangePassword><Suspense fallback={lazyPageFallback}><AdminBusinessAnalyticsPage /></Suspense></ForceChangePassword>} />
        <Route path="anti-fraud" element={<ForceChangePassword><AdminAntiFraudPage /></ForceChangePassword>} />
        <Route path="email-templates" element={<ForceChangePassword><AdminEmailTemplatesPage /></ForceChangePassword>} />
        <Route path="bot-messages" element={<ForceChangePassword><AdminBotMessagesPage /></ForceChangePassword>} />
        <Route path="bot-conversations" element={<ForceChangePassword><AdminBotConversationsPage /></ForceChangePassword>} />
        <Route path="promo" element={<ForceChangePassword><PromoPage /></ForceChangePassword>} />
        <Route path="promo-codes" element={<ForceChangePassword><PromoCodesPage /></ForceChangePassword>} />
        <Route path="remna-nodes" element={<ForceChangePassword><RemnaNodesPage /></ForceChangePassword>} />
        <Route path="remna-squads" element={<ForceChangePassword><RemnaSquadsPage /></ForceChangePassword>} />
        <Route path="remna-hosts" element={<ForceChangePassword><RemnaHostsPage /></ForceChangePassword>} />
        <Route path="remna-profiles" element={<ForceChangePassword><RemnaProfilesPage /></ForceChangePassword>} />
        <Route path="remna-sub-templates" element={<ForceChangePassword><RemnaSubTemplatesPage /></ForceChangePassword>} />
        <Route path="analytics" element={<ForceChangePassword><Suspense fallback={lazyPageFallback}><AnalyticsPage /></Suspense></ForceChangePassword>} />
        <Route path="marketing" element={<ForceChangePassword><MarketingPage /></ForceChangePassword>} />
        <Route path="admins" element={<ForceChangePassword><AdminsPage /></ForceChangePassword>} />
        <Route path="sales-report" element={<ForceChangePassword><SalesReportPage /></ForceChangePassword>} />
        <Route path="balance-sales" element={<ForceChangePassword><BalanceSalesPage /></ForceChangePassword>} />
        <Route path="video-instructions" element={<ForceChangePassword><VideoInstructionsPage /></ForceChangePassword>} />
        <Route path="broadcast" element={<ForceChangePassword><BroadcastPage /></ForceChangePassword>} />
        <Route path="auto-broadcast" element={<ForceChangePassword><AutoBroadcastPage /></ForceChangePassword>} />
        <Route path="proxy" element={<ForceChangePassword><ProxyPage /></ForceChangePassword>} />
        <Route path="singbox" element={<ForceChangePassword><SingboxPage /></ForceChangePassword>} />
        <Route path="backup" element={<ForceChangePassword><BackupPage /></ForceChangePassword>} />
        <Route path="contests" element={<ForceChangePassword><ContestsPage /></ForceChangePassword>} />
        <Route path="tickets" element={<ForceChangePassword><AdminTicketsPage /></ForceChangePassword>} />
        <Route path="referral-network" element={<ForceChangePassword><Suspense fallback={lazyPageFallback}><ReferralNetworkPage /></Suspense></ForceChangePassword>} />
        <Route path="partners/:id/network" element={<ForceChangePassword><Suspense fallback={lazyPageFallback}><ReferralNetworkPage /></Suspense></ForceChangePassword>} />
        <Route path="referrals" element={<ForceChangePassword><AdminReferralsPage /></ForceChangePassword>} />
        <Route path="partners" element={<ForceChangePassword><PartnersPage /></ForceChangePassword>} />
        <Route path="traffic-abuse" element={<ForceChangePassword><TrafficAbusePage /></ForceChangePassword>} />
        <Route path="api-keys" element={<ForceChangePassword><ApiKeysPage /></ForceChangePassword>} />
        <Route path="antibot" element={<ForceChangePassword><AntibotPage /></ForceChangePassword>} />
        <Route path="languages" element={<ForceChangePassword><LanguagesPage /></ForceChangePassword>} />
        <Route path="api-docs" element={<ForceChangePassword><ApiDocsPage /></ForceChangePassword>} />
        <Route path="geo-map" element={<ForceChangePassword><Suspense fallback={lazyPageFallback}><GeoMapPage /></Suspense></ForceChangePassword>} />
        <Route path="secondary-subscriptions" element={<ForceChangePassword><AdminSecondarySubscriptionsPage /></ForceChangePassword>} />
        <Route path="tour-constructor" element={<ForceChangePassword><TourConstructorPage /></ForceChangePassword>} />
        <Route path="promo-vpn" element={<ForceChangePassword><GramadsPromoPage /></ForceChangePassword>} />
        <Route path="marketplace" element={<ForceChangePassword><MarketplaceLayout /></ForceChangePassword>}>
          <Route index element={<MarketplaceBrowsePage />} />
          <Route path="my" element={<MarketplaceMyListingsPage />} />
          <Route path="my/new" element={<MarketplaceEditListingPage />} />
          <Route path="my/:id/edit" element={<MarketplaceEditListingPage />} />
          <Route path="hub/installations" element={<MarketplaceHubInstallationsPage />} />
          <Route path="hub/reports" element={<MarketplaceHubReportsPage />} />
          <Route path="hub/categories" element={<MarketplaceHubCategoriesPage />} />
        </Route>
      </Route>
      {/* Публичная страница подарка — без auth */}
      <Route
        path="/gift/:code"
        element={
          <ClientAuthProvider>
            <GiftActivatePage />
          </ClientAuthProvider>
        }
      />

      <Route
        path="/cabinet"
        element={
          <ClientAuthProvider>
            <ClientAppProvider><Outlet /></ClientAppProvider>
          </ClientAuthProvider>
        }
      >
        <Route index element={<CabinetIndexRedirect />} />
        <Route path="login" element={<CabinetLogin />} />
        <Route path="register" element={<CabinetRegister />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route path="verify-email" element={<VerifyEmail />} />
        <Route path="verify-link-email" element={<VerifyLinkEmail />} />
        <Route
          path="onboarding"
          element={
            <RequireClientAuth>
              <RequireOnboarding><Onboarding /></RequireOnboarding>
            </RequireClientAuth>
          }
        />
        <Route
          path="payment-wait"
          element={
            <RequireClientAuth><PaymentWait /></RequireClientAuth>
          }
        />
        <Route
          path="yoomoney-pay"
          element={
            <RequireClientAuth><YooMoneyPay /></RequireClientAuth>
          }
        />
        <Route
          element={
            <RequireClientAuth>
              <ClientLayout />
            </RequireClientAuth>
          }
        >
          <Route path="dashboard" element={<CabinetDashboard />} />
          <Route path="subscribe" element={<CabinetKeys />} />
          <Route path="tariffs" element={<CabinetTariffs />} />
          <Route path="referral" element={<CabinetReferrals />} />
          <Route path="profile" element={<CabinetProfile />} />
          <Route path="tickets" element={<RequireClientFeature feature="tickets"><Tickets /></RequireClientFeature>} />
          <Route path="custom-build" element={<RequireClientFeature feature="customBuild"><CustomBuild /></RequireClientFeature>} />
          <Route path="extra-options" element={<RequireClientFeature feature="extraOptions"><ExtraOptions /></RequireClientFeature>} />
          <Route path="proxy" element={<RequireClientFeature feature="proxy"><ProxyService /></RequireClientFeature>} />
          <Route path="singbox" element={<RequireClientFeature feature="singbox"><SingboxService /></RequireClientFeature>} />
          <Route path="gifts" element={<RequireClientFeature feature="gifts"><Gifts /></RequireClientFeature>} />
        </Route>
        <Route
          path="*"
          element={
            <Navigate to="/cabinet" replace />
          }
        />
      </Route>
      {/* Всё неизвестное тоже ведём в кабинет */}
      <Route path="*" element={<Navigate to="/cabinet" replace />} />
        </Routes>
      </LazyRouteErrorBoundary>
    </Suspense>
  );
}

function TitleAndThemeSync() {
  const location = useLocation();
  const [config, setConfig] = useState<{ serviceName: string; favicon: string | null } | null>(null);

  // Конфиг приложения не меняется при навигации между страницами.
  useEffect(() => {
    api
      .getPublicConfig()
      .then((cfg) => {
        setConfig({
          serviceName: cfg.serviceName ?? "",
          favicon: (cfg as { favicon?: string | null }).favicon ?? null,
        });
        // Глобальная тема из настроек
      })
      .catch(() => {
        setConfig({ serviceName: "", favicon: null });
      });
  }, []);

  // Title и favicon
  useEffect(() => {
    const base = config?.serviceName ?? "";
    let suffix = "";
    if (location.pathname.startsWith("/admin")) suffix = " — Admin";
    else if (location.pathname.startsWith("/cabinet")) suffix = " — Кабинет";
    document.title = (base + suffix).trim() || suffix.replace(/^ — /, "").trim();

    // Custom favicon: убираем все статические <link rel="icon"> из index.html
    // (svg, 32px, 16px, apple-touch и иконки PWA-манифеста), потому что
    // браузер выбирает «лучший» по размеру, и PWA-иконка может перебить
    // пользовательский favicon. Помечаем добавленные нами линки атрибутом
    // data-custom-favicon, чтобы при обновлении не плодить дубли.
    //
    // Также подменяем <link rel="manifest"> на динамический эндпоинт
    // /api/public/manifest.webmanifest когда есть custom favicon — иначе
    // PWA install/Add-to-home-screen покажет дефолтную иконку сборки.
    const favicon = config?.favicon ?? null;
    const existingCustom = document.querySelectorAll<HTMLLinkElement>('link[data-custom-favicon="1"]');
    const builtin = document.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"]:not([data-custom-favicon]), link[rel="apple-touch-icon"]:not([data-custom-favicon]), link[rel="shortcut icon"]:not([data-custom-favicon]), link[rel="mask-icon"]:not([data-custom-favicon])'
    );

    if (favicon) {
      // Убираем дефолтные иконки сборки (favicon-16/32, apple-touch, svg).
      builtin.forEach((el) => el.remove());
      existingCustom.forEach((el) => el.remove());

      const detectType = (src: string): string => {
        if (src.startsWith("data:image/")) {
          const m = src.match(/data:image\/(\w+)/);
          return m ? `image/${m[1].toLowerCase()}` : "image/png";
        }
        if (/\.svg(\?|$)/i.test(src)) return "image/svg+xml";
        if (/\.png(\?|$)/i.test(src)) return "image/png";
        if (/\.(jpg|jpeg)(\?|$)/i.test(src)) return "image/jpeg";
        if (/\.webp(\?|$)/i.test(src)) return "image/webp";
        if (/\.ico(\?|$)/i.test(src)) return "image/x-icon";
        return "image/png";
      };
      const type = detectType(favicon);

      // Главный favicon — без sizes, чтобы браузер не пытался выбрать «другой подходящий»
      const main = document.createElement("link");
      main.rel = "icon";
      main.type = type;
      main.href = favicon;
      main.setAttribute("data-custom-favicon", "1");
      document.head.appendChild(main);

      // apple-touch-icon — отдельной иконкой, чтобы home-screen на iOS тоже взял пользовательский favicon
      const apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      apple.href = favicon;
      apple.setAttribute("data-custom-favicon", "1");
      document.head.appendChild(apple);
    } else {
      // Сбросили favicon в админке — возвращаем дефолтные если их вдруг убрали custom-логикой раньше
      existingCustom.forEach((el) => el.remove());
      if (document.querySelectorAll('link[rel="icon"]').length === 0) {
        const def = document.createElement("link");
        def.rel = "icon";
        def.type = "image/png";
        def.href = "/favicon-32.png?v=rounded";
        document.head.appendChild(def);
      }
    }

    // Манифест: при custom favicon переключаем на динамический эндпоинт.
    // Когда favicon пустой — оставляем статический манифест (дефолтное брендирование).
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const dynamicManifestUrl = "/api/public/manifest.webmanifest";
    const staticManifestUrl = "/manifest.webmanifest";
    const wantUrl = favicon ? dynamicManifestUrl : staticManifestUrl;
    if (manifestLink && manifestLink.getAttribute("href") !== wantUrl) {
      manifestLink.href = wantUrl;
    } else if (!manifestLink) {
      const ml = document.createElement("link");
      ml.rel = "manifest";
      ml.href = wantUrl;
      document.head.appendChild(ml);
    }
  }, [location.pathname, config]);

  return null;
}

export default function App() {

  return (
    <ThemeProvider >
      <AuthProvider>
        <BrowserRouter future={routerFutureFlags}>
          <AnimatedBackground />
          <Toaster />
          <TitleAndThemeSync  />
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
