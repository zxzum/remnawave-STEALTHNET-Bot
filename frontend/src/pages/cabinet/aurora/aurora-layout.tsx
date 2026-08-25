import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { InitialSkeleton, LoadError } from "@/cabinet/components/Layout";
import { Toasts } from "@/cabinet/components/ui/Toasts";
import { useApp } from "@/cabinet/store/AppContext";
import { AuroraTabs } from "@/components/aurora/aurora-tabs";
import { useCabinetConfig } from "@/contexts/cabinet-config";

function hexToRgb(value: unknown): [number, number, number] {
  const match = typeof value === "string" ? /^#?([0-9a-fA-F]{6})$/.exec(value.trim()) : null;
  if (!match) return [91, 75, 232];
  const number = Number.parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function gradientEnd([r, g, b]: [number, number, number]): string {
  const mix = (value: number, target: number) => Math.round(value + (target - value) * 0.45);
  return `rgb(${mix(r, 56)} ${mix(g, 170)} ${mix(b, 225)})`;
}

export function AuroraLayout() {
  const location = useLocation();
  const config = useCabinetConfig();
  const { loading, error, reload } = useApp();
  const rgb = hexToRgb(config?.themeAccent);

  useEffect(() => {
    document.body.classList.add("cabinet-ui-active");
    return () => document.body.classList.remove("cabinet-ui-active");
  }, []);

  useEffect(() => {
    const telegram = window.Telegram?.WebApp;
    if (!telegram?.initData?.trim()) return;
    telegram.setHeaderColor?.("#ffffff");
    telegram.setBackgroundColor?.("#ffffff");
  }, []);

  return (
    <div
      aria-label={`${config?.serviceName ?? "Лазейка ВПН"} — кабинет`}
      className="tg-fs-pad relative min-h-dvh w-full overflow-x-hidden bg-[var(--au-bg)] text-[var(--au-ink)]"
      style={{
        "--au-from": `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`,
        "--au-to": gradientEnd(rgb),
        "--au-bg": "#ffffff",
        "--au-surface": "#f2f3f7",
        "--au-nav": "#f2f3f7",
        "--au-ink": "#0f1222",
        "--au-muted": "#70778e",
      } as React.CSSProperties}
    >
      <Toasts />
      <main className="relative mx-auto max-w-md px-4 pb-32 pt-4">
        {loading ? <InitialSkeleton pathname={location.pathname} /> : error ? <LoadError message={error} onRetry={reload} /> : <Outlet />}
      </main>
      <AuroraTabs />
    </div>
  );
}
