import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type ClientPayment, type ClientReferralStats, type ClientTrialOption, type PublicConfig } from "@/lib/api";
import {
  mapClient,
  mapClientApps,
  groupDevicesBySubscription,
  mapSubscription,
  mapTariffGroups,
  shouldOfferTelegramLink,
  type CabinetClientApp,
  type CabinetReferral,
  type CabinetSubscription,
  type CabinetTransaction,
  type CabinetUser,
  type DeviceAddon,
  type TariffDuration,
  type TariffGroup,
} from "../model";

export interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: "success" | "error" | "info";
}

interface AppState {
  user: CabinetUser;
  subscriptions: CabinetSubscription[];
  transactions: CabinetTransaction[];
  referral: CabinetReferral;
  clientApps: CabinetClientApp[];
  tariffGroups: TariffGroup[];
  availableTrials: ClientTrialOption[];
  durations: TariffDuration[];
  deviceAddons: DeviceAddon[];
  config: PublicConfig | null;
  loading: boolean;
  error: string | null;
  canLinkTelegram: boolean;
  toasts: Toast[];
  reload: () => Promise<void>;
  disconnectDevice: (subId: string, deviceId: string) => Promise<void>;
  linkTelegram: () => Promise<void>;
  toast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  copy: (text: string, label?: string) => Promise<void>;
}

const EMPTY_USER: CabinetUser = {
  name: "Пользователь",
  initials: "П",
  telegramId: "—",
  email: "—",
  tgUsername: "—",
  registeredAt: "—",
  balance: 0,
  currency: "rub",
};

const EMPTY_REFERRAL: CabinetReferral = {
  percent: 0,
  invited: 0,
  earned: 0,
  siteLink: "",
  botLink: "",
  levels: [],
};

const AppContext = createContext<AppState | null>(null);
let toastSeq = 1;

function mapReferral(stats: ClientReferralStats | null, config: PublicConfig | null): CabinetReferral {
  const code = stats?.referralCode;
  const origin = config?.publicAppUrl?.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
  const username = config?.telegramBotUsername?.replace(/^@/, "");
  return {
    percent: stats?.referralPercent ?? 0,
    invited: stats?.referralCount ?? 0,
    earned: stats?.totalEarnings ?? 0,
    siteLink: code && origin ? `${origin}/cabinet/register?ref=${encodeURIComponent(code)}` : "",
    botLink: code && username ? `https://t.me/${username}?start=ref_${code}` : "",
    levels: [
      { level: 1, percent: stats?.referralPercent ?? 0, text: "Прямые друзья: процент от их оплат." },
      { level: 2, percent: stats?.referralPercentLevel2 ?? 0, text: "Друзья друзей: процент от их оплат." },
      { level: 3, percent: stats?.referralPercentLevel3 ?? 0, text: "Третья линия: небольшой бонус от оплат в глубине сети." },
    ].filter((level) => level.percent > 0),
  };
}

function mapPayment(payment: ClientPayment): CabinetTransaction {
  const createdAt = new Date(payment.createdAt);
  const date = Number.isNaN(createdAt.getTime()) ? "—" : createdAt.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const status = payment.status.toUpperCase();
  const statusLabel = status === "PAID" ? "Оплачен" : status === "FAILED" ? "Не прошёл" : "Ожидает оплаты";
  return {
    id: payment.id,
    type: "purchase",
    title: "Платёж",
    detail: `${statusLabel} · ${payment.orderId}`,
    amount: -Math.abs(payment.amount),
    date,
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { state, refreshProfile } = useClientAuth();
  const [subscriptions, setSubscriptions] = useState<CabinetSubscription[]>([]);
  const [transactions, setTransactions] = useState<CabinetTransaction[]>([]);
  const [referral, setReferral] = useState<CabinetReferral>(EMPTY_REFERRAL);
  const [clientApps, setClientApps] = useState<CabinetClientApp[]>([]);
  const [tariffGroups, setTariffGroups] = useState<TariffGroup[]>([]);
  const [availableTrials, setAvailableTrials] = useState<ClientTrialOption[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback((next: Omit<Toast, "id">) => {
    const id = toastSeq++;
    setToasts((current) => [...current.slice(-2), { ...next, id }]);
    window.setTimeout(() => dismissToast(id), 3200);
  }, [dismissToast]);

  const copy = useCallback(async (text: string, label = "Скопировано") => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    toast({ title: label, variant: "success" });
  }, [toast]);

  const reload = useCallback(async () => {
    if (!state.token) return;
    setLoading(true);
    setError(null);
    try {
      const [all, deviceResult, publicConfig, subscriptionPage, stats, tariffs, payments, trials] = await Promise.all([
        api.clientAllSubscriptions(state.token),
        api.getMyAllDevices(state.token),
        api.getPublicConfig(),
        api.getPublicSubscriptionPageConfig(),
        api.getClientReferralStats(state.token),
        api.getPublicTariffs(),
        api.clientPayments(state.token),
        api.getClientAvailableTrials(state.token),
      ]);
      const devices = groupDevicesBySubscription(deviceResult.items);
      setSubscriptions(all.items.map((item) => mapSubscription(item, new Date(), devices.get(item.id) ?? [])));
      setClientApps(mapClientApps(subscriptionPage));
      setConfig(publicConfig);
      setReferral(mapReferral(stats, publicConfig));
      setTariffGroups(mapTariffGroups(tariffs.items));
      setTransactions(payments.items.map(mapPayment));
      setAvailableTrials(trials.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить кабинет");
    } finally {
      setLoading(false);
    }
  }, [state.token]);

  useEffect(() => {
    if (!state.token) {
      setLoading(false);
      return;
    }
    void reload();
  }, [reload, state.token]);

  const disconnectDevice = useCallback(async (subId: string, deviceId: string) => {
    if (!state.token) return;
    const subscription = subscriptions.find((item) => item.id === subId);
    if (!subscription) return;
    await api.deleteClientDevice(state.token, deviceId, subscription.source);
    setSubscriptions((current) => current.map((item) => (
      item.id === subId ? { ...item, devices: item.devices.filter((device) => device.id !== deviceId) } : item
    )));
    toast({ title: "Устройство отключено", description: "Слот освобождён для нового устройства", variant: "info" });
  }, [state.token, subscriptions, toast]);

  const linkTelegram = useCallback(async () => {
    if (!state.token) return;
    try {
      const request = await api.clientLinkTelegramRequest(state.token);
      const initData = window.Telegram?.WebApp?.initData?.trim();
      if (initData) {
        await api.clientLinkTelegram(state.token, { initData });
        await refreshProfile();
        toast({ title: "Telegram привязан", variant: "success" });
        return;
      }
      const username = request.botUsername?.replace(/^@/, "");
      if (!username) throw new Error("Telegram-бот для привязки не настроен");
      const url = `https://t.me/${encodeURIComponent(username)}?start=link_${encodeURIComponent(request.code)}`;
      if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(url);
      else window.open(url, "_blank", "noopener,noreferrer");

      let checking = false;
      let timeoutId: number | undefined;
      let stopped = false;
      const stopChecking = () => {
        if (stopped) return;
        stopped = true;
        window.removeEventListener("focus", checkTelegramLink);
        document.removeEventListener("visibilitychange", checkTelegramLink);
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      };
      const checkTelegramLink = async () => {
        if (stopped || checking || document.visibilityState === "hidden") return;
        checking = true;
        try {
          const linkedClient = await refreshProfile();
          if (linkedClient?.telegramId) {
            stopChecking();
            toast({ title: "Telegram привязан", variant: "success" });
          }
        } finally {
          checking = false;
        }
      };
      window.addEventListener("focus", checkTelegramLink);
      document.addEventListener("visibilitychange", checkTelegramLink);
      timeoutId = window.setTimeout(stopChecking, 10 * 60 * 1000);
      const expires = new Date(request.expiresAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      toast({ title: "Подтвердите привязку в Telegram", description: `Код действует до ${expires}`, variant: "info" });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось привязать Telegram";
      toast({ title: "Ошибка привязки", description: message, variant: "error" });
    }
  }, [refreshProfile, state.token, toast]);

  const user = state.client ? mapClient(state.client) : EMPTY_USER;
  const value = useMemo<AppState>(() => ({
    user,
    subscriptions,
    transactions,
    referral,
    clientApps,
    tariffGroups,
    availableTrials,
    durations: [],
    deviceAddons: [],
    config,
    loading,
    error,
    canLinkTelegram: shouldOfferTelegramLink(state.client),
    toasts,
    reload,
    disconnectDevice,
    linkTelegram,
    toast,
    dismissToast,
    copy,
  }), [user, subscriptions, transactions, referral, clientApps, tariffGroups, availableTrials, config, loading, error, state.client, reload, disconnectDevice, linkTelegram, toast, dismissToast, copy]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
}
