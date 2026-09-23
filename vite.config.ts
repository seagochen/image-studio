import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

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
    proxy: { "/auth": "http://127.0.0.1:3000", "/icons.svg": "http://127.0.0.1:3000" },
  },
});
