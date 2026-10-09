import { createHandler } from "./app.mjs";
import { createAiProxy } from "./aiProxy.mjs";
import { createHostedIdentity } from "./hostedIdentity.mjs";
import { createHostedStores } from "./hostedStores.mjs";
import { StoreError } from "./store.mjs";

/** This service owns business data and calls the platform exclusively over REST. */
export function createHostedHandler({ config, log = () => {}, fetchImpl = globalThis.fetch }) {
  const identity = createHostedIdentity(config.identity, { fetchImpl });
  const stores = createHostedStores(config.storage);
  const staticHandler = createHandler({ config: { ...config, mode: "platform" }, log });
  const accessControl = { hostAllowed: () => true, authenticate: () => "bearer" };
  const aiConfig = { enabled: true, baseUrl: config.identity.platformOrigin, manifestPath: "/mode-manifest",
    runsPath: "/v1/runs", requestTimeoutMs: 60_000, idempotentSubmit: true };

  async function handle(req, res) {
    let lease;
    try {
      const url = new URL(req.url ?? "/", config.identity.publicOrigin);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
      if (url.pathname.startsWith("/auth/platform/")) return await identity.route(req, res, url);
      if (url.pathname === "/healthz") return json(res, 200, { status: "ok", mode: "hosted" });
      if (["/runtime-config.json", "/apps/image-studio/runtime-config.json"].includes(url.pathname)) {
        if (!["GET", "HEAD"].includes(req.method)) throw new StoreError(405, "Method not allowed");
        return json(res, 200, { mode: "hosted", ai: { available: true }, platformOrigin: config.identity.platformOrigin });
      }
      const business = url.pathname.startsWith("/image-studio/") || url.pathname.startsWith("/local-ai/");
      if (business) {
        const owner = await identity.authenticate(req);
        if (!["GET", "HEAD"].includes(req.method)) identity.assertWriteOrigin(req);
        lease = stores.acquire(owner.userId);
        const ai = createAiProxy({ ai: { ...aiConfig, enabled: owner.scopes.includes("platform.ai-runs") }, store: lease.store,
          appSessionToken: owner.token, fetchImpl });
        const handler = createHandler({ config: { ...config, mode: "standalone", storage: config.storage, privateResponses: true }, store: lease.store, ai, accessControl, log });
        return await handler(req, res);
      }
      return await staticHandler(req, res);
    } catch (error) {
      if (!res.headersSent) return json(res, error instanceof StoreError ? error.status : 500,
        { detail: error instanceof StoreError ? error.message : "Image Studio request failed" });
      res.destroy();
    } finally { lease?.release(); }
  }
  return { handle, close: () => stores.close() };
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
