import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./src/manifest.js";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: "chrome120",
    emptyOutDir: true,
    // The microphone page is opened by URL, not referenced from the manifest, so it
    // has to be named as an entry to be built at all.
    rollupOptions: { input: { mic: "src/mic/index.html" } },
  },
});
