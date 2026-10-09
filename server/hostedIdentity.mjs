import crypto from "node:crypto";
import { StoreError } from "./store.mjs";

const LOGIN_TTL_MS = 5 * 60_000;
const MAX_PENDING_LOGINS = 1000;

/** Application-owned cookies and PKCE state; platform credentials stay on the server. */
export function createHostedIdentity(identity, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const { publicOrigin, platformOrigin, moduleId } = identity;
  const secure = publicOrigin.startsWith("https:");
  const sessionCookie = secure ? "__Host-image_studio_identity" : "image_studio_identity";
  const loginCookie = secure ? "__Host-image_studio_login" : "image_studio_login";
  const pending = new Map();
  const prefix = `/platform/app-sessions/${encodeURIComponent(moduleId)}`;
  const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

  async function platform(pathname, init = {}) {
    let response;
    try {
      response = await fetchImpl(`${platformOrigin}${pathname}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    } catch { throw new StoreError(503, "Platform identity service is unavailable"); }
    if (response.status >= 500 || (response.status >= 300 && response.status < 400)) {
      throw new StoreError(503, "Platform identity service is unavailable");
    }
    return response;
  }

  async function authenticate(req) {
    const authorization = req.headers.authorization;
    const token = authorization === undefined ? readCookie(req, sessionCookie) : /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(authorization)?.[1];
    if (!token || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) throw new StoreError(401, "Platform login required");
    const response = await platform(`${prefix}/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new StoreError(401, "Platform login required");
    let owner;
    try { owner = await response.json(); } catch { throw new StoreError(503, "Platform identity response is invalid"); }
    if (owner?.appId !== moduleId || typeof owner.userId !== "string" || !owner.userId || owner.userId.length > 200
      || !Array.isArray(owner.scopes) || !owner.scopes.includes("platform.auth")
      || !owner.scopes.every((scope) => typeof scope === "string") || !(Date.parse(owner.expiresAt) > now())) {
      throw new StoreError(401, "Invalid platform identity");
    }
    return { ...owner, token };
  }

  function assertWriteOrigin(req) {
    if (req.headers.authorization !== undefined) {
      if (req.headers.origin && req.headers.origin !== publicOrigin) throw new StoreError(403, "Cross-origin request rejected");
      return;
    }
    if (req.headers.origin !== publicOrigin || ["cross-site", "same-site"].includes(req.headers["sec-fetch-site"])) {
      throw new StoreError(403, "Cross-origin request rejected");
    }
  }

  async function route(req, res, url) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (url.pathname === "/auth/platform/login" && req.method === "GET") {
      for (const [key, value] of pending) if (value.expiresAt <= now()) pending.delete(key);
      if (pending.size >= MAX_PENDING_LOGINS) throw new StoreError(429, "Too many pending logins");
      const state = crypto.randomBytes(32).toString("base64url");
      const verifier = crypto.randomBytes(48).toString("base64url");
      pending.set(state, { verifier, expiresAt: now() + LOGIN_TTL_MS,
        returnPath: safeReturnPath(url.searchParams.get("next"), publicOrigin) });
      res.setHeader("Set-Cookie", cookie(loginCookie, state, LOGIN_TTL_MS / 1000));
      const authorize = new URL(`${platformOrigin}${prefix}/authorize`);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url"));
      authorize.searchParams.set("code_challenge_method", "S256");
      res.writeHead(303, { Location: authorize.href });
      res.end();
      return;
    }
    if (url.pathname === "/auth/platform/callback" && req.method === "GET") {
      const state = url.searchParams.get("state");
      const login = state && pending.get(state);
      if (!login || login.expiresAt <= now() || readCookie(req, loginCookie) !== state) {
        throw new StoreError(401, "Invalid login callback");
      }
      pending.delete(state);
      const code = url.searchParams.get("code");
      if (!code || !/^[A-Za-z0-9_-]{20,128}$/.test(code)) throw new StoreError(401, "Invalid login callback");
      const response = await platform(`${prefix}/exchange`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, codeVerifier: login.verifier }) });
      if (!response.ok) throw new StoreError(401, "Platform login exchange failed");
      const session = await response.json();
      const maxAge = Math.floor((Date.parse(session.expiresAt) - now()) / 1000);
      if (!/^[A-Za-z0-9_-]{20,128}$/.test(session.token) || !(maxAge > 0) || maxAge > 3600) {
        throw new StoreError(503, "Invalid platform session response");
      }
      res.setHeader("Set-Cookie", [cookie(sessionCookie, session.token, maxAge), cookie(loginCookie, "", 0)]);
      res.writeHead(303, { Location: login.returnPath });
      res.end();
      return;
    }
    if (url.pathname === "/auth/platform/me" && req.method === "GET") {
      const { userId, appId, scopes, expiresAt } = await authenticate(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ userId, appId, scopes, expiresAt }));
      return;
    }
    if (url.pathname === "/auth/platform/logout" && req.method === "POST") {
      assertWriteOrigin(req);
      const owner = await authenticate(req);
      const reply = await platform(prefix, { method: "DELETE", headers: { Authorization: `Bearer ${owner.token}` } });
      if (!reply.ok && reply.status !== 401) throw new StoreError(503, "Platform logout failed");
      res.setHeader("Set-Cookie", cookie(sessionCookie, "", 0));
      res.writeHead(204); res.end(); return;
    }
    throw new StoreError(404, "Not found");
  }

  return { authenticate, assertWriteOrigin, route };
}

function readCookie(req, name) {
  const cookies = String(req.headers.cookie ?? "").split(";");
  return cookies.map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function safeReturnPath(value, origin) {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin || target.pathname.startsWith("/auth/platform/")) return "/";
    return target.pathname + target.search + target.hash;
  } catch { return "/"; }
}
