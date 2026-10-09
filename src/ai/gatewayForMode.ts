import type { AiRunGateway } from "./types";
import { HttpAiRunGateway, PLATFORM_MODE_MANIFEST_URL } from "./httpGateway";
import { STANDALONE_MODE_MANIFEST_URL, StandaloneAiRunGateway } from "./standaloneGateway";
import { runtimeConfig } from "../runtime/runtimeConfig";

/** Selects the AI adapter for the explicit runtime mode; there is no cross-mode fallback. */
export function createAiRunGateway(): AiRunGateway {
  return runtimeConfig().mode !== "platform" ? new StandaloneAiRunGateway() : new HttpAiRunGateway();
}

export function modeManifestUrl(): string {
  return runtimeConfig().mode !== "platform" ? STANDALONE_MODE_MANIFEST_URL : PLATFORM_MODE_MANIFEST_URL;
}
