/**
 * ExcaliDash Cloudflare Worker — Environment & Type Definitions
 */

export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Object Storage
  STORAGE: R2Bucket;

  // KV Cache
  CACHE: KVNamespace;

  // Durable Objects
  DRAWING_ROOM: DurableObjectNamespace;

  // Environment variables
  AUTH_MODE: string;           // "local" | "hybrid" | "oidc_enforced"
  FRONTEND_URL: string;        // Comma-separated allowed origins
  JWT_SECRET: string;          // Must be >= 32 chars
  CSRF_SECRET: string;         // HMAC signing key for CSRF tokens

  // Optional
  JWT_ACCESS_EXPIRES_IN?: string;   // default "15m"
  JWT_REFRESH_EXPIRES_IN?: string;  // default "7d"
  RATE_LIMIT_MAX_REQUESTS?: string; // default "1000"

  // OIDC (optional, required in hybrid/oidc_enforced)
  OIDC_PROVIDER_NAME?: string;
  OIDC_ISSUER_URL?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_REDIRECT_URI?: string;
  OIDC_SCOPES?: string;
  OIDC_EMAIL_CLAIM?: string;
  OIDC_REQUIRE_EMAIL_VERIFIED?: string;
  OIDC_JIT_PROVISIONING?: string;
  OIDC_FIRST_USER_ADMIN?: string;
}

// Hono app-level variables (set by middleware)
export type AppVariables = {
  user: AuthUser | null;
  requestId: string;
};

export interface AuthUser {
  id: string;
  email: string;
  username: string | null;
  role: "USER" | "ADMIN";
  isActive: boolean;
  mustResetPassword: boolean;
  impersonatorId?: string;
}

export type DrawingAccess = "owner" | "edit" | "view" | "none";

export interface DrawingPrincipal {
  userId: string;
  username: string;
  role: "USER" | "ADMIN";
  isAnonymous: boolean;
}

// WebSocket message types for Durable Objects
export type WSClientMessage =
  | { type: "join-room"; drawingId: string; user: { id: string; name: string; color: string } }
  | { type: "cursor-move"; drawingId: string; userId: string; username: string; color: string; pointer: { x: number; y: number }; button: string }
  | { type: "element-update"; drawingId: string; elements: unknown[]; files?: Record<string, unknown>; elementOrder?: string[]; userId: string }
  | { type: "user-activity"; drawingId: string; isActive: boolean };

export type WSServerMessage =
  | { type: "presence-update"; users: Array<{ id: string; name: string; color: string; isActive: boolean }> }
  | { type: "cursor-move"; userId: string; pointer: { x: number; y: number }; button: string; username: string; color: string; selectedElementIds?: Record<string, boolean> }
  | { type: "element-update"; elements: unknown[]; files?: Record<string, unknown>; elementOrder?: string[] }
  | { type: "join-ack"; user: { id: string; name: string; color: string } }
  | { type: "error"; message: string };
