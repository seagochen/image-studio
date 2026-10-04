// Fails when the built browser bundle contains server-only credential plumbing (#7).
// The customer key is read and sent only by the container (server/aiProxy.mjs); the
// bundle must never reference the header, the config fields or a key file.
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN = [/x-customer-key/i, /customerKeyFile/, /customerKeyEnv/, /SKILLSMASTER_CUSTOMER_KEY/, /skillsmaster-api-key/, /access\.tokenFile/];
const root = path.resolve(process.argv[2] ?? "dist");
if (!fs.existsSync(root)) {
  console.error(`check-bundle: ${root} does not exist; run npm run build first`);
  process.exit(1);
}
const findings = [];
for (const file of fs.readdirSync(root, { recursive: true })) {
  const full = path.join(root, file);
  if (!fs.statSync(full).isFile()) continue;
  const text = fs.readFileSync(full, "latin1");
  for (const pattern of FORBIDDEN) if (pattern.test(text)) findings.push(`${file}: ${pattern}`);
}
if (findings.length) {
  console.error(`check-bundle: server-only credential references in the browser bundle:\n  ${findings.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-bundle: ${root} is free of server-only credential references`);
