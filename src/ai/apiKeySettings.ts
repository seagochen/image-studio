/**
 * Standalone-only client for Settings → API Key. The container stores the
 * skillsmaster.jp customer key server-side; responses carry only a short hint
 * (last four characters), never the key itself.
 */
export interface AiKeySettings {
  enabled: boolean;
  baseUrl: string | null;
  keySource: "none" | "settings" | "config";
  keyHint: string | null;
  editable: boolean;
  reason?: string;
  verified?: boolean;
  warning?: string;
}

const SETTINGS_URL = "/local-ai/settings";

export async function fetchAiKeySettings(signal?: AbortSignal): Promise<AiKeySettings> {
  return parse(await fetch(SETTINGS_URL, { signal, cache: "no-store" }));
}

export async function saveAiApiKey(apiKey: string): Promise<AiKeySettings> {
  return parse(await fetch(`${SETTINGS_URL}/api-key`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }),
  }));
}

export async function deleteAiApiKey(): Promise<AiKeySettings> {
  return parse(await fetch(`${SETTINGS_URL}/api-key`, { method: "DELETE" }));
}

async function parse(response: Response): Promise<AiKeySettings> {
  let body: Record<string, unknown> = {};
  try { body = await response.json() as Record<string, unknown>; } catch { /* handled below */ }
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Request failed: ${response.status}`);
  return body as unknown as AiKeySettings;
}
