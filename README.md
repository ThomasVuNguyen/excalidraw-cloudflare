# ExcaliDash — Cloudflare-Native Edition

Collaborative Excalidraw whiteboard running entirely on Cloudflare's edge platform.

## Architecture

| Component | Technology |
|-----------|-----------|
| **Frontend** | React 18 + Vite → Cloudflare Pages |
| **API** | Hono on Cloudflare Workers |
| **Database** | Cloudflare D1 (SQLite-compatible) |
| **Real-time** | Durable Objects + WebSocket Hibernation API |
| **File Storage** | Cloudflare R2 |
| **Caching** | Cloudflare KV |

## Getting Started

### Prerequisites
- Node.js 20+
- Wrangler CLI (`npm i -g wrangler`) or `cf` CLI (`npm i -g cf`)
- Cloudflare account

### Setup

```bash
# Install dependencies
cd worker && npm install
cd ../frontend && npm install

# Create D1 database
wrangler d1 create excalidash-db
# Copy the database_id into worker/wrangler.jsonc

# Create KV namespace
wrangler kv namespace create CACHE
# Copy the id into worker/wrangler.jsonc

# Create R2 bucket
wrangler r2 bucket create excalidash-storage

# Set secrets
wrangler secret put JWT_SECRET
wrangler secret put CSRF_SECRET

# Apply database schema
wrangler d1 migrations apply excalidash-db --local

# Run locally
cd worker && npm run dev
cd ../frontend && npm run dev
```

### Deploy

```bash
# Deploy worker
cd worker && npm run deploy

# Deploy frontend to Pages
cd frontend && npm run build
# Connect Pages to this repo via Cloudflare dashboard, or:
wrangler pages deploy dist --project-name=excalidash
```

## Project Structure

```
├── worker/                    # Cloudflare Worker (API + Durable Objects)
│   ├── src/
│   │   ├── index.ts           # Hono entrypoint
│   │   ├── types.ts           # Environment & type definitions
│   │   ├── durable-objects/   # DrawingRoom (real-time collaboration)
│   │   ├── routes/            # API route handlers
│   │   │   ├── auth/          # Authentication & user management
│   │   │   ├── dashboard/     # Drawings, collections, library
│   │   │   └── system/        # Health, updates
│   │   ├── middleware/        # Auth, CSRF, onboarding gate
│   │   └── utils/             # Crypto, sanitization helpers
│   ├── migrations/            # D1 SQL migrations
│   └── wrangler.jsonc         # Worker configuration
├── frontend/                  # React SPA (Cloudflare Pages)
│   ├── src/
│   │   ├── api/               # API client (Axios)
│   │   ├── pages/             # Route-level components
│   │   ├── context/           # Auth, theme providers
│   │   └── utils/             # Sync, compression, etc.
│   └── vite.config.ts
└── README.md
```

## Original Project

This is a Cloudflare-native fork of [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash), originally deployed on Docker/Coolify.
The original self-hosted version is at [ThomasVuNguyen/excalidraw](https://github.com/ThomasVuNguyen/excalidraw).
