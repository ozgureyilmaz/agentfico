import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/v1": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      "/healthz": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
});
