#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DEPLOY_TARGET="${DEPLOY_TARGET:-qa}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<EOF
Usage: pnpm deploy [--production]

Targets:
  qa            Default. Deploys to QA / Staging server (configured in .env.deploy).
  production    pnpm run deploy --production (or "pnpm deploy production").
                Deploys main branch to production server (configured in .env.deploy.production).

Branch guard:
  QA default branch: develop (or main if develop does not exist).
  Production branch: main.
  The script aborts if your checked-out branch does not match the target.

Required in .env.deploy / .env.deploy.production:
  DEPLOY_HOST       SSH target, e.g. user@your-server-ip.
  DEPLOY_PATH       Target repo directory on server.

Optional:
  DEPLOY_BRANCH     Branch the server checks out. Derived from target by default.
  DEPLOY_SSH_PORT   SSH port. Default: 22
  APP_NAME          PM2 process name. Default: qa-afrocouture-api / afrocouture-api
  APP_PORT          PORT exported for the app. Default: 3001
  RUN_LINT=1        Run pnpm lint before build (Default: 0)
  RUN_TESTS=1       Run pnpm test before build (Default: 1)
  SYNC_ENV=1        Upload the runtime env file to server (Default: 1)
  ENV_SOURCE        Runtime env file to upload. Default: .env.qa (qa) / .env (prod)
  SKIP_GIT_PUSH=1   Do not commit and push before deploy (Default: 0)
EOF
  exit 0
fi

for arg in "$@"; do
  case "$arg" in
    --production | -p | production | prod) DEPLOY_TARGET="production" ;;
    --qa | qa) DEPLOY_TARGET="qa" ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: pnpm deploy [--production]" >&2
      exit 1
      ;;
  esac
done

if [[ "$DEPLOY_TARGET" != "qa" && "$DEPLOY_TARGET" != "production" ]]; then
  echo "DEPLOY_TARGET must be 'qa' or 'production' (got: '$DEPLOY_TARGET')" >&2
  exit 1
fi

ENV_FILE=".env.deploy"
if [[ "$DEPLOY_TARGET" == "production" ]]; then
  ENV_FILE=".env.deploy.production"
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

EXPECTED_BRANCH="main"
if [[ "$DEPLOY_TARGET" == "qa" ]]; then
  # If local or remote develop branch exists, expect develop; otherwise allow current branch
  if git show-ref --verify --quiet refs/heads/develop || git show-ref --verify --quiet refs/remotes/origin/develop; then
    EXPECTED_BRANCH="develop"
  else
    EXPECTED_BRANCH="$CURRENT_BRANCH"
  fi
fi

APP_NAME="${APP_NAME:-}"
APP_PORT="${APP_PORT:-3001}"
DEPLOY_PATH="${DEPLOY_PATH:-}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-$EXPECTED_BRANCH}"
RUN_LINT="${RUN_LINT:-0}"
RUN_TESTS="${RUN_TESTS:-1}"
SKIP_GIT_PUSH="${SKIP_GIT_PUSH:-0}"
SYNC_ENV="${SYNC_ENV:-1}"
ENV_SOURCE="${ENV_SOURCE:-}"

if [[ "$DEPLOY_TARGET" == "qa" ]]; then
  APP_NAME="${APP_NAME:-qa-afrocouture-api}"
  ENV_SOURCE="${ENV_SOURCE:-.env.qa}"
else
  APP_NAME="${APP_NAME:-afrocouture-api}"
  ENV_SOURCE="${ENV_SOURCE:-.env}"
fi

if [[ -z "$DEPLOY_HOST" ]]; then
  echo "DEPLOY_HOST is required. Set it in $ENV_FILE (see ${ENV_FILE}.example)." >&2
  exit 1
fi

if [[ -z "$DEPLOY_PATH" ]]; then
  echo "DEPLOY_PATH is required. Set it in $ENV_FILE (see ${ENV_FILE}.example)." >&2
  exit 1
fi

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "Refusing to deploy: target '$DEPLOY_TARGET' expects branch '$EXPECTED_BRANCH' but you are on '$CURRENT_BRANCH'." >&2
  echo "Run 'git checkout $EXPECTED_BRANCH' first." >&2
  exit 1
fi

for cmd in git pnpm ssh scp tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd is required." >&2
    exit 1
  fi
done

echo "Installing dependencies locally..."
pnpm install --frozen-lockfile || pnpm install

if [[ "$RUN_LINT" == "1" ]]; then
  echo "Running lint..."
  pnpm lint
fi

if [[ "$RUN_TESTS" == "1" ]]; then
  echo "Running tests..."
  pnpm test
fi

echo "Building locally..."
pnpm build

if [[ ! -f dist/main.js ]]; then
  echo "Build did not create dist/main.js." >&2
  exit 1
fi

release_id="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
build_artifact="/tmp/${APP_NAME}-dist-${release_id}.tar.gz"
remote_build_artifact="/tmp/${APP_NAME}-dist-${release_id}.tar.gz"
remote_env_file="/tmp/${APP_NAME}-env-${release_id}"
env_arg=""

cleanup() {
  rm -f "$build_artifact"
}
trap cleanup EXIT

echo "Packaging dist build..."
tar -czf "$build_artifact" dist

if [[ "$SKIP_GIT_PUSH" != "1" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Changes to commit:"
    git status --short

    if [[ -z "${COMMIT_MESSAGE:-}" ]]; then
      read -r -p "Enter commit message: " COMMIT_MESSAGE
    fi

    if [[ -z "$COMMIT_MESSAGE" ]]; then
      echo "Commit message is required." >&2
      exit 1
    fi

    user="$(whoami)"
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    commit_msg="$user: $COMMIT_MESSAGE - $timestamp"

    echo "Committing changes..."
    git add -A
    git commit -m "$commit_msg"
  else
    echo "No source changes to commit."
  fi

  echo "Pushing $DEPLOY_BRANCH..."
  git push origin "$DEPLOY_BRANCH"
fi

if [[ "$SYNC_ENV" == "1" && -f "$ENV_SOURCE" ]]; then
  echo "Uploading $ENV_SOURCE..."
  scp -P "$DEPLOY_SSH_PORT" "$ENV_SOURCE" "$DEPLOY_HOST:$remote_env_file"
  env_arg="ENV_FILE='$remote_env_file'"
elif [[ "$SYNC_ENV" == "1" ]]; then
  echo "Warning: SYNC_ENV=1 but $ENV_SOURCE was not found locally."
fi

echo "Uploading build artifact..."
scp -P "$DEPLOY_SSH_PORT" "$build_artifact" "$DEPLOY_HOST:$remote_build_artifact"

echo "Deploying on server..."
ssh -p "$DEPLOY_SSH_PORT" "$DEPLOY_HOST" "\
  set -euo pipefail; \
  cd '$DEPLOY_PATH'; \
  chmod +x ./deploy.sh; \
  DEPLOY_PATH='$DEPLOY_PATH' \
  DEPLOY_BRANCH='$DEPLOY_BRANCH' \
  BUILD_ARTIFACT='$remote_build_artifact' \
  $env_arg \
  APP_NAME='$APP_NAME' \
  APP_PORT='$APP_PORT' \
  bash ./deploy.sh; \
  rm -f '$remote_build_artifact' '$remote_env_file'"

echo "Local build deployed to $DEPLOY_HOST:$DEPLOY_PATH ($DEPLOY_TARGET, branch $DEPLOY_BRANCH)"

