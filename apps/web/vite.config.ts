import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the site runs on Vite and proxies the API, so the browser sees ONE
// origin — which is what lets the httpOnly refresh cookie work exactly as it does in
// production, where the server serves the built site itself.
export default defineConfig({
  plugins: [react()],
  build: { target: "es2022", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/health": "http://localhost:8787",
    },
  },
});
