#!/usr/bin/env bash
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_ROOT="$PROJECT_ROOT/.deploy"
BUILD_DIR="$STAGING_ROOT/build"
NPM_WORK_DIR="$STAGING_ROOT/npm"
TARGET_DIR="${DEPLOY_TARGET_DIR:-/var/www/gtc-form}"
CLIENT_DIR="$PROJECT_ROOT/Client/gtc-form"
ASSETS_DIR="$PROJECT_ROOT/assets"
GTC_AUTH_DIR="$PROJECT_ROOT/srv/gtc-auth"
GTC_AUTH_STAGE_DIR="$STAGING_ROOT/gtc-auth"
GTC_AUTH_TARGET_DIR="${AUTH_TARGET_DIR:-/srv/gtc-auth}"

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

cleanup() {
  if [ -d "$STAGING_ROOT" ]; then
    rm -rf "$STAGING_ROOT"
  fi
}

fail() {
  local exit_code="$1"
  shift
  log "ERROR: $*"
  exit "$exit_code"
}

trap cleanup EXIT

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail 10 "Required command '$cmd' is not available in PATH"
  fi
}

log "Starting deployment from $PROJECT_ROOT"

if [ ! -d "$CLIENT_DIR" ]; then
  fail 11 "Client application directory not found at $CLIENT_DIR"
fi

require_command npm
require_command node
require_command rsync

cd "$PROJECT_ROOT"

log "Installing npm dependencies"
rm -rf "$NPM_WORK_DIR"
mkdir -p "$NPM_WORK_DIR"
cp "$PROJECT_ROOT/package.json" "$PROJECT_ROOT/package-lock.json" "$NPM_WORK_DIR"/
if ! npm ci --no-audit --no-fund --prefix "$NPM_WORK_DIR" >/dev/null; then
  fail 20 "npm dependency installation failed"
fi

log "Staging static assets"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

if ! rsync -a --delete "$CLIENT_DIR"/ "$BUILD_DIR"/; then
  fail 30 "Failed to copy client application files"
fi

# Ensure the unified chat/auth entrypoint is present so deployments fail fast
# instead of silently shipping a bundle without /gtc_chat/.
if [ ! -d "$BUILD_DIR/gtc_chat" ] || [ ! -f "$BUILD_DIR/gtc_chat/index.html" ]; then
  fail 31 "Unified chat entrypoint missing (expected $BUILD_DIR/gtc_chat/index.html)"
fi
if [ ! -f "$BUILD_DIR/gtc_chat.html" ]; then
  fail 32 "Fallback alias missing (expected $BUILD_DIR/gtc_chat.html)"
fi

if [ -d "$ASSETS_DIR" ]; then
  mkdir -p "$BUILD_DIR/assets"
  if ! rsync -a --delete "$ASSETS_DIR"/ "$BUILD_DIR/assets"/; then
    fail 33 "Failed to copy shared asset files"
  fi
fi

if [ -d "$GTC_AUTH_DIR" ]; then
  log "Staging gtc-auth service"
  rm -rf "$GTC_AUTH_STAGE_DIR"
  mkdir -p "$GTC_AUTH_STAGE_DIR"
  if ! rsync -a --delete --exclude 'node_modules/' "$GTC_AUTH_DIR"/ "$GTC_AUTH_STAGE_DIR"/; then
    fail 32 "Failed to stage gtc-auth sources"
  fi
else
  log "WARNING: gtc-auth service directory not found; skipping service deployment"
fi

log "Writing runtime configuration"
GOOGLE_CLIENT_ID_ESCAPED=$(node -e "process.stdout.write(JSON.stringify(process.env.GOOGLE_CLIENT_ID || ''))")
if [ "$GOOGLE_CLIENT_ID_ESCAPED" = '""' ]; then
  log "WARNING: GOOGLE_CLIENT_ID is not set; Google sign-in will show a configuration error."
fi
cat > "$BUILD_DIR/gtc-config.js" <<EOF
window.__GTC_CONFIG = Object.freeze({
  googleClientId: ${GOOGLE_CLIENT_ID_ESCAPED}
});
EOF

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  elif [ -w "$TARGET_DIR" ]; then
    SUDO=""
  else
    fail 12 "Root privileges are required to write to $TARGET_DIR and sudo is not available"
  fi
fi

run_target_cmd() {
  if [ -n "$SUDO" ]; then
    "$SUDO" "$@"
  else
    "$@"
  fi
}

log "Syncing bundle to $TARGET_DIR"
if ! run_target_cmd mkdir -p "$TARGET_DIR"; then
  fail 40 "Failed to create target directory $TARGET_DIR"
fi

if ! run_target_cmd rsync -a --delete "$BUILD_DIR"/ "$TARGET_DIR"/; then
  fail 41 "Failed to sync staged files to $TARGET_DIR"
fi

if [ -d "$GTC_AUTH_STAGE_DIR" ]; then
  log "Syncing gtc-auth service to $GTC_AUTH_TARGET_DIR"
  if ! run_target_cmd mkdir -p "$GTC_AUTH_TARGET_DIR"; then
    fail 50 "Failed to create gtc-auth target directory $GTC_AUTH_TARGET_DIR"
  fi

  if ! run_target_cmd rsync -a --delete --exclude '.env' --exclude 'node_modules/' "$GTC_AUTH_STAGE_DIR"/ "$GTC_AUTH_TARGET_DIR"/; then
    fail 51 "Failed to sync gtc-auth sources"
  fi

  log "Installing gtc-auth production dependencies"
  if ! run_target_cmd bash -lc "cd '$GTC_AUTH_TARGET_DIR' && npm ci --omit=dev --no-audit --no-fund"; then
    fail 52 "npm ci failed for gtc-auth"
  fi

  if run_target_cmd bash -lc 'command -v systemctl >/dev/null 2>&1'; then
    log "Restarting gtc-auth service"
    if ! run_target_cmd systemctl restart gtc-auth; then
      fail 53 "Failed to restart gtc-auth service"
    fi
  else
    log "WARNING: systemctl not available; restart gtc-auth manually"
  fi
fi

log "Deployment completed successfully"
exit 0
