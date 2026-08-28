import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, KeyRound, ShieldCheck, Wallet, X } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api, type PublicConfig } from "@/lib/api";
import { Background } from "../components/Layout";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/cn";

function FlowShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add("cabinet-ui-active");
    return () => document.body.classList.remove("cabinet-ui-active");
  }, []);
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4 py-8">
      <Background />
      <motion.main initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-strong liquid relative z-10 w-full max-w-md rounded-4xl p-6 text-center sm:p-8">
        {children}
      </motion.main>
    </div>
  );
}

function StatusIcon({ state }: { state: "loading" | "ok" | "error" }) {
  return (
    <div className={`mx-auto grid h-16 w-16 place-items-center rounded-2xl border ${state === "ok" ? "border-mint-400/30 bg-mint-500/15 text-mint-400" : state === "error" ? "border-red-400/30 bg-red-500/15 text-red-400" : "icon-tile"}`}>
      {state === "ok" ? <Check className="h-7 w-7" /> : state === "error" ? <X className="h-7 w-7" /> : <KeyRound className="h-7 w-7 animate-pulse" />}
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.clientForgotPassword(email.trim());
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отправить письмо");
    } finally {
      setLoading(false);
    }
  };
  return (
    <FlowShell>
      <StatusIcon state={sent ? "ok" : "loading"} />
      <h1 className="mt-5 text-2xl font-extrabold sm:text-3xl">{sent ? "Проверьте почту" : "Забыли пароль?"}</h1>
      <p className="mt-2 text-sm text-fog-500">{sent ? "Если аккаунт существует, ссылка для сброса уже отправлена и действует один час." : "Введите email — пришлём безопасную ссылку для сброса."}</p>
      {!sent && (
        <form onSubmit={submit}>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="mt-6" autoFocus />
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <Button type="submit" size="lg" loading={loading} loadingText="Отправляем…" className="mt-4 w-full">Отправить ссылку</Button>
        </form>
      )}
      <Link to="/cabinet/login" className="mt-5 inline-block text-sm font-semibold text-fog-500 hover:text-accent-400">Вернуться ко входу</Link>
    </FlowShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password !== confirm) return setError(password.length < 8 ? "Пароль минимум 8 символов" : "Пароли не совпадают");
    setLoading(true);
    setError("");
    try {
      await api.clientResetPassword(token, password);
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сменить пароль");
    } finally {
      setLoading(false);
    }
  };
  return (
    <FlowShell>
      <StatusIcon state={!token ? "error" : done ? "ok" : "loading"} />
      <h1 className="mt-5 text-2xl font-extrabold sm:text-3xl">{!token ? "Ссылка недействительна" : done ? "Пароль изменён" : "Новый пароль"}</h1>
      {!token ? (
        <Link to="/cabinet/forgot-password" className={cn(buttonVariants({ size: "lg" }), "mt-6")}>Запросить новую ссылку</Link>
      ) : done ? (
        <Button size="lg" className="mt-6 w-full" onClick={() => navigate("/cabinet/login", { replace: true })}>Перейти ко входу</Button>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <Input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Новый пароль" />
          <Input type="password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Повторите пароль" />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" size="lg" loading={loading} loadingText="Сохраняем…" className="w-full">Сменить пароль</Button>
        </form>
      )}
    </FlowShell>
  );
}

function Verification({ linkEmail = false }: { linkEmail?: boolean }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { verifyEmail, verifyLinkEmail } = useClientAuth();
  const token = params.get("token");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("Проверяем защищённую ссылку…");
  const [registration, setRegistration] = useState<{ registrationToken: string; email: string } | null>(null);
  useEffect(() => {
    if (!token) { setStatus("error"); setMessage("Ссылка недействительна"); return; }
    const verify = linkEmail ? verifyLinkEmail : verifyEmail;
    void verify(token).then((result) => {
      if (!linkEmail && result && "registrationToken" in result) setRegistration(result);
      setStatus("ok");
      setMessage(linkEmail ? "Почта успешно привязана" : result && "registrationToken" in result ? "Email подтверждён, создайте пароль" : "Email подтверждён, аккаунт готов");
    }).catch((cause) => {
      setStatus("error");
      setMessage(cause instanceof Error ? cause.message : "Ссылка недействительна или истекла");
    });
  }, [linkEmail, token, verifyEmail, verifyLinkEmail]);
  const continuePath = linkEmail
    ? "/cabinet/profile"
    : registration
      ? `/cabinet/register?registrationToken=${encodeURIComponent(registration.registrationToken)}&email=${encodeURIComponent(registration.email)}`
      : "/cabinet/dashboard";
  return <FlowShell><StatusIcon state={status} /><h1 className="mt-5 text-2xl font-extrabold sm:text-3xl">{linkEmail ? "Привязка почты" : "Подтверждение email"}</h1><p className={`mt-3 text-sm ${status === "error" ? "text-red-400" : "text-fog-500"}`}>{message}</p>{status === "ok" && <Button size="lg" className="mt-6 w-full" onClick={() => navigate(continuePath, { replace: true })}>Продолжить</Button>}</FlowShell>;
}

export function VerifyEmail() { return <Verification />; }
export function VerifyLinkEmail() { return <Verification linkEmail />; }

export function Onboarding() {
  const navigate = useNavigate();
  const { state, refreshProfile } = useClientAuth();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { void api.getPublicConfig().then(setConfig).catch(() => undefined); }, []);
  const finish = async () => {
    if (!state.token) return;
    await api.clientCompleteOnboarding(state.token);
    await refreshProfile();
    navigate("/cabinet/dashboard", { replace: true });
  };
  const next = async () => {
    if (!state.token || !config) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (!state.client?.email && email.trim()) {
        if (config.skipEmailVerification || !config.smtpConfigured) await api.clientLinkEmailDirect(state.token, { email: email.trim() });
        else { await api.clientLinkEmailRequest(state.token, { email: email.trim() }); setNotice("Проверьте почту и подтвердите адрес"); return; }
        await refreshProfile();
      }
      if (password) await api.clientSetPassword(state.token, { newPassword: password });
      await finish();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки");
    } finally {
      setLoading(false);
    }
  };
  return <FlowShell><form onSubmit={(event) => { event.preventDefault(); void next(); }}><div className="icon-tile mx-auto h-16 w-16 rounded-2xl"><ShieldCheck className="h-7 w-7" /></div><h1 className="mt-5 text-2xl font-extrabold sm:text-3xl">Настройка аккаунта</h1><p className="mt-2 text-sm text-fog-500">Почту, пароль и 2FA можно настроить позже в профиле.</p>{!state.client?.email && <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (необязательно)" className="mt-6" />}<Input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль (необязательно)" className="mt-3" /><Button type="submit" size="lg" loading={loading} loadingText="Сохраняем…" disabled={!config} className="mt-4 w-full">Продолжить</Button>{notice && <p className="mt-3 rounded-xl border border-mint-400/30 bg-mint-500/10 px-3 py-2 text-sm font-medium text-mint-300">{notice}</p>}{error && <p className="mt-3 text-sm text-red-400">{error}</p>}</form></FlowShell>;
}

export function PaymentWait() {
  const [params] = useSearchParams();
  const location = useLocation();
  const { state, refreshProfile } = useClientAuth();
  const paymentId = params.get("id");
  const paymentState = location.state as { url?: string; returnPath?: string } | null;
  const providerUrl = paymentState?.url;
  const returnPath = paymentState?.returnPath || (params.get("kind") === "topup" ? "/cabinet/profile" : "/cabinet/tariffs");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    if (!paymentId || !state.token) { setStatus("error"); return; }
    let active = true;
    let timeout = 0;
    const check = async () => {
      try {
        const result = await api.getPaymentStatus(state.token!, paymentId);
        if (!active) return;
        if (result.status === "PAID" && result.fulfilled) { setStatus("ok"); await refreshProfile(); return; }
        if (result.status === "FAILED") { setStatus("error"); return; }
      } catch { /* transient provider delay */ }
      if (active) timeout = window.setTimeout(check, 3000);
    };
    void check();
    return () => { active = false; window.clearTimeout(timeout); };
  }, [paymentId, refreshProfile, state.token]);
  return <FlowShell><StatusIcon state={status} /><h1 className="mt-5 text-2xl font-extrabold sm:text-3xl">{status === "loading" ? "Ожидаем оплату…" : status === "ok" ? "Оплата прошла" : "Платёж не прошёл"}</h1><p className="mt-2 text-sm text-fog-500">{status === "loading" ? "Страница обновится автоматически после подтверждения платёжной системой." : status === "ok" ? "Баланс и подписки уже обновлены." : "Попробуйте ещё раз или выберите другой способ оплаты."}</p>{status === "loading" && providerUrl && <a href={providerUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ size: "lg" }), "mt-6 w-full")}>Открыть оплату снова</a>}<Link to={status === "error" ? returnPath : "/cabinet/dashboard"} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "mt-3 w-full")}>Вернуться в кабинет</Link></FlowShell>;
}

type YooMoneyForm = { receiver: string; sum: number; label: string; paymentType: string; successURL: string };
export function YooMoneyPay() {
  const [params] = useSearchParams();
  const location = useLocation();
  const { state } = useClientAuth();
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);
  const initial = (location.state as { form?: YooMoneyForm } | null)?.form ?? null;
  const [form, setForm] = useState<YooMoneyForm | null>(initial);
  const [error, setError] = useState("");
  useEffect(() => {
    const id = params.get("paymentId");
    if (form || !id || !state.token) return;
    void api.yoomoneyFormPaymentParams(state.token, id).then(setForm).catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить платёж"));
  }, [form, params, state.token]);
  useEffect(() => { if (form && formRef.current && !submitted.current) { submitted.current = true; formRef.current.submit(); } }, [form]);
  return <FlowShell><div className="icon-tile mx-auto h-16 w-16 rounded-2xl"><Wallet className="h-7 w-7" /></div><h1 className="mt-5 text-2xl font-extrabold sm:text-3xl">Открываем ЮMoney…</h1><p className={`mt-2 text-sm ${error ? "text-red-400" : "text-fog-500"}`}>{error || "Безопасная форма оплаты откроется автоматически."}</p>{form && <form ref={formRef} action="https://yoomoney.ru/quickpay/confirm" method="POST" className="hidden"><input name="quickpay-form" value="button" readOnly /><input name="receiver" value={form.receiver} readOnly /><input name="sum" value={form.sum} readOnly /><input name="label" value={form.label} readOnly /><input name="paymentType" value={form.paymentType} readOnly /><input name="successURL" value={form.successURL} readOnly /></form>}</FlowShell>;
}
