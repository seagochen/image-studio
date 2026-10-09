// Container entry point: `node server/index.mjs`.
import http from "node:http";
import { loadConfig, ConfigError } from "./config.mjs";
import { createHandler } from "./app.mjs";

const log = (message) => process.stdout.write(`${new Date().toISOString()} ${message}\n`);

async function main() {
  const config = loadConfig();
  let store = null;
  let ai = null;
  let hosted = null;
  if (config.mode === "hosted") {
    const { createHostedHandler } = await import("./hostedApp.mjs");
    hosted = createHostedHandler({ config, log });
  }
  if (config.mode === "standalone") {
    // Loaded lazily so platform mode never touches node:sqlite or the storage volume.
    const { openStore } = await import("./store.mjs");
    const { createAiProxy } = await import("./aiProxy.mjs");
    store = openStore(config.storage);
    const recovered = store.recover({ idempotentSubmit: config.ai.idempotentSubmit === true });
    if (Object.values(recovered).some(Boolean)) log(`startup recovery ${JSON.stringify(recovered)}`);
    ai = createAiProxy({ ai: config.ai, store });
  }

  const server = http.createServer(hosted?.handle ?? createHandler({ config, store, ai, log }));
  server.requestTimeout = 5 * 60_000;
  server.listen(config.server.port, config.server.host, () => {
    log(`image-studio listening on ${config.server.host}:${config.server.port} (mode=${config.mode})`);
    if (config.mode === "standalone") {
      log(`database=${config.storage.databasePath} storage=${config.storage.dataDir} ai=${config.ai.enabled ? "enabled" : "disabled"}`
        + ` access=${[config.access.token && "token", config.access.basicAuth && "basic-auth"].filter(Boolean).join("+") || "localhost-only"}`);
    }
  });

  const shutdown = () => {
    log("shutting down");
    server.close(() => { store?.close(); hosted?.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  process.stderr.write(`image-studio failed to start: ${error instanceof ConfigError ? error.message : error.stack ?? error}\n`);
  process.exit(1);
});
