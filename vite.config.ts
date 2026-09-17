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
        // Vendor chunks that only depend "downwards" (charts -> vendor), so chunks never import each
        // other in a cycle. Chart libraries load only with the lazy chart cards.
        manualChunks(rawId) {
          if (rawId.includes("commonjsHelpers")) return "vendor";
          const id = rawId.replace(/^\0/, ""); // CommonJS proxy modules follow the package they wrap
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/](d3-[^\\/]+|victory-vendor|internmap|lodash|recharts-scale|react-smooth|decimal\.js-light|eventemitter3|tiny-invariant|fast-equals)[\\/]/.test(id)) return "charts-deps";
          if (/[\\/]recharts[\\/]/.test(id)) return "charts";
          if (/i18next/.test(id)) return "i18n";
          return "vendor";
        },
      },
    },
  },
  server: {
    host: true,
    proxy: { "/api": process.env.BACKEND_URL ?? "http://127.0.0.1:8000" },
  },
});
