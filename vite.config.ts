import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

// The bundle is identical for both runtime modes; the container decides the mode at
// runtime through /apps/image-studio/runtime-config.json (see src/runtime/runtimeConfig.ts).
// In development every backend route is proxied to IMAGE_STUDIO_DEV_BACKEND: either a
// local skillsmaster (platform mode) or `docker compose up` / `npm start` (standalone).
const backend = process.env.IMAGE_STUDIO_DEV_BACKEND ?? "http://127.0.0.1:3000";

export default defineConfig({
  root: __dirname,
  base: "/apps/image-studio/",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries([
      "/apps/image-studio/runtime-config.json", "/auth", "/icons.svg", "/image-studio", "/local-ai", "/mode-manifest", "/v1",
    ].map((route) => [route, backend])),
  },
});
