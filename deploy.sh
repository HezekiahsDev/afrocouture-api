#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-afrocouture-api}"
APP_PORT="${APP_PORT:-3001}"
DEPLOY_PATH="${DEPLOY_PATH:-$(cd "$(dirname "$0")" && pwd)}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
BUILD_ARTIFACT="${BUILD_ARTIFACT:-}"
ENV_FILE="${ENV_FILE:-}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<EOF
Usage: ./deploy.sh

Server-side deploy script for AfroCouture AI API.
Pulls latest code, unpacks uploaded dist build, installs dependencies with pnpm,
and restarts the app with PM2.

Environment:
  APP_NAME        PM2 app name. Default: afrocouture-api
  APP_PORT        Port exported as PORT. Default: 3001
  DEPLOY_PATH     Server repo path. Default: directory containing deploy.sh
  DEPLOY_BRANCH   Branch to fetch/checkout. Default: main
  BUILD_ARTIFACT  Optional tar.gz containing local dist build output
  ENV_FILE        Optional uploaded env file to copy to .env
EOF
  exit 0
fi

cd "$DEPLOY_PATH"

# Load profile / nvm / pnpm / pm2 paths
load_runtime_path() {
  local had_nounset=0
  if [[ $- == *u* ]]; then
    had_nounset=1
    set +u
  fi

  for profile in "$HOME/.nvm/nvm.sh" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    if [[ -f "$profile" ]]; then
      # shellcheck disable=SC1090
      source "$profile" >/dev/null 2>&1 || true
    fi
  done

  if [[ "$had_nounset" == "1" ]]; then
    set -u
  fi

  if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
  fi
}

load_runtime_path

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required on the server but was not found in PATH." >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is required on the server but was not found in PATH." >&2
  exit 1
fi

PNPM_BIN="$(command -v pnpm)"
PM2_BIN="$(command -v pm2)"

echo "Fetching latest code..."
git fetch origin "$DEPLOY_BRANCH"
git checkout -B "$DEPLOY_BRANCH" "origin/$DEPLOY_BRANCH"

if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "ENV_FILE was provided but does not exist: $ENV_FILE" >&2
    exit 1
  fi

  echo "Updating .env..."
  cp "$ENV_FILE" .env
fi

if [[ -n "$BUILD_ARTIFACT" ]]; then
  if [[ ! -f "$BUILD_ARTIFACT" ]]; then
    echo "BUILD_ARTIFACT was provided but does not exist: $BUILD_ARTIFACT" >&2
    exit 1
  fi

  echo "Installing uploaded build..."
  rm -rf dist
  tar -xzf "$BUILD_ARTIFACT" -C "$DEPLOY_PATH"
fi

if [[ ! -f dist/main.js ]]; then
  echo "Missing dist/main.js. Run pnpm deploy from your local machine first." >&2
  exit 1
fi

echo "Installing dependencies..."
"$PNPM_BIN" install --frozen-lockfile || "$PNPM_BIN" install

echo "Restarting $APP_NAME with PM2 on port $APP_PORT..."
"$PM2_BIN" stop "$APP_NAME" || true
"$PM2_BIN" delete "$APP_NAME" || true
PORT="$APP_PORT" "$PM2_BIN" start "$PNPM_BIN" --name "$APP_NAME" -- start:prod
"$PM2_BIN" save

echo "Deploy complete. $APP_NAME is running with PM2."

