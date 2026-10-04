// Standalone access control.
//
// Without configured credentials the container is a localhost single-user editor: it
// only answers requests whose Host is a loopback name (which also defeats DNS
// rebinding). Remote access requires access.tokenFile (or basicAuth). Browsers exchange
// the token once for an HttpOnly, SameSite=Strict session cookie; scripts send it as
// `Authorization: Bearer <token>`. Cookie-authenticated writes must prove they come
// from the same origin.
import crypto from "node:crypto";

export const SESSION_COOKIE = "image_studio_session";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const MAX_FAILURES_PER_MINUTE = 10;

export function createAccessControl(access, { now = Date.now } = {}) {
  const { basicAuth, token, allowedHosts = [], sessionHours = 12, secureCookie = false } = access ?? {};
  const protectedMode = Boolean(basicAuth || token);
  const sessionKey = token ? crypto.createHmac("sha256", token).update("image-studio-session-v1").digest() : null;
  const failures = new Map();

  function sign(payload) {
    return crypto.createHmac("sha256", sessionKey).update(payload).digest("base64url");
  }

  function issueSession() {
    const expires = Math.floor(now() / 1000) + sessionHours * 3600;
    const payload = `v1.${expires}.${crypto.randomBytes(16).toString("base64url")}`;
    return { value: `${payload}.${sign(payload)}`, maxAge: sessionHours * 3600 };
  }

  function validSession(req) {
    if (!sessionKey) return false;
    const value = readCookie(req, SESSION_COOKIE);
    if (!value) return false;
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return false;
    const payload = parts.slice(0, 3).join(".");
    if (!safeEqual(parts[3], sign(payload))) return false;
    const expires = Number(parts[1]);
    return Number.isInteger(expires) && expires * 1000 > now();
  }

  function cookieHeader(value, maxAge) {
    return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secureCookie ? "; Secure" : ""}`;
  }

  return {
    protectedMode,
    tokenLogin: Boolean(token),
    basicAuth: Boolean(basicAuth),

    /** Host allow-list for an unprotected installation. */
    hostAllowed(req) {
      if (protectedMode) return true;
      const host = hostName(req.headers.host);
      return host !== null && (LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost") || allowedHosts.includes(host));
    },

    /** Returns "open" | "basic" | "bearer" | "session" | null (unauthenticated). */
    authenticate(req) {
      if (!protectedMode) return "open";
      const header = String(req.headers.authorization ?? "");
      if (basicAuth && header.startsWith("Basic ") && basicMatches(header, basicAuth)) return "basic";
      if (token && header.startsWith("Bearer ") && safeEqual(header.slice(7).trim(), token)) return "bearer";
      if (validSession(req)) return "session";
      return null;
    },

    /** Exchanges the access token for a session cookie. Throws { status, message } on failure. */
    login(req, submitted) {
      if (!token) throw accessError(404, "Token login is not enabled");
      if (!sameOrigin(req)) throw accessError(403, "Cross-origin request rejected");
      const client = req.socket?.remoteAddress ?? "unknown";
      const minute = Math.floor(now() / 60_000);
      const record = failures.get(client);
      if (record && record.minute === minute && record.count >= MAX_FAILURES_PER_MINUTE) {
        throw accessError(429, "Too many failed attempts; wait a minute and try again");
      }
      if (typeof submitted !== "string" || !safeEqual(submitted.trim(), token)) {
        failures.set(client, { minute, count: record?.minute === minute ? record.count + 1 : 1 });
        if (failures.size > 10_000) failures.clear();
        throw accessError(401, "The access token is not valid");
      }
      failures.delete(client);
      const session = issueSession();
      return cookieHeader(session.value, session.maxAge);
    },

    logoutCookie() {
      return cookieHeader("", 0);
    },
  };
}

/** Strict same-origin proof for state-changing requests carrying ambient credentials. */
export function sameOrigin(req) {
  const site = req.headers["sec-fetch-site"];
  if (site === "cross-site" || site === "same-site") return false;
  const origin = req.headers.origin;
  if (origin) {
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }
  return site === "same-origin";
}

function accessError(status, message) {
  return Object.assign(new Error(message), { status });
}

function hostName(host) {
  if (typeof host !== "string" || !host) return null;
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 0 ? value.slice(0, end + 1) : null;
  }
  return value.split(":")[0] || null;
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function basicMatches(header, { username, password }) {
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  // Evaluate both comparisons so timing does not reveal which part was wrong.
  const userOk = safeEqual(decoded.slice(0, separator), username);
  const passwordOk = safeEqual(decoded.slice(separator + 1), password);
  return userOk && passwordOk;
}

function safeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a)).digest();
  const right = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

/** Minimal sign-in page shown to browsers before they hold a session. */
export function loginPage(basePath) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image Studio — sign in</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f4f5; color: #18181b; }
  form { background: #fff; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px #0002; width: min(360px, calc(100vw - 32px)); display: grid; gap: 12px; }
  input, button { font: inherit; padding: 8px 10px; border-radius: 6px; border: 1px solid #d4d4d8; }
  button { background: #18181b; color: #fff; cursor: pointer; }
  p[role=alert] { color: #b91c1c; margin: 0; min-height: 1.5em; }
  @media (prefers-color-scheme: dark) { body { background: #18181b; color: #f4f4f5; } form { background: #27272a; } input { background: #18181b; color: inherit; border-color: #3f3f46; } button { background: #f4f4f5; color: #18181b; } }
</style></head>
<body><form id="login">
  <h1 style="margin:0;font-size:20px">Image Studio</h1>
  <label for="token">Access token</label>
  <input id="token" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Sign in</button>
  <p role="alert" id="error"></p>
</form>
<script>
  document.getElementById("login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("error");
    error.textContent = "";
    const response = await fetch(${JSON.stringify(`${basePath}/session`)}, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ token: document.getElementById("token").value }),
    }).catch(() => null);
    if (response && response.ok) return location.reload();
    const body = response ? await response.json().catch(() => ({})) : {};
    error.textContent = body.detail || "Sign-in failed";
  });
</script></body></html>`;
}
