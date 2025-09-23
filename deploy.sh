#!/usr/bin/env bash
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_ROOT="$PROJECT_ROOT/.deploy"
BUILD_DIR="$STAGING_ROOT/build"
NPM_WORK_DIR="$STAGING_ROOT/npm"
TARGET_DIR="${DEPLOY_TARGET_DIR:-/var/www/gtc-form}"
CLIENT_DIR="$PROJECT_ROOT/Client/gtc-form"
ASSETS_DIR="$PROJECT_ROOT/assets"

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

if [ -d "$ASSETS_DIR" ]; then
  mkdir -p "$BUILD_DIR/assets"
  if ! rsync -a --delete "$ASSETS_DIR"/ "$BUILD_DIR/assets"/; then
    fail 31 "Failed to copy shared asset files"
  fi
fi

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

log "Deployment completed successfully"
exit 0
