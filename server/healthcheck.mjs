// Docker HEALTHCHECK: probes /healthz on the port the active config listens on.
import http from "node:http";
import { loadConfig } from "./config.mjs";

let port;
try { port = loadConfig().server.port; } catch { process.exit(1); }

const request = http.get({ host: "127.0.0.1", port, path: "/healthz", timeout: 3000 }, (response) => {
  response.resume();
  process.exit(response.statusCode === 200 ? 0 : 1);
});
request.on("timeout", () => { request.destroy(); process.exit(1); });
request.on("error", () => process.exit(1));
