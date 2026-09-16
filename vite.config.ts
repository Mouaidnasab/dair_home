import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// The FastAPI backend serves the built files and /api/v1. In dev, proxy the API to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "client", "src") },
  },
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Small, cache-friendly vendor chunks; the chart libraries only load with the lazy chart cards.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (/i18next/.test(id)) return "i18n";
          if (/[\\/](d3-[^\\/]+|victory-vendor|internmap)[\\/]/.test(id)) return "charts-d3";
          if (/[\\/](lodash|recharts-scale|react-smooth|decimal\.js-light|eventemitter3|tiny-invariant)[\\/]/.test(id)) return "charts-util";
          if (/[\\/]recharts[\\/]/.test(id)) return "charts";
          if (/@radix-ui|@floating-ui/.test(id)) return "radix";
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    proxy: { "/api": process.env.BACKEND_URL ?? "http://127.0.0.1:8000" },
  },
});
