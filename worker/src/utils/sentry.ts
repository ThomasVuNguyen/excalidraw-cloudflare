/**
 * GlitchTip / Sentry integration for the ExcaliDash Cloudflare Worker.
 *
 * Uses toucan-js — a lightweight Sentry client designed for Cloudflare Workers
 * (no Node.js APIs required).
 */
import { Toucan } from "toucan-js";
import type { Context } from "hono";
import type { Env, AppVariables } from "../types";

const DSN =
  "https://d304d0eb2e3c4705b85c0e64dbade2b5@glitchtip.beenex.cloud/3";

/**
 * Create a Toucan (Sentry) instance scoped to a single request.
 * Attach it once per request via middleware, then use throughout handlers.
 */
export function createSentry(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
): Toucan {
  const sentry = new Toucan({
    dsn: DSN,
    context: c.executionCtx,
    request: c.req.raw,
    environment: "production",
    release: "excalidash-worker@0.5.0",
    sampleRate: 1.0,
    requestDataOptions: {
      // Don't send cookies / auth headers to GlitchTip
      allowedHeaders: [
        "content-type",
        "user-agent",
        "x-request-id",
        "accept",
      ],
      allowedSearchParams: /(.*)/,
    },
  });

  // Tag with request ID if available
  const requestId = c.get("requestId");
  if (requestId) {
    sentry.setTag("request_id", requestId);
  }

  return sentry;
}

/**
 * Create a Toucan instance for use inside Durable Objects.
 * DOs don't have the Hono context, so we accept raw params.
 */
export function createSentryForDO(
  ctx: { waitUntil: (promise: Promise<unknown>) => void },
  requestInfo?: { url?: string; method?: string },
): Toucan {
  return new Toucan({
    dsn: DSN,
    context: ctx,
    environment: "production",
    release: "excalidash-worker@0.5.0",
    sampleRate: 1.0,
  });
}
