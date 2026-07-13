import type { PublicConfig } from "@/lib/api";

export type PublicBootstrapConfig = Pick<
  PublicConfig,
  | "serviceName"
  | "logo"
  | "favicon"
  | "cabinetDesign"
  | "cabinetDesignApplyInBrowser"
  | "publicAppUrl"
  | "stealthAccent"
  | "stealthHeroImage"
>;

declare global {
  interface Window {
    __STEALTH_BOOTSTRAP__?: PublicBootstrapConfig;
  }
}

/** Critical settings emitted by the server before CSS and React execute. */
export function readPublicBootstrap(): PublicBootstrapConfig | null {
  if (typeof window === "undefined") return null;
  return window.__STEALTH_BOOTSTRAP__ ?? null;
}
