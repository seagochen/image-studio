import type { RuntimeConfig } from "./runtimeConfig";

export interface StartupDependencies {
  loadConfig: () => Promise<RuntimeConfig>;
  /** Platform only: resolves false after redirecting to the skillsmaster login. */
  requireUser: () => Promise<boolean>;
  render: (config: RuntimeConfig) => void;
  showError: (message: string) => void;
}

export type StartupOutcome = "rendered" | "config-error" | "login-required";

/**
 * Startup sequence for both runtime modes (#5). The mode comes only from the runtime
 * config; a missing or invalid config stops startup, and a failed platform login only
 * leads to the platform login flow, never to the standalone editor or its local API.
 */
export async function startImageStudio(dependencies: StartupDependencies): Promise<StartupOutcome> {
  let config: RuntimeConfig;
  try {
    config = await dependencies.loadConfig();
  } catch (error) {
    dependencies.showError(`Image Studio could not start: ${(error as Error).message}`);
    return "config-error";
  }
  if (config.mode !== "standalone" && !(await dependencies.requireUser())) return "login-required";
  dependencies.render(config);
  return "rendered";
}
