import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Helper to format date as YYYY-MM-DD HH:MM:SS
  function formatDateForBackend(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  // Energy API proxy route - fetch latest data for today
  app.get("/api/energy/latest", async (req, res) => {
    try {
      const { plantId, label } = req.query;
      if (!plantId || !label) {
        return res.status(400).json({ error: "Missing plantId or label" });
      }

      // Get today's date range
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      // Build URL with proper encoding
      const params = new URLSearchParams({
        plantId: String(plantId),
        label: String(label),
        start: formatDateForBackend(startOfDay),
        end: formatDateForBackend(endOfDay),
        limit: "1000",
        fmt: "json",
      });

      const url = `https://dair.drd-home.online/export?${params.toString()}`;
      console.log(`[Energy API] Fetching latest: ${url.substring(0, 80)}...`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        console.error(`[Energy API] Backend returned ${response.status}`);
        return res.status(500).json({ error: "Failed to fetch from backend" });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("[Energy API] Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Energy API proxy route - fetch time-series data for today
  app.get("/api/energy/timeseries", async (req, res) => {
    try {
      const { plantId, label } = req.query;
      if (!plantId) {
        return res.status(400).json({ error: "Missing plantId" });
      }

      // Get today's date range
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const params = new URLSearchParams({
        plantId: String(plantId),
        start: formatDateForBackend(startOfDay),
        end: formatDateForBackend(endOfDay),
        limit: "1000",
        fmt: "json",
      });

      if (label) {
        params.append("label", String(label));
      }

      const url = `https://dair.drd-home.online/export?${params.toString()}`;
      console.log(`[Energy API] Fetching timeseries: ${url.substring(0, 80)}...`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        console.error(`[Energy API] Backend returned ${response.status}`);
        return res.status(500).json({ error: "Failed to fetch from backend" });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("[Energy API] Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = await findAvailablePort();
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

