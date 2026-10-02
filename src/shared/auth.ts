import { api } from "./api";
import { loginPath } from "./navigation";

let appSession: { appId: string; token: string; expiresAt: string; scopes: string[] } | null = null;

export async function requireUser(nextPath: string, appId?: string): Promise<boolean> {
  const response = await api("GET", "/auth/me");
  if (response.ok) {
    if (appId) await issueAppSession(appId);
    return true;
  }
  window.location.replace(loginPath(nextPath));
  return false;
}

export function appSessionHeaders(appId?: string): Record<string, string> {
  if (!appSession || (appId && appSession.appId !== appId) || Date.parse(appSession.expiresAt) <= Date.now()) return {};
  return { Authorization: `Bearer ${appSession.token}` };
}

async function issueAppSession(appId: string): Promise<void> {
  const response = await api<{ token: string; expiresAt: string; scopes: string[] }>("POST", `/platform/app-sessions/${encodeURIComponent(appId)}`);
  if (response.ok && response.data && typeof response.data.token === "string") {
    appSession = { appId, token: response.data.token, expiresAt: response.data.expiresAt, scopes: response.data.scopes };
  }
}
