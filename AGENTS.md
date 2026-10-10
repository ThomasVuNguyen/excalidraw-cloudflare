# AGENTS.md

This file helps agents work on ExcaliDash (Cloudflare Edition).

## Project Summary

ExcaliDash is a collaborative Excalidraw whiteboard deployed entirely on Cloudflare's edge platform.
This is the Cloudflare-native fork — no Docker, no VPS, no self-hosted servers.

## Architecture

- **Frontend**: React 18 + Vite SPA → Cloudflare Pages
- **API**: Hono on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite-compatible)
- **Real-time**: Durable Objects with WebSocket Hibernation API
- **File Storage**: Cloudflare R2
- **Caching**: Cloudflare KV

## Key Files

- `worker/src/index.ts` — Hono entrypoint with middleware chain
- `worker/src/types.ts` — Environment bindings and type definitions
- `worker/src/durable-objects/DrawingRoom.ts` — Real-time collaboration DO
- `worker/src/routes/auth/index.ts` — Authentication routes
- `worker/src/routes/dashboard/drawings.ts` — Drawing CRUD + sharing
- `worker/src/middleware/auth.ts` — JWT auth middleware
- `worker/src/middleware/csrf.ts` — CSRF protection
- `worker/src/utils/crypto.ts` — Web Crypto utilities
- `worker/migrations/0001_initial_schema.sql` — D1 schema
- `worker/wrangler.jsonc` — Worker configuration
- `frontend/src/utils/websocket.ts` — Native WebSocket client (replaces Socket.IO)
- `frontend/src/pages/Editor.tsx` — Collaborative editor
- `frontend/vite.config.ts` — Vite build + dev proxy

## Development

```bash
# Worker
cd worker && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

## Deployment

```bash
cd worker && npm run deploy
cd frontend && wrangler pages deploy dist --project-name=excalidash
```

## Original Project

Forked from the self-hosted Docker/Coolify version at `ThomasVuNguyen/excalidraw` (branch `coolify`).
The original repo remains safe and connected to the live deployment at `draw.beenex.org`.
