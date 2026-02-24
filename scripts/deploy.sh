#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="${ROOT_DIR:-/opt/proxmox-center}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
API_SERVICE="${API_SERVICE:-proxmox-center-api}"
WEB_SERVICE="${WEB_SERVICE:-nginx}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/api/health}"

SKIP_PULL=0
SKIP_INSTALL=0
SKIP_BUILD=0
NO_BACKUP=0

log() {
  echo "[deploy] $*"
}

warn() {
  echo "[deploy][warn] $*" >&2
}

die() {
  echo "[deploy][error] $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy.sh [options]

Options:
  --root <path>           Project root path (default: /opt/proxmox-center)
  --branch <name>         Git branch to pull (default: main)
  --remote <name>         Git remote to pull from (default: origin)
  --api-service <name>    systemd API service name (default: proxmox-center-api)
  --web-service <name>    systemd web service to reload (default: nginx)
  --health-url <url>      Health check endpoint (default: http://127.0.0.1:4000/api/health)
  --skip-pull             Skip git fetch/pull step
  --skip-install          Skip npm ci step
  --skip-build            Skip npm run build step
  --no-backup             Skip backup of server .env/web .env/users file
  -h, --help              Show help

Environment variables:
  ROOT_DIR, BRANCH, REMOTE, API_SERVICE, WEB_SERVICE, HEALTH_URL

Examples:
  ./scripts/deploy.sh
  ./scripts/deploy.sh --branch staging
  ./scripts/deploy.sh --root /srv/proxmox-center --api-service proxmox-api
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      ROOT_DIR="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --remote)
      REMOTE="$2"
      shift 2
      ;;
    --api-service)
      API_SERVICE="$2"
      shift 2
      ;;
    --web-service)
      WEB_SERVICE="$2"
      shift 2
      ;;
    --health-url)
      HEALTH_URL="$2"
      shift 2
      ;;
    --skip-pull)
      SKIP_PULL=1
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --no-backup)
      NO_BACKUP=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

[[ -d "$ROOT_DIR" ]] || die "Project root not found: $ROOT_DIR"

for cmd in npm curl; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
done

cd "$ROOT_DIR"
log "Using project root: $ROOT_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT_DIR/backups/deploy-$TIMESTAMP"

if [[ $NO_BACKUP -eq 0 ]]; then
  mkdir -p "$BACKUP_DIR"
  for path in "apps/server/.env" "apps/web/.env" "apps/server/data/users.json"; do
    if [[ -f "$path" ]]; then
      cp -a "$path" "$BACKUP_DIR/$(basename "$path")"
    fi
  done
  log "Backups stored in: $BACKUP_DIR"
fi

if [[ $SKIP_PULL -eq 0 ]]; then
  if [[ -d .git ]]; then
    command -v git >/dev/null 2>&1 || die "git is required for pull step"
    log "Fetching latest from $REMOTE/$BRANCH"
    git fetch "$REMOTE"
    git pull --ff-only "$REMOTE" "$BRANCH"
  else
    warn "No .git directory found; skipping pull step"
  fi
fi

if [[ $SKIP_INSTALL -eq 0 ]]; then
  log "Installing dependencies with npm ci"
  npm ci
fi

if [[ $SKIP_BUILD -eq 0 ]]; then
  log "Building server and web"
  npm run build
fi

log "Restarting API service: $API_SERVICE"
sudo systemctl restart "$API_SERVICE"

if [[ -n "$WEB_SERVICE" ]]; then
  log "Reloading web service: $WEB_SERVICE"
  sudo systemctl reload "$WEB_SERVICE"
fi

log "Running health check: $HEALTH_URL"
curl --fail --silent --show-error "$HEALTH_URL" >/dev/null

log "Deploy completed successfully"
