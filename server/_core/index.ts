import express, { type Request, type Response } from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";

// ---------- Port helpers ----------
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
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

// ---------- Data shaping ----------
function extractEssentialFields(row: any) {
  return {
    timestamp: row.timestamp,
    plantId: row.plantId || row.pd_id,
    plantLabel: row.plantLabel || row.pd_name,
    pd_pvTotalPower: parseInt(row.pd_pvTotalPower) || 0,
    pd_ratedPower: parseInt(row.pd_ratedPower) || 0,
    pd_todayPv: parseFloat(row.pd_todayPv) || 0,
    pd_monthPv: parseFloat(row.pd_monthPv) || 0,
    pd_yearPv: parseFloat(row.pd_yearPv) || 0,
    pd_accPv: parseFloat(row.pd_accPv) || 0,
    pd_pvTodayIncome: parseInt(row.pd_pvTodayIncome) || 0,
    pd_monthPvIncome: parseInt(row.pd_monthPvIncome) || 0,
    pd_yearPvIncome: parseInt(row.pd_yearPvIncome) || 0,
    pd_currency: row.pd_currency || "SYP",
    pd_countryName: row.pd_countryName || "",
    pd_cityName: row.pd_cityName || "",
    pd_status: row.pd_status || "N",
    ef_emsSoc: parseInt(row.ef_emsSoc) || 0,
    ef_acTotalOutActPower: parseInt(row.ef_acTotalOutActPower) || 0,
    ef_emsPower: parseInt(row.ef_emsPower) || 0,
    ef_genPower: parseInt(row.ef_genPower) || 0,
    ef_acTtlInPower: parseInt(row.ef_acTtlInPower) || 0,
    ef_meterPower: parseInt(row.ef_meterPower) || 0,
    ef_microInvTotalPower: parseInt(row.ef_microInvTotalPower) || 0,
    ef_ctThreePhaseTotalPower:
      parseInt(row.ef_ctThreePhaseTotalPower) ||
      parseInt(row.ef_acTotalOutActPower) ||
      0,
    ef_deviceSn: row.ef_deviceSn || "",
    ef_deviceModel: row.ef_deviceModel || "",
    pd_installDateStr: row.pd_installDateStr || "",
    pd_timeZone: row.pd_timeZone || "UTC+02:00",
    pd_electricityPrice: parseInt(row.pd_electricityPrice) || 0,
    // Grid Voltage for Government Trigger
    ef_acRInVolt: parseFloat(row.ef_acRInVolt) || 0,
    // Environmental Benefits
    pd_totalReduceDeforestation:
      parseFloat(row.pd_totalReduceDeforestation) || 0,
    pd_totalCo2Less: parseFloat(row.pd_totalCo2Less) || 0,
    pd_totalSpareCoal: parseFloat(row.pd_totalSpareCoal) || 0,
  };
}

// ---------- Date helpers ----------
/** Format Date as "YYYY-MM-DD HH:mm:ss" (what your backend expects) */
function formatDateForBackend(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function isYYYYMMDD(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Returns the start/end of a requested day (local time). If day is falsy, uses "today". */
function getDayRange(day?: string): {
  startOfDay: Date;
  endOfDay: Date;
  label: string;
} {
  let base = new Date();
  let label = "today";

  if (day && typeof day === "string") {
    if (!isYYYYMMDD(day)) {
      throw new Error("INVALID_DAY_FORMAT");
    }
    // Build ISO-like local start to avoid timezone ambiguity
    const parsed = new Date(`${day}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("INVALID_DAY_VALUE");
    }
    base = parsed;
    label = day;
  }

  const startOfDay = new Date(base.getTime());
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(base.getTime());
  endOfDay.setHours(23, 59, 59, 999);

  return { startOfDay, endOfDay, label };
}

// ---------- Server ----------
async function startServer() {
  const app = express();
  const server = createServer(app);

  // Body parsers
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ---------- Energy API: /api/energy/latest ----------
  // Supports optional ?day=YYYY-MM-DD to fetch latest record within that day.
  app.get(
    "/api/energy/latest",
    async (
      req: Request<
        {},
        any,
        any,
        { plantId?: string; label?: string; day?: string }
      >,
      res: Response,
    ) => {
      try {
        const { plantId, label, day } = req.query;

        if (!plantId || !label) {
          return res.status(400).json({ error: "Missing plantId or label" });
        }

        let startOfDay: Date, endOfDay: Date, labelForLog: string;
        try {
          ({ startOfDay, endOfDay, label: labelForLog } = getDayRange(day));
        } catch (e: any) {
          if (e?.message === "INVALID_DAY_FORMAT") {
            return res
              .status(400)
              .json({ error: "Invalid 'day' format. Use YYYY-MM-DD." });
          }
          if (e?.message === "INVALID_DAY_VALUE") {
            return res
              .status(400)
              .json({ error: "Invalid 'day' value. Unable to parse date." });
          }
          throw e;
        }

        const params = new URLSearchParams({
          plantId: String(plantId),
          label: String(label),
          start: formatDateForBackend(startOfDay),
          end: formatDateForBackend(endOfDay),
          limit: "1", // latest only
          fmt: "json",
        });

        const url = `${ENV.backendUrl}/export-compact?${params.toString()}`;
        console.log(
          `[Energy API] Fetching latest for ${label} on ${labelForLog}...`,
        );

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);

        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          console.error(`[Energy API] Backend returned ${response.status}`);
          return res
            .status(500)
            .json({ error: "Failed to fetch from backend" });
        }

        const data = await response.json();

        if (data.rows && Array.isArray(data.rows)) {
          const filteredRows = data.rows.map(extractEssentialFields);
          return res.json({ rows: filteredRows });
        }

        return res.json(data);
      } catch (error) {
        console.error("[Energy API] Latest error:", error);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ---------- Energy API: /api/energy/timeseries ----------
  // Adds optional ?day=YYYY-MM-DD. If omitted, uses today.
  app.get(
    "/api/energy/timeseries",
    async (
      req: Request<
        {},
        any,
        any,
        { plantId?: string; label?: string; day?: string }
      >,
      res: Response,
    ) => {
      try {
        const { label, day } = req.query;

        let startOfDay: Date, endOfDay: Date, labelForLog: string;
        try {
          ({ startOfDay, endOfDay, label: labelForLog } = getDayRange(day));
        } catch (e: any) {
          if (e?.message === "INVALID_DAY_FORMAT") {
            return res
              .status(400)
              .json({ error: "Invalid 'day' format. Use YYYY-MM-DD." });
          }
          if (e?.message === "INVALID_DAY_VALUE") {
            return res
              .status(400)
              .json({ error: "Invalid 'day' value. Unable to parse date." });
          }
          throw e;
        }

        const params = new URLSearchParams({
          start: formatDateForBackend(startOfDay),
          end: formatDateForBackend(endOfDay),
          limit: "10000",
          fmt: "json",
        });
        if (label) params.append("label", String(label));

        const url = `${ENV.backendUrl}/export-compact?${params.toString()}`;
        console.log(
          `[Energy API] Fetching timeseries for ${label || "home"} on ${labelForLog}...`,
        );

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);

        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          console.error(`[Energy API] Backend returned ${response.status}`);
          return res
            .status(500)
            .json({ error: "Failed to fetch from backend" });
        }

        const data = await response.json();

        if (data.rows && Array.isArray(data.rows)) {
          const filteredRows = data.rows.map(extractEssentialFields);
          return res.json({ rows: filteredRows });
        }

        return res.json(data);
      } catch (error) {
        console.error("[Energy API] Timeseries error:", error);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ---------- Battery API: /api/battery/summary ----------
  app.get(
    "/api/battery/summary",
    async (
      req: Request<
        {},
        any,
        any,
        {
          deviceSn?: string;
          label?: string;
          minutes?: string;
          hours?: string;
          start?: string;
          end?: string;
          limit?: string;
        }
      >,
      res: Response,
    ) => {
      try {
        const queryParams = req.query;
        const params = new URLSearchParams();

        // Forward allowed parameters
        if (queryParams.deviceSn)
          params.append("deviceSn", queryParams.deviceSn);
        if (queryParams.label) params.append("label", queryParams.label);
        if (queryParams.minutes) params.append("minutes", queryParams.minutes);
        if (queryParams.hours) params.append("hours", queryParams.hours);
        if (queryParams.start) params.append("start", queryParams.start);
        if (queryParams.end) params.append("end", queryParams.end);
        if (queryParams.limit) params.append("limit", queryParams.limit);

        const url = `${ENV.backendUrl}/battery/summary?${params.toString()}`;
        console.log(`[Battery API] Fetching summary...`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          console.error(`[Battery API] Backend returned ${response.status}`);
          return res
            .status(response.status)
            .json({ error: "Failed to fetch from backend" });
        }

        const data = await response.json();
        return res.json(data);
      } catch (error) {
        console.error("[Battery API] Summary error:", error);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ---------- Battery API: /api/battery/details ----------
  app.get(
    "/api/battery/details",
    async (
      req: Request<
        {},
        any,
        any,
        {
          deviceSn?: string;
          label?: string;
          minutes?: string;
          hours?: string;
          start?: string;
          end?: string;
          limit?: string;
        }
      >,
      res: Response,
    ) => {
      try {
        const queryParams = req.query;
        const params = new URLSearchParams();

        // Forward allowed parameters
        if (queryParams.deviceSn)
          params.append("deviceSn", queryParams.deviceSn);
        if (queryParams.label) params.append("label", queryParams.label);
        if (queryParams.minutes) params.append("minutes", queryParams.minutes);
        if (queryParams.hours) params.append("hours", queryParams.hours);
        if (queryParams.start) params.append("start", queryParams.start);
        if (queryParams.end) params.append("end", queryParams.end);
        if (queryParams.limit) params.append("limit", queryParams.limit);

        const url = `${ENV.backendUrl}/battery/details?${params.toString()}`;
        console.log(`[Battery API] Fetching details...`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);

        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          console.error(`[Battery API] Backend returned ${response.status}`);
          return res
            .status(response.status)
            .json({ error: "Failed to fetch from backend" });
        }

        const data = await response.json();
        return res.json(data);
      } catch (error) {
        console.error("[Battery API] Details error:", error);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ---------- Grid Stats API: /stats/grid-consumption ----------
  app.get(
    "/stats/grid-consumption",
    async (
      req: Request<{}, any, any, { period?: string; date_str?: string }>,
      res: Response,
    ) => {
      try {
        const query = new URLSearchParams(req.query as any);
        const url = `${ENV.backendUrl}/stats/grid-consumption?${query.toString()}`;
        console.log(`[Grid Stats] Proxying to: ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
          return res
            .status(response.status)
            .json({ error: "Failed to fetch from backend" });
        }

        const data = await response.json();
        return res.json(data);
      } catch (error) {
        console.error("[Grid Stats] Proxy error:", error);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ---------- Cycles Summary API: /stats/cycles ----------
  app.get(
    "/stats/cycles",
    async (req: Request<{}, any, any, { limit?: string }>, res: Response) => {
      try {
        const query = new URLSearchParams(req.query as any);
        const url = `${ENV.backendUrl}/stats/cycles?${query.toString()}`;
        console.log(`[Cycles Summary] Proxying to: ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
          return res
            .status(response.status)
            .json({ error: "Failed to fetch from backend" });
        }

        const data = await response.json();
        return res.json(data);
      } catch (error) {
        console.error("[Cycles Summary] Proxy error:", error);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ---------- Pull Now API: /pull-now ----------
  app.post("/pull-now", async (_req: Request, res: Response) => {
    try {
      const url = `${ENV.backendUrl}/pull-now`;
      console.log(`[Pull Now] Proxying POST to: ${url}`);

      const response = await fetch(url, { method: "POST" });
      if (!response.ok) {
        return res
          .status(response.status)
          .json({ error: "Failed to trigger pull on backend" });
      }

      const data = await response.json();
      return res.json(data);
    } catch (error) {
      console.error("[Pull Now] Proxy error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------- tRPC ----------
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  // ---------- Dev / Prod assets ----------
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ---------- Start ----------
  const requestedPort = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : 3000;
  const port = process.env.PORT
    ? requestedPort
    : await findAvailablePort(requestedPort);

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
