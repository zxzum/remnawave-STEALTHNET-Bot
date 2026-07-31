#!/usr/bin/env bash

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-bot}"
REMOTE_DIR="${REMOTE_DIR:-/opt/remnawave-STEALTHNET-Bot}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
MODE="deploy"

usage() {
  printf 'Usage: %s [--dry-run]\n' "$0"
  printf 'Environment overrides: REMOTE_HOST, REMOTE_DIR, DEPLOY_BRANCH\n'
}

case "${1:-}" in
  "") ;;
  --dry-run) MODE="dry-run" ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

if [[ ! -d "$PROJECT_DIR/.git" ]]; then
  printf 'Error: %s is not a Git working tree.\n' "$PROJECT_DIR" >&2
  exit 1
fi

if ! git -C "$PROJECT_DIR" diff --quiet || [[ -n "$(git -C "$PROJECT_DIR" ls-files --others --exclude-standard)" ]]; then
  printf 'Error: local working tree is not clean; commit or stash changes first.\n' >&2
  exit 1
fi

commit="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
printf 'Deploying %s (%s) to %s:%s\n' "$DEPLOY_BRANCH" "$commit" "$REMOTE_HOST" "$REMOTE_DIR"

remote_git="git -C '$REMOTE_DIR' -c safe.directory='$REMOTE_DIR'"
remote_status="$(ssh "$REMOTE_HOST" "if [[ -d '$REMOTE_DIR/.git' ]]; then $remote_git status --porcelain; fi")"
if [[ -n "$remote_status" ]]; then
  printf 'Error: server working tree is not clean; preserve its changes before deploying.\n%s\n' "$remote_status" >&2
  exit 1
fi

if [[ "$MODE" == "dry-run" ]]; then
  ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && $remote_git remote -v && $remote_git branch --show-current && $remote_git rev-parse HEAD"
  exit 0
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="/opt/backups/remnawave-STEALTHNET-Bot-pre-deploy-$timestamp.tar.gz"
ssh "$REMOTE_HOST" "mkdir -p /opt/backups && tar -C '$REMOTE_DIR' -czf '$backup_path' --exclude=.git --exclude=.env --exclude='.env.*' ."
ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && $remote_git fetch origin '$DEPLOY_BRANCH' && $remote_git checkout '$DEPLOY_BRANCH' && $remote_git reset --hard 'origin/$DEPLOY_BRANCH'"
ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && docker compose --profile builtin-nginx config --quiet"
ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && docker compose --profile builtin-nginx up -d --build --remove-orphans"
ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && for attempt in \$(seq 1 60); do if docker compose exec -T api node -e 'require(\"http\").get(\"http://127.0.0.1:5000/api/health\",r=>{r.resume();r.on(\"end\",()=>process.exit(r.statusCode===200?0:1))}).on(\"error\",()=>process.exit(1))' >/dev/null 2>&1; then exit 0; fi; sleep 2; done; exit 1"
ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && docker compose --profile builtin-nginx ps"
printf 'Deployment complete. Backup: %s on %s\n' "$backup_path" "$REMOTE_HOST"
