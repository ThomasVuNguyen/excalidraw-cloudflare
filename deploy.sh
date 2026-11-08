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
#
# GlitchTip release = git commit SHA (frontend build + worker SENTRY_RELEASE var).
# Source map uploads are best-effort and never fail the deploy.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(cat "$ROOT_DIR/VERSION" 2>/dev/null || echo "0.0.0")
TARGET="${1:-all}"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}▸${NC} $1"; }
warn()  { echo -e "${YELLOW}▸${NC} $1"; }
error() { echo -e "${RED}✖${NC} $1" >&2; }

RELEASE="${SENTRY_RELEASE:-$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "$VERSION")}"
export SENTRY_RELEASE="$RELEASE"
if [ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  warn "Working tree has uncommitted changes — release $RELEASE may not match deployed code"
fi

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
  VITE_APP_VERSION="$VERSION" SENTRY_RELEASE="$RELEASE" npm run build

  # Upload source maps to GlitchTip (best-effort)
  if check_glitchtip_cli; then
    info "Injecting debug IDs into source maps..."
    glitchtip-cli sourcemaps inject ./dist || warn "debug ID injection failed (continuing)"

    info "Uploading source maps to GlitchTip (release: $RELEASE)..."
    glitchtip-cli sourcemaps upload ./dist \
      --url https://glitchtip.beenex.cloud \
      --release "$RELEASE" \
      --org beenex \
      --project drawbeenexcompany \
      --url-prefix "~/" || warn "frontend source map upload failed (continuing)"
  fi

  info "Cleaning up source maps from dist/ (not needed in production)..."
  find ./dist -name "*.map" -type f -delete

  deploy_worker
  info "Frontend deployed ✓"
}

# ── Worker ────────────────────────────────────────────────────────────────────
deploy_worker() {
  info "Deploying worker to Cloudflare (release: $RELEASE)..."
  cd "$ROOT_DIR/worker"
  local outdir="$ROOT_DIR/worker/.wrangler/sentry-dist"
  rm -rf "$outdir"
  npx wrangler deploy --var "SENTRY_RELEASE:$RELEASE" --outdir "$outdir" --upload-source-maps

  # Upload worker bundle source maps to GlitchTip (best-effort)
  if check_glitchtip_cli; then
    glitchtip-cli sourcemaps upload "$outdir" \
      --url https://glitchtip.beenex.cloud \
      --release "$RELEASE" \
      --org beenex \
      --project drawbeenexcompany \
      --url-prefix "~/" || warn "worker source map upload failed (continuing)"
  fi
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
