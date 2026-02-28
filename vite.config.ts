import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "../../dist",
    rollupOptions: {
      output: {
        // Split large libraries into separate chunks for better caching
        // and faster initial parse time
        manualChunks: {
          recharts: ["recharts"],
          "tanstack-table": ["@tanstack/react-table"],
        },
      },
    },
  },
  plugins: [
    tanstackRouter({
      // Paths are relative to the vite root (src/mainview)
      routesDirectory: "./routes",
      generatedRouteTree: "./routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],
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
    proxy: {
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
      },
    },
  },
});
