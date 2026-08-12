#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-/opt/remnawave-STEALTHNET-Bot}"
BASE_URL="${BASE_URL:-https://bot.lazeika.xyz}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsS "$BASE_URL/api/public/config?target=web" -o "$TMP_DIR/web-config.json"
curl -fsS "$BASE_URL/cabinet/dashboard" -o "$TMP_DIR/dashboard.html"

web_bytes="$(wc -c < "$TMP_DIR/web-config.json" | tr -d ' ')"
html_bytes="$(wc -c < "$TMP_DIR/dashboard.html" | tr -d ' ')"

echo "web_config_bytes=$web_bytes"
echo "dashboard_html_bytes=$html_bytes"

if (( web_bytes >= 500000 )); then
  echo "FAIL: web config must be smaller than 500 KB" >&2
  exit 1
fi

if (( html_bytes >= 500000 )); then
  echo "FAIL: dashboard HTML must be smaller than 500 KB" >&2
  exit 1
fi

if grep -q 'data:image' "$TMP_DIR/dashboard.html"; then
  echo "FAIL: dashboard HTML must not embed data-image payloads" >&2
  exit 1
fi

grep -q '__STEALTH_BOOTSTRAP__' "$TMP_DIR/dashboard.html" || {
  echo "FAIL: dashboard HTML is missing the synchronous public bootstrap" >&2
  exit 1
}

grep -Eq 'menuFor === n\.uuid.*z-\[100\]' "$ROOT/frontend/src/pages/remna-nodes.tsx" || {
  echo "FAIL: open node menu does not elevate the outer card stacking context" >&2
  exit 1
}

grep -q 'publicConfigInFlight' "$ROOT/frontend/src/lib/api.ts" || {
  echo "FAIL: public config requests are not deduplicated" >&2
  exit 1
}

grep -q 'subscriptionPageConfigInFlight' "$ROOT/frontend/src/lib/api.ts" || {
  echo "FAIL: subscription-page requests are not deduplicated" >&2
  exit 1
}

grep -A2 'invalidateSystemConfigCache();' "$ROOT/backend/src/modules/admin/admin.routes.ts" | grep -q 'invalidateBrandCache();' || {
  echo "FAIL: saving settings does not invalidate the SSR bootstrap cache" >&2
  exit 1
}

jq -e '.logo == null or (.logo | startswith("data:") | not)' "$TMP_DIR/web-config.json" >/dev/null
jq -e 'has("logoBot") | not' "$TMP_DIR/web-config.json" >/dev/null

echo "PASS: loading-performance regression checks"
