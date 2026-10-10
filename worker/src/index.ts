/**
 * ExcaliDash Cloudflare Worker — Hono Entrypoint
 *
 * This is the main entry point for the Cloudflare Worker.
 * It sets up the Hono app with all middleware and routes.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { v4 as uuidv4 } from "uuid";

import type { Env, AppVariables } from "./types";
import { authRoutes } from "./routes/auth/index";
import { dashboardRoutes } from "./routes/dashboard/index";
import { systemRoutes } from "./routes/system/index";
import { csrfMiddleware, csrfTokenRoute } from "./middleware/csrf";
import { authMiddleware } from "./middleware/auth";
import { onboardingGate } from "./middleware/onboarding";

// Re-export Durable Objects so wrangler can find them
export { DrawingRoom } from "./durable-objects/DrawingRoom";

// Create the Hono app with typed env and variables
const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ─── Global Middleware ───────────────────────────────────────────────────────

// Request ID
app.use("*", async (c, next) => {
  c.set("requestId", uuidv4());
  c.header("X-Request-ID", c.get("requestId"));
  await next();
});

// Security headers
app.use("*", secureHeaders());

// CORS — allow the configured frontend origin(s)
app.use("*", async (c, next) => {
  const frontendUrl = c.env.FRONTEND_URL || "";
  const origins = frontendUrl
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  // Add localhost dev origins
  if (origins.length === 0) {
    origins.push("http://localhost:5173", "http://localhost:6767");
  }

  const corsHandler = cors({
    origin: origins,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Request-ID"],
    exposeHeaders: ["X-Request-ID"],
    maxAge: 86400,
  });

  return corsHandler(c, next);
});

// ─── Health Check (before auth) ─────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));

// ─── CSRF Token Endpoint ────────────────────────────────────────────────────

app.get("/csrf-token", csrfTokenRoute);

// ─── Auth Routes (before onboarding gate) ───────────────────────────────────

app.route("/auth", authRoutes);

// ─── Onboarding Gate ────────────────────────────────────────────────────────

app.use("*", onboardingGate);

// ─── CSRF Protection (for mutating routes below) ────────────────────────────

app.use("*", csrfMiddleware);

// ─── Auth Middleware (optional — sets c.var.user if token present) ───────────

app.use("*", authMiddleware);

// ─── API Routes ─────────────────────────────────────────────────────────────

app.route("/drawings", dashboardRoutes);
app.route("/system", systemRoutes);

// ─── WebSocket Upgrade → Durable Object ─────────────────────────────────────

app.get("/ws/drawing/:id", async (c) => {
  const drawingId = c.req.param("id");
  const upgradeHeader = c.req.header("Upgrade");

  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }

  // Route to the Durable Object for this drawing
  const doId = c.env.DRAWING_ROOM.idFromName(drawingId);
  const stub = c.env.DRAWING_ROOM.get(doId);

  // Forward the request to the Durable Object
  const url = new URL(c.req.url);
  url.pathname = `/ws`;
  const newRequest = new Request(url.toString(), c.req.raw);

  return stub.fetch(newRequest);
});

// ─── 404 Fallback ───────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: "Not found" }, 404));

// ─── Error Handler ──────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error(`[${c.get("requestId")}] Error:`, err.message, err.stack);
  const status = "status" in err ? (err as any).status : 500;
  return c.json(
    { error: err.message || "Internal server error" },
    status >= 400 && status < 600 ? status : 500
  );
});

// ─── Export ─────────────────────────────────────────────────────────────────

export default app;
