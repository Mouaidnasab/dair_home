// server/_core/index.ts
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  isProduction: process.env.NODE_ENV === "production"
};

// server/_core/notification.ts
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers/energy.ts
import { z as z2 } from "zod";
var BACKEND_API = "https://dair.drd-home.online";
async function fetchEnergyData(endpoint, params) {
  const searchParams = new URLSearchParams(params);
  const url = `${BACKEND_API}${endpoint}?${searchParams.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch from ${endpoint}: ${response.statusText}`);
  }
  return response.json();
}
var energyRouter = router({
  /**
   * Get latest data for a specific inverter
   */
  getLatest: publicProcedure.input(
    z2.object({
      plantId: z2.string(),
      label: z2.string()
    })
  ).query(async ({ input }) => {
    const data = await fetchEnergyData("/export-compact", {
      plantId: input.plantId,
      label: input.label,
      limit: "1",
      fmt: "json",
      dedupe: "true"
    });
    if (!data.rows || data.rows.length === 0) {
      throw new Error(`No data returned for ${input.label}`);
    }
    return data.rows[0];
  }),
  /**
   * Get time-series data for trends
   */
  getTimeSeries: publicProcedure.input(
    z2.object({
      plantId: z2.string(),
      label: z2.string().optional(),
      hours: z2.number().default(24)
    })
  ).query(async ({ input }) => {
    const params = {
      plantId: input.plantId,
      fmt: "json",
      limit: String(Math.ceil(input.hours * 60 / 5)),
      // 5-min intervals
      dedupe: "true",
      hours: String(input.hours)
    };
    if (input.label) {
      params.label = input.label;
    }
    const data = await fetchEnergyData("/export-compact", params);
    if (!data.rows) {
      return [];
    }
    return data.rows;
  })
});

// server/routers.ts
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  energy: energyRouter
});

// server/_core/context.ts
async function createContext(opts) {
  return {
    req: opts.req,
    res: opts.res
  };
}

// server/_core/vite.ts
import express from "express";
import fs from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
function extractEssentialFields(row) {
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
    ef_ctThreePhaseTotalPower: parseInt(row.ef_ctThreePhaseTotalPower) || parseInt(row.ef_acTotalOutActPower) || 0,
    ef_deviceSn: row.ef_deviceSn || "",
    ef_deviceModel: row.ef_deviceModel || "",
    pd_installDateStr: row.pd_installDateStr || "",
    pd_timeZone: row.pd_timeZone || "UTC+02:00",
    pd_electricityPrice: parseInt(row.pd_electricityPrice) || 0
  };
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  function formatDateForBackend(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
  app.get("/api/energy/latest", async (req, res) => {
    try {
      const { plantId, label } = req.query;
      if (!plantId || !label) {
        return res.status(400).json({ error: "Missing plantId or label" });
      }
      const now = /* @__PURE__ */ new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      const params = new URLSearchParams({
        plantId: String(plantId),
        label: String(label),
        start: formatDateForBackend(startOfDay),
        end: formatDateForBackend(endOfDay),
        limit: "1",
        fmt: "json"
      });
      const url = `https://dair.drd-home.online/export?${params.toString()}`;
      console.log(`[Energy API] Fetching latest for ${label}...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15e3);
      const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) {
        console.error(`[Energy API] Backend returned ${response.status}`);
        return res.status(500).json({ error: "Failed to fetch from backend" });
      }
      const data = await response.json();
      if (data.rows && Array.isArray(data.rows)) {
        const filteredRows = data.rows.map(extractEssentialFields);
        return res.json({ rows: filteredRows });
      }
      res.json(data);
    } catch (error) {
      console.error("[Energy API] Latest error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  app.get("/api/energy/timeseries", async (req, res) => {
    try {
      const { plantId, label } = req.query;
      if (!plantId) {
        return res.status(400).json({ error: "Missing plantId" });
      }
      const now = /* @__PURE__ */ new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      const params = new URLSearchParams({
        plantId: String(plantId),
        start: formatDateForBackend(startOfDay),
        end: formatDateForBackend(endOfDay),
        limit: "1000",
        fmt: "json"
      });
      if (label) {
        params.append("label", String(label));
      }
      const url = `https://dair.drd-home.online/export?${params.toString()}`;
      console.log(`[Energy API] Fetching timeseries for ${label || "home"}...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2e4);
      const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) {
        console.error(`[Energy API] Backend returned ${response.status}`);
        return res.status(500).json({ error: "Failed to fetch from backend" });
      }
      const data = await response.json();
      if (data.rows && Array.isArray(data.rows)) {
        const filteredRows = data.rows.map(extractEssentialFields);
        return res.json({ rows: filteredRows });
      }
      res.json(data);
    } catch (error) {
      console.error("[Energy API] Timeseries error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
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
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
