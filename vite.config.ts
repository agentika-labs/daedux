import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "../../dist",
  },
  plugins: [react(), tailwindcss()],
  publicDir: "../../public",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src/mainview", import.meta.url)),
      "@shared": fileURLToPath(new URL("src/shared", import.meta.url)),
    },
  },
  root: "src/mainview",
  server: {
    port: 5173,
    strictPort: true,
  },
});
