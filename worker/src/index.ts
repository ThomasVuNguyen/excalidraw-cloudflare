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
import drawingsRouter from "./routes/dashboard/drawings";
import collectionsRouter from "./routes/dashboard/collections";
import libraryRouter from "./routes/dashboard/library";
import { systemRoutes } from "./routes/system/index";
import { migrationRouter } from "./routes/system/migration";
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

// CORS — allow configured frontend origin(s) + same-origin requests
app.use("*", async (c, next) => {
  const frontendUrl = c.env.FRONTEND_URL || "";
  const origins = frontendUrl
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  // Add standard origins
  origins.push(
    "https://draw.beenex.company",
    "https://api.draw.beenex.company",
    "http://localhost:5173",
    "http://localhost:8787"
  );

  const corsHandler = cors({
    origin: origins,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "x-csrf-token", "X-Request-ID", "X-Imported-File"],
    exposeHeaders: ["X-Request-ID", "x-csrf-token"],
    maxAge: 86400,
  });

  return corsHandler(c, next);
});

// ─── Authentication Middleware ───────────────────────────────────────────────
// Identifies authenticated user from JWT cookie or Authorization header
app.use("*", authMiddleware);

// ─── Health Check & CSRF (before auth & onboarding) ──────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/csrf-token", csrfTokenRoute);
app.get("/api/csrf-token", csrfTokenRoute);

// ─── Auth Routes (before onboarding gate) ───────────────────────────────────

app.route("/auth", authRoutes);
app.route("/api/auth", authRoutes);

app.route("/migrate", migrationRouter);
app.route("/api/migrate", migrationRouter);

// ─── WebSocket Upgrade → Durable Object ─────────────────────────────────────

const handleWsUpgrade = async (c: any) => {
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
};

app.get("/ws/drawing/:id", handleWsUpgrade);
app.get("/api/ws/drawing/:id", handleWsUpgrade);

// ─── Onboarding Gate and CSRF Protection ────────────────────────────────────

app.use("*", onboardingGate);
app.use("*", csrfMiddleware);

// ─── Application API Routes ─────────────────────────────────────────────────

app.route("/drawings", drawingsRouter);
app.route("/api/drawings", drawingsRouter);

app.route("/collections", collectionsRouter);
app.route("/api/collections", collectionsRouter);

app.route("/library", libraryRouter);
app.route("/api/library", libraryRouter);

app.route("/system", systemRoutes);
app.route("/api/system", systemRoutes);

// ─── Fallback (Assets / 404) ────────────────────────────────────────────────

app.notFound(async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ error: "Not found" }, 404);
});

// ─── Error Handler ──────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error(`[${c.get("requestId")}] Error:`, err.message, err.stack);
  const status = "status" in err ? (err as any).status : 500;
  return c.json(
    { error: err.message || "Internal server error" },
    status >= 400 && status < 600 ? status : 500
  );
});

export default app;
