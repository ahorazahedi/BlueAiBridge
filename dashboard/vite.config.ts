import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The broker serves the built dashboard from dist/dashboard.
// `npm run dev:ui` proxies the API to a running broker (BLUE_AI_BRIDGE_PORT, default 7600).
const port = Number(process.env.BLUE_AI_BRIDGE_PORT ?? 7600);
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  base: "/",
  plugins: [react()],
  build: { outDir: path.resolve(import.meta.dirname, "../dist/dashboard"), emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { port: 5173, proxy: { "/api": `http://127.0.0.1:${port}`, "/auth": `http://127.0.0.1:${port}` } },
});
