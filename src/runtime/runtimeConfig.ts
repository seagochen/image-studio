/**
 * Runtime mode contract (Issue #1). The same bundle runs in three explicit modes, and the
 * container decides which by serving /apps/image-studio/runtime-config.json:
 *
 * - "platform":   mounted by skillsmaster; identity, projects and AI come from the
 *                 platform's same-origin /auth/me, App Session and owner-scoped APIs.
 * - "standalone": the container itself serves the project API and an AI proxy that
 *                 holds the customer key server-side. No skillsmaster login.
 *
 * - "hosted":     independent app origin; the application owns identity cookies,
 *                 project storage and its REST adapter to the platform.
 *
 * A missing or malformed config is an error, never a silent fallback to either mode.
 */
export type RuntimeMode = "platform" | "standalone" | "hosted";

export interface RuntimeConfig {
  mode: RuntimeMode;
  /** Standalone only: whether the container has a usable AI configuration. */
  aiAvailable: boolean;
  platformOrigin?: string;
}

export const APP_BASE_PATH = "/apps/image-studio/";

let current: RuntimeConfig | null = null;

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Image Studio runtime config");
  const record = value as Record<string, unknown>;
  if (record.mode === "platform") return { mode: "platform", aiAvailable: true };
  if (record.mode === "hosted") {
    if (typeof record.platformOrigin !== "string") throw new Error("Hosted mode requires a platform origin");
    const url = new URL(record.platformOrigin);
    if (url.origin !== record.platformOrigin || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Invalid platform origin");
    }
    return { mode: "hosted", aiAvailable: true, platformOrigin: url.origin };
  }
  if (record.mode === "standalone") {
    const ai = record.ai as Record<string, unknown> | undefined;
    return { mode: "standalone", aiAvailable: ai?.available === true };
  }
  throw new Error("Invalid Image Studio runtime mode");
}

export async function loadRuntimeConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  const response = await fetchImpl(`${APP_BASE_PATH}runtime-config.json`, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error(`Image Studio runtime config is unavailable (${response.status})`);
  current = parseRuntimeConfig(await response.json());
  return current;
}

/** Returns the loaded runtime config. Throws when called before startup loaded it. */
export function runtimeConfig(): RuntimeConfig {
  if (!current) throw new Error("Image Studio runtime config has not been loaded");
  return current;
}

/** UI chrome helper: true only after a standalone config was loaded. */
export function isStandaloneMode(): boolean {
  return current?.mode === "standalone";
}

export function platformPage(path: string): string {
  return current?.mode === "hosted" ? `${current.platformOrigin}${path}` : path;
}

export function setRuntimeConfigForTests(config: RuntimeConfig | null): void {
  current = config;
}
