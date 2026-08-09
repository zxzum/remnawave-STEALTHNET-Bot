import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import * as Checkbox from "@radix-ui/react-checkbox";
import { QRCodeSVG } from "qrcode.react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicConfig } from "@/lib/api";
import {
  KeyRound,
  UserPlus,
  UserRound,
  ShieldCheck,
  Check,
  ChevronRight,
  Send,
  Mail,
  Eye,
  EyeOff,
} from "lucide-react";
import { Background } from "../components/Layout";
import { Toasts } from "../components/ui/Toasts";
import { CopyIconButton } from "../components/ui/CopyButton";
import { useApp } from "../store/AppContext";

/* ---------------- Каркас ---------------- */

function AuthShell({ children }: { children: ReactNode }) {
  const { config } = useApp();
  useEffect(() => {
    document.body.classList.add("cabinet-ui-active");
    return () => document.body.classList.remove("cabinet-ui-active");
  }, []);

  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4 py-8 sm:py-12">
      <Background />
      <Toasts />
      <header className="relative z-10 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-accent-500 to-accent-600 shadow-neon-blue">
          <KeyRound className="h-5 w-5 text-white" strokeWidth={2.4} />
        </div>
        <p className="text-xl font-extrabold tracking-tight">{config?.serviceName || "Лазейка VPN"}</p>
      </header>
      <main className="relative z-10 flex w-full max-w-md flex-1 items-center py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="glass-strong liquid w-full rounded-4xl p-6 sm:p-8"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-6 flex justify-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={
            i === current
              ? "h-1.5 w-8 rounded-full bg-white transition-all duration-300"
              : "h-1.5 w-1.5 rounded-full bg-white/25 transition-all duration-300"
          }
        />
      ))}
    </div>
  );
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-4 text-xs font-semibold text-fog-600">
      <span className="h-px flex-1 bg-white/8" />
      или
      <span className="h-px flex-1 bg-white/8" />
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-glass pr-12"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Скрыть пароль" : "Показать пароль"}
        className="absolute top-1/2 right-4 -translate-y-1/2 text-fog-500 transition-colors hover:text-fog-100"
      >
        {show ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
      </button>
    </div>
  );
}

/* ---------------- Вход ---------------- */

function useTelegramDeepLinkAuth(botUsername: string | null, onSuccess: () => void) {
  const { loginByTelegramDeepLink } = useClientAuth();
  const pollRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const start = useCallback(() => {
    if (!botUsername || pending) return;
    const popup = window.open("about:blank", "_blank");
    setPending(true);
    void api.clientTelegramLoginToken().then(({ token }) => {
      const bot = botUsername.replace(/^@/, "");
      const url = `https://t.me/${encodeURIComponent(bot)}?start=auth_${encodeURIComponent(token)}`;
      if (popup && !popup.closed) popup.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");

      let attempts = 0;
      pollRef.current = window.setInterval(async () => {
        if (++attempts > 150) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setPending(false);
          return;
        }
        try {
          const result = await api.clientTelegramLoginCheck(token);
          if (!result.confirmed) return;
          if (pollRef.current) window.clearInterval(pollRef.current);
          loginByTelegramDeepLink(result);
          setPending(false);
          if (!("requires2FA" in result && result.requires2FA)) onSuccess();
        } catch {
          // Temporary polling failures are retried until the server-side token expires.
        }
      }, 2000);
    }).catch(() => {
      if (popup && !popup.closed) popup.close();
      setPending(false);
    });
  }, [botUsername, loginByTelegramDeepLink, onSuccess, pending]);

  return { pending, start };
}

function useExternalAuth(config: PublicConfig | null, onSuccess: () => void, onError: (message: string) => void) {
  const { loginByApple, loginByGoogle } = useClientAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const idToken = params.get("id_token");
    const returnedState = params.get("state");
    if (!idToken || !returnedState) return;
    const provider = returnedState.startsWith("google_") ? "google" : returnedState.startsWith("apple_") ? "apple" : null;
    if (!provider) return;
    const key = `stealthnet_${provider}_oauth_state`;
    if (sessionStorage.getItem(key) !== returnedState) {
      onError("Не удалось проверить ответ сервиса входа");
      return;
    }
    sessionStorage.removeItem(key);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const login = provider === "google" ? loginByGoogle : loginByApple;
    void login(idToken).then(onSuccess).catch((cause) => onError(cause instanceof Error ? cause.message : "Не удалось войти"));
  }, [loginByApple, loginByGoogle, onError, onSuccess]);

  const redirect = useCallback((provider: "google" | "apple") => {
    const clientId = provider === "google" ? config?.googleClientId : config?.appleClientId;
    if (!clientId) return;
    const state = `${provider}_${crypto.randomUUID()}`;
    const baseUrl = config?.publicAppUrl?.trim().replace(/\/$/, "") || window.location.origin;
    const redirectUri = `${baseUrl}${window.location.pathname}`;
    sessionStorage.setItem(`stealthnet_${provider}_oauth_state`, state);
    const url = new URL(provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://appleid.apple.com/auth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", provider === "google" ? "id_token" : "code id_token");
    url.searchParams.set("scope", provider === "google" ? "openid email" : "email");
    url.searchParams.set("state", state);
    if (provider === "google") url.searchParams.set("nonce", crypto.randomUUID());
    else url.searchParams.set("response_mode", "fragment");
    window.location.assign(url);
  }, [config]);

  return { redirect };
}

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, submit2FACode, state } = useClientAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionReason = searchParams.get("reason");
  const sessionMessage = sessionReason === "account-deleted"
    ? "Аккаунт удалён. Войдите снова или зарегистрируйтесь заново."
    : sessionReason === "session-expired"
      ? "Сессия завершена. Войдите снова."
      : "";
  const [error, setError] = useState(sessionMessage);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const valid = /.+@.+\..+/.test(email) && password.length >= 6;
  const goCabinet = useCallback(() => navigate("/cabinet/dashboard", { replace: true }), [navigate]);
  const showError = useCallback((message: string) => setError(message), []);
  const telegram = useTelegramDeepLinkAuth(config?.telegramBotUsername ?? null, goCabinet);
  const external = useExternalAuth(config, goCabinet, showError);

  useEffect(() => { void api.getPublicConfig().then(setConfig).catch(() => undefined); }, []);
  useEffect(() => { if (state.token) goCabinet(); }, [goCabinet, state.token]);

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    try {
      await login(email.trim(), password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  };

  const handle2FA = async () => {
    setLoading(true);
    setError("");
    try {
      await submit2FACode(code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Неверный код");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="icon-tile mx-auto h-16 w-16 rounded-2xl">
        <UserRound className="h-7 w-7" />
      </div>
      <h1 className="mt-5 text-center text-3xl font-extrabold tracking-tight">Вход в кабинет</h1>
      <p className="mt-1.5 text-center text-sm text-fog-500">Введите email и пароль от аккаунта</p>

      {state.pending2FAToken ? (
        <>
          <label className="mt-7 block text-sm font-semibold">Код двухфакторной аутентификации</label>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="000000" className="input-glass mt-2 text-center font-mono text-2xl font-bold tracking-[0.5em]" autoFocus />
          <button disabled={code.length !== 6 || loading} onClick={handle2FA} className="btn-primary mt-4 w-full px-6 py-4 text-base disabled:cursor-not-allowed disabled:opacity-40">
            Подтвердить
          </button>
        </>
      ) : (
        <>
          <label className="mt-7 block text-sm font-semibold">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="input-glass mt-2" autoFocus />
          <label className="mt-4 block text-sm font-semibold">Пароль</label>
          <div className="mt-2"><PasswordInput value={password} onChange={setPassword} placeholder="Ваш пароль" /></div>
          <div className="mt-2 text-right">
            <Link to="/cabinet/forgot-password" className="text-xs font-semibold text-fog-500 transition-colors hover:text-accent-400">Забыли пароль?</Link>
          </div>
          <button disabled={!valid || loading} onClick={handleLogin} className="btn-primary mt-4 w-full px-6 py-4 text-base disabled:cursor-not-allowed disabled:opacity-40">
            {loading ? "Входим…" : "Войти"}
          </button>
        </>
      )}

      {error && <p className="mt-3 text-center text-sm font-semibold text-red-400">{error}</p>}

      <Divider />

      <button disabled={!config?.telegramBotUsername || telegram.pending} onClick={telegram.start} className="btn-ghost w-full px-6 py-4 text-sm disabled:opacity-40">
        <Send className="h-4 w-4" /> {telegram.pending ? "Ожидаем подтверждение…" : "Войти через Telegram"}
      </button>
      {config?.googleLoginEnabled && <button onClick={() => external.redirect("google")} className="btn-ghost mt-2 w-full px-6 py-4 text-sm">Войти через Google</button>}
      {config?.appleLoginEnabled && <button onClick={() => external.redirect("apple")} className="btn-ghost mt-2 w-full px-6 py-4 text-sm">Войти через Apple</button>}

      <p className="mt-6 text-center text-sm text-fog-500">
        Нет аккаунта?{" "}
        <Link to="/cabinet/register" className="font-bold text-fog-100 transition-colors hover:text-accent-400">
          Регистрация
        </Link>
      </p>
    </AuthShell>
  );
}

/* ---------------- Регистрация (визард) ---------------- */

type Step = "email" | "password" | "twofa" | "done";

export function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { register, completeRegistration, refreshProfile, state } = useClientAuth();
  const registrationToken = searchParams.get("registrationToken")?.trim() || "";
  const [step, setStep] = useState<Step>(registrationToken ? "password" : "email");
  const [email, setEmail] = useState(searchParams.get("email")?.trim() || "");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [agreed, setAgreed] = useState(true);
  const [sent, setSent] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [twoFA, setTwoFA] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [registrationSubmitted, setRegistrationSubmitted] = useState(false);
  const setupStarted = useRef(false);

  const emailValid = /.+@.+\..+/.test(email);
  const goCabinet = useCallback(async () => {
    if (state.token) {
      await api.clientCompleteOnboarding(state.token);
      await refreshProfile();
    }
    navigate("/cabinet/dashboard?registration=success", { replace: true });
  }, [navigate, refreshProfile, state.token]);
  const finishExternal = useCallback(() => navigate("/cabinet/onboarding", { replace: true }), [navigate]);
  const showError = useCallback((message: string) => setError(message), []);
  const telegram = useTelegramDeepLinkAuth(config?.telegramBotUsername ?? null, finishExternal);
  const external = useExternalAuth(config, finishExternal, showError);
  const skipEmailVerification = Boolean(config?.skipEmailVerification);

  const submitEmail = async (targetEmail = email.trim()) => {
    if (!config || !/.+@.+\..+/.test(targetEmail) || !agreed || loading) return;
    setLoading(true);
    setError("");
    const utm = Object.fromEntries(
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
        .map((key) => [key, searchParams.get(key)?.trim()] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
    try {
      const result = await register({
        email: targetEmail,
        preferredLang: config?.defaultLanguage || "ru",
        preferredCurrency: (config?.defaultCurrency || "usd").toLowerCase(),
        referralCode: searchParams.get("ref")?.trim() || undefined,
        ...utm,
      });
      if (result?.requiresVerification) {
        setSubmittedEmail(targetEmail);
        setSent(true);
      } else {
        setError("Не удалось отправить письмо");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отправить письмо");
    } finally {
      setLoading(false);
    }
  };

  const continueEmail = () => {
    if (!config) return;
    if (sent || loading) return;
    if (skipEmailVerification) setStep("password");
    else void submitEmail();
  };

  useEffect(() => { void api.getPublicConfig().then(setConfig).catch(() => undefined); }, []);

  useEffect(() => {
    if (!registrationSubmitted || !state.token || setupStarted.current) return;
    setupStarted.current = true;
    if (config?.onboarding2faEnabled === false) {
      void goCabinet();
      return;
    }
    void api.client2FASetup(state.token)
      .then((result) => {
        setTwoFA(result);
        setStep("twofa");
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Не удалось начать настройку 2FA");
        setStep("twofa");
      });
  }, [config?.onboarding2faEnabled, goCabinet, registrationSubmitted, state.token]);

  const submitRegistration = async () => {
    setLoading(true);
    setError("");
    const utm = Object.fromEntries(
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
        .map((key) => [key, searchParams.get(key)?.trim()] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
    try {
      const result = registrationToken
        ? await completeRegistration(registrationToken, pw1)
        : await register({
            email: email.trim(),
            password: pw1,
            preferredLang: config?.defaultLanguage || "ru",
            preferredCurrency: (config?.defaultCurrency || "usd").toLowerCase(),
            referralCode: searchParams.get("ref")?.trim() || undefined,
            ...utm,
          });
      if (result?.requiresVerification) {
        setSent(true);
        setStep("email");
      } else {
        setRegistrationSubmitted(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось зарегистрироваться");
    } finally {
      setLoading(false);
    }
  };

  const confirm2FA = async () => {
    if (!state.token) return;
    setLoading(true);
    setError("");
    try {
      await api.client2FAConfirm(state.token, code);
      await refreshProfile();
      await api.clientCompleteOnboarding(state.token);
      setStep("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Неверный код");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -32 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {step === "email" && (
            <form onSubmit={(event) => { event.preventDefault(); continueEmail(); }}>
              <div className="icon-tile mx-auto h-16 w-16 rounded-2xl">
                <UserPlus className="h-7 w-7" />
              </div>
              <h1 className="mt-5 text-center text-3xl font-extrabold tracking-tight">Регистрация</h1>
              <p className="mt-1.5 text-center text-sm text-fog-500">Создайте аккаунт в кабинете</p>

              <label className="mt-7 block text-sm font-semibold">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sent || loading}
                placeholder="you@example.com"
                className="input-glass mt-2"
                autoFocus
              />

              {sent && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="alert"
                  className="mt-4 flex items-center gap-3 rounded-2xl border border-mint-400/25 bg-mint-500/10 p-4 text-sm font-semibold text-mint-400"
                >
                  <Mail className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1 text-left">Ссылка для подтверждения отправлена на {submittedEmail}.</span>
                  <button type="button" onClick={() => void submitEmail(submittedEmail)} disabled={loading} className="shrink-0 text-xs underline disabled:opacity-50">
                    {loading ? "Отправляем…" : "Отправить ещё раз"}
                  </button>
                </motion.div>
              )}

              {error && step === "email" && <p className="mt-3 text-center text-sm font-semibold text-red-400">{error}</p>}

              <label className="glass-inset mt-4 flex cursor-pointer items-start gap-3 rounded-2xl p-4 text-xs leading-relaxed text-fog-500">
                <Checkbox.Root
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(v === true)}
                  className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-white/15 bg-white/5 transition-colors data-[state=checked]:border-violet-glow data-[state=checked]:bg-violet-glow data-[state=checked]:text-ink-950"
                >
                  <Checkbox.Indicator>
                    <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <span>
                  Регистрируясь, я подтверждаю, что ознакомился и согласен с{" "}
                  <span className="font-semibold text-fog-300 underline">Политикой обработки персональных данных</span>.
                </span>
              </label>

              <button
                type="submit"
                disabled={!config || !emailValid || !agreed || sent || loading}
                className="btn-primary mt-5 w-full px-6 py-4 text-base disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sent ? "Проверьте почту" : !config ? "Загрузка…" : loading ? "Отправляем…" : "Продолжить"}
              </button>

              <Divider />

              <button type="button" disabled={!config?.telegramBotUsername || telegram.pending} onClick={telegram.start} className="btn-ghost w-full px-6 py-4 text-sm disabled:opacity-40">
                <Send className="h-4 w-4" /> {telegram.pending ? "Ожидаем подтверждение…" : "Зарегистрироваться через Telegram"}
              </button>
              {config?.googleLoginEnabled && <button type="button" onClick={() => external.redirect("google")} className="btn-ghost mt-2 w-full px-6 py-4 text-sm">Продолжить через Google</button>}
              {config?.appleLoginEnabled && <button type="button" onClick={() => external.redirect("apple")} className="btn-ghost mt-2 w-full px-6 py-4 text-sm">Продолжить через Apple</button>}

              <p className="mt-6 text-center text-sm text-fog-500">
                Уже есть аккаунт?{" "}
                <Link to="/cabinet/login" className="font-bold text-fog-100 transition-colors hover:text-accent-400">
                  Войти
                </Link>
              </p>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={(event) => { event.preventDefault(); void submitRegistration(); }}>
              <StepDots current={0} total={2} />
              <div className="icon-tile mx-auto h-16 w-16 rounded-2xl">
                <KeyRound className="h-7 w-7" />
              </div>
              <h1 className="mt-5 text-center text-2xl font-extrabold tracking-tight">Создайте пароль</h1>
              <p className="mt-1.5 text-center text-sm text-fog-500">Для входа через email и пароль</p>

              <div className="mt-6 flex flex-col gap-3">
                <PasswordInput value={pw1} onChange={setPw1} placeholder="Новый пароль (мин. 8 символов)" autoFocus />
                <PasswordInput value={pw2} onChange={setPw2} placeholder="Повторите пароль" />
              </div>
              {pw2.length > 0 && pw1 !== pw2 && <p className="mt-2 text-xs font-semibold text-red-400">Пароли не совпадают</p>}

              <button
                type="submit"
                disabled={pw1.length < 8 || pw1 !== pw2 || loading}
                className="btn-primary mt-5 w-full px-6 py-4 text-base disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "Создаём аккаунт…" : <>Далее <ChevronRight className="h-4 w-4" /></>}
              </button>
              {error && <p className="mt-3 text-center text-sm font-semibold text-red-400">{error}</p>}
            </form>
          )}

          {step === "twofa" && (
            <form onSubmit={(event) => { event.preventDefault(); void confirm2FA(); }}>
              <StepDots current={1} total={2} />
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-orange-400/25 bg-orange-500/12 text-orange-400">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <h1 className="mt-5 text-center text-2xl font-extrabold tracking-tight">Двухфакторная защита</h1>
              <p className="mt-2 text-center text-sm font-bold text-amber-glow">
                Этот шаг необязательный — можно пропустить
              </p>
              <p className="mt-3 text-center text-sm leading-relaxed text-fog-500">
                Для двухфакторной аутентификации используйте приложение{" "}
                <span className="font-bold text-fog-100">Google Authenticator</span>.
              </p>

              <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-3 shadow-[0_16px_40px_-12px_rgba(255,255,255,0.25)]">
                {twoFA ? <QRCodeSVG value={twoFA.otpauthUrl} size={176} /> : <div className="h-44 w-44 animate-pulse rounded-xl bg-fog-100" />}
              </div>

              <div className="glass-inset mt-4 flex items-center gap-3 rounded-2xl px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold tracking-wider text-fog-600 uppercase">Или введите ключ вручную</p>
                  <p className="truncate font-mono text-sm text-fog-300">{twoFA?.secret ?? "Загрузка…"}</p>
                </div>
                {twoFA && <CopyIconButton text={twoFA.secret} label="Ключ скопирован" className="h-8 w-8 rounded-lg" />}
              </div>

              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                className="input-glass mt-3 text-center font-mono text-2xl font-bold tracking-[0.5em]"
              />

              <button
                type="submit"
                disabled={code.length !== 6 || loading || !twoFA}
                className="btn-primary mt-4 w-full px-6 py-4 text-base disabled:cursor-not-allowed disabled:opacity-40"
              >
                Подтвердить и завершить
              </button>
              {error && <p className="mt-3 text-center text-sm font-semibold text-red-400">{error}</p>}
              <button
                type="button"
                onClick={goCabinet}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-glow/25 bg-amber-glow/10 px-6 py-3.5 text-sm font-bold text-amber-glow transition-all hover:bg-amber-glow/20 active:scale-95"
              >
                Пропустить, перейти в кабинет <ChevronRight className="h-4 w-4" />
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="text-center">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 16 }}
                className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-mint-400/30 bg-mint-500/15 text-mint-400 shadow-neon-mint"
              >
                <Check className="h-9 w-9" strokeWidth={3} />
              </motion.div>
              <h1 className="mt-5 text-3xl font-extrabold tracking-tight">Настройка завершена!</h1>
              <p className="mt-2 text-sm text-fog-500">Ваш аккаунт полностью готов к работе</p>
              <button onClick={goCabinet} className="btn-primary mt-7 w-full px-6 py-4 text-base">
                Перейти в кабинет <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}
