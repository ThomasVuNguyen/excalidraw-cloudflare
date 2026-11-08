/**
 * GlitchTip / Sentry integration for the ExcaliDash Cloudflare Worker.
 *
 * Uses @sentry/cloudflare. The worker fetch handler is wrapped with
 * `Sentry.withSentry` and the Durable Object with
 * `Sentry.instrumentDurableObjectWithSentry` (see index.ts), which flush
 * events and logs via ctx.waitUntil so nothing is dropped.
 *
 * Sentry stays disabled when SENTRY_DSN is empty (e.g. local dev with
 * SENTRY_DSN="" in .dev.vars).
 */
import * as Sentry from "@sentry/cloudflare";
import type { Env } from "../types";

export function sentryOptions(env: Env): Sentry.CloudflareOptions {
  const dsn = env.SENTRY_DSN || "";
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: env.SENTRY_ENVIRONMENT || "production",
    release: env.SENTRY_RELEASE || undefined,
    sampleRate: 1.0,
    tracesSampleRate: 0.1,
    // Logs are always on in @sentry/* v11 (the old `enableLogs` option was removed).
    integrations: [
      Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
      Sentry.captureConsoleIntegration({ levels: ["error"] }),
    ],
  };
}

let deployLogged = false;

/** Emit a one-time "deploy" log per isolate (first request). */
export function logDeployOnce(env: Env): void {
  if (deployLogged) return;
  deployLogged = true;
  Sentry.logger.info("deploy", {
    release: env.SENTRY_RELEASE || "unknown",
    component: "worker",
  });
}

export { Sentry };
