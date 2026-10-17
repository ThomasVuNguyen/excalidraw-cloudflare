/**
 * GlitchTip / Sentry integration for the ExcaliDash frontend.
 *
 * Captures uncaught errors, unhandled promise rejections, and provides
 * helpers for manual error & breadcrumb reporting.
 */
import * as Sentry from "@sentry/browser";

const DSN =
  "https://d304d0eb2e3c4705b85c0e64dbade2b5@glitchtip.beenex.cloud/3";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;

  Sentry.init({
    dsn: DSN,
    // GlitchTip is Sentry-compatible; no tunnel needed, just point at the DSN
    environment: import.meta.env.MODE, // "development" | "production"
    release: `excalidash-frontend@${import.meta.env.VITE_APP_VERSION ?? "0.0.0"}`,

    // Send 100 % of errors (tune down once traffic grows)
    sampleRate: 1.0,

    // Capture 20 % of transactions for performance
    tracesSampleRate: 0.2,

    integrations: [
      Sentry.breadcrumbsIntegration(),
    ],

    beforeSend(event) {
      // Drop events in local dev to avoid noise (optional: remove to log everything)
      // if (import.meta.env.DEV) return null;
      return event;
    },
  });

  initialized = true;
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
