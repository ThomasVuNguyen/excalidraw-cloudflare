/**
 * GlitchTip / Sentry integration for the ExcaliDash frontend.
 *
 * Captures uncaught errors, unhandled promise rejections, and provides
 * helpers for manual error & breadcrumb reporting.
 */
import * as Sentry from "@sentry/browser";

// Production builds report to GlitchTip by default; dev builds only if
// VITE_SENTRY_DSN is set explicitly. An empty DSN disables Sentry entirely.
const DSN: string =
  import.meta.env.VITE_SENTRY_DSN ??
  (import.meta.env.PROD
    ? "https://d304d0eb2e3c4705b85c0e64dbade2b5@glitchtip.beenex.cloud/3"
    : "");

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    // GlitchTip is Sentry-compatible; no tunnel needed, just point at the DSN
    environment: import.meta.env.MODE, // "development" | "production"
    // Git commit SHA, injected at build time (see vite.config.ts)
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,

    // Send 100 % of errors (tune down once traffic grows)
    sampleRate: 1.0,

    // Capture 20 % of transactions for performance
    tracesSampleRate: 0.2,

    // Logs are always on in @sentry/* v11 (the old `enableLogs` option was removed).
    integrations: [
      Sentry.breadcrumbsIntegration(),
      Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
      // console.error still creates Issues
      Sentry.captureConsoleIntegration({ levels: ["error"] }),
    ],

    beforeSend(event) {
      // Drop events in local dev to avoid noise (optional: remove to log everything)
      // if (import.meta.env.DEV) return null;
      return event;
    },
  });

  initialized = true;
  Sentry.logger.info("deploy", {
    release: import.meta.env.VITE_SENTRY_RELEASE || "unknown",
    component: "frontend",
  });
}

/**
 * Capture an error manually (useful in catch blocks).
 */
export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  Sentry.captureException(error, { extra: context });
}

/**
 * Capture a message (info / warning level).
 */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = "info",
): void {
  Sentry.captureMessage(message, level);
}

/**
 * Add a navigation / action breadcrumb for richer error context.
 */
export function addBreadcrumb(crumb: Sentry.Breadcrumb): void {
  Sentry.addBreadcrumb(crumb);
}

/**
 * Tag the current scope with user info (call after login).
 */
export function setUser(user: { id: string; email?: string; username?: string } | null): void {
  Sentry.setUser(user);
}

export { Sentry };
