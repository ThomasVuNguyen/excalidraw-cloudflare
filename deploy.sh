#!/usr/bin/env bash
# deploy.sh — Build, upload source maps to GlitchTip, and deploy to Cloudflare
#
# Usage:
#   ./deploy.sh          # Deploy everything (frontend + worker)
#   ./deploy.sh frontend # Deploy frontend only
#   ./deploy.sh worker   # Deploy worker only
#
# Requires:
#   - glitchtip-cli (https://glitchtip.com/install.sh)
#   - wrangler (npm)
#   - .sentryclirc in project root (or SENTRY_AUTH_TOKEN env var)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(cat "$ROOT_DIR/VERSION" 2>/dev/null || echo "0.0.0")
RELEASE="excalidash-frontend@${VERSION}"
TARGET="${1:-all}"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}▸${NC} $1"; }
warn()  { echo -e "${YELLOW}▸${NC} $1"; }
error() { echo -e "${RED}✖${NC} $1" >&2; }

# ── Preflight checks ─────────────────────────────────────────────────────────
check_glitchtip_cli() {
  if ! command -v glitchtip-cli &>/dev/null; then
    warn "glitchtip-cli not found — source maps won't be uploaded"
    warn "Install: curl -fsSL https://glitchtip.com/install.sh | sh"
    return 1
  fi
  return 0
}

# ── Frontend ──────────────────────────────────────────────────────────────────
deploy_frontend() {
  info "Building frontend..."
  cd "$ROOT_DIR/frontend"
  VITE_APP_VERSION="$VERSION" npm run build

  # Upload source maps to GlitchTip
  if check_glitchtip_cli; then
    info "Injecting debug IDs into source maps..."
    glitchtip-cli sourcemaps inject ./dist

    info "Uploading source maps to GlitchTip (release: $RELEASE)..."
    glitchtip-cli sourcemaps upload ./dist \
      --release "$RELEASE" \
      --org beenex \
      --project drawbeenexcompany \
      --url-prefix "~/"

    info "Cleaning up source maps from dist/ (not needed in production)..."
    find ./dist -name "*.map" -type f -delete

    info "Source maps uploaded successfully ✓"
  fi

  info "Deploying frontend to Cloudflare..."
  cd "$ROOT_DIR/worker"
  wrangler deploy

  info "Frontend deployed ✓"
}

# ── Worker ────────────────────────────────────────────────────────────────────
deploy_worker() {
  info "Deploying worker to Cloudflare..."
  cd "$ROOT_DIR/worker"
  wrangler deploy
  info "Worker deployed ✓"
}

# ── Main ──────────────────────────────────────────────────────────────────────
echo ""
info "ExcaliDash Deploy — v${VERSION}"
echo ""

case "$TARGET" in
  frontend)
    deploy_frontend
    ;;
  worker)
    deploy_worker
    ;;
  all)
    deploy_frontend
    # Worker is deployed as part of frontend (same wrangler.jsonc)
    ;;
  *)
    error "Unknown target: $TARGET"
    echo "Usage: ./deploy.sh [frontend|worker|all]"
    exit 1
    ;;
esac

echo ""
info "Deploy complete! 🚀"
