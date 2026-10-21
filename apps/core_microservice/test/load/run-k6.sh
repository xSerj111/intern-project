#!/usr/bin/env bash
# Runs the k6 key-endpoints profile in a pinned grafana/k6 image and writes
# test/load/reports/$REPORT.json (contracts/perf-tooling.md).
#
# Usage: MODE=measure FLOW=legacy REPORT=baseline PERF_PASSWORD=... bash run-k6.sh
# Env:   MODE (measure), FLOW (legacy|current, default current), REPORT (default baseline),
#        CORE_URL (http://localhost:3001), AUTH_URL (http://localhost:3002),
#        PERF_PASSWORD (shared perf seed password, default PerfPassword123!),
#        INTERNAL_API_TOKEN (passed through; read from the root .env when unset),
#        ENV_NOTES (free text for the report).
# Cache hit ratio (SC-009): /metrics is scraped before and after k6 and
# cache.profileHitRatio is merged into the report. In MODE=gate a ratio below
# 0.80 fails the run (exit 1) when k6 itself passed. Otherwise the exit code is k6's.
set -uo pipefail

K6_IMAGE="grafana/k6:1.0.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

MODE="${MODE:-measure}"
FLOW="${FLOW:-current}"
REPORT="${REPORT:-baseline}"
CORE_URL="${CORE_URL:-http://localhost:3001}"
AUTH_URL="${AUTH_URL:-http://localhost:3002}"

# Default = PERF_PASSWORD in seed/perf.ts
PERF_PASSWORD="${PERF_PASSWORD:-PerfPassword123!}"

cpu_model="$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ *//')"
ENV_CPU="${cpu_model:-unknown} ($(nproc) cores)"
ENV_MEM_GB="$(awk '/MemTotal/ { printf "%d", $2 / 1024 / 1024 + 0.5 }' /proc/meminfo 2>/dev/null)"
ENV_OS="$(uname -sr)"
ENV_NODE="$(node -v 2>/dev/null || echo unknown)"
GIT_REVISION="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]; then
  GIT_REVISION="${GIT_REVISION}-dirty"
fi

# The token only travels through curl's stdin config and docker's env, never argv or output.
if [ -z "${INTERNAL_API_TOKEN:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
  INTERNAL_API_TOKEN="$(grep -m1 '^INTERNAL_API_TOKEN=' "$REPO_ROOT/.env" | cut -d= -f2- | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
fi
INTERNAL_API_TOKEN="${INTERNAL_API_TOKEN:-}"

REPORT_FILE="$SCRIPT_DIR/reports/$REPORT.json"
MIN_HIT_RATIO="0.8"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Sums cache_requests_total{resource="profile",result=hit|miss} over all other labels.
# Prints "<hit> <miss>".
SUM_JS='
const fs = require("fs");
let hit = 0, miss = 0;
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n")) {
  const m = /^cache_requests_total\{(.*)\}\s+(\S+)\s*$/.exec(line);
  if (!m) continue;
  const labels = {};
  for (const l of m[1].matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2];
  if (labels.resource !== "profile") continue;
  const v = Number(m[2]);
  if (!Number.isFinite(v)) continue;
  if (labels.result === "hit") hit += v;
  else if (labels.result === "miss") miss += v;
}
console.log(hit + " " + miss);
'

# Merges cache.profileHitRatio into the report JSON: <report> <ratio>
MERGE_JS='
const fs = require("fs");
const [file, ratio] = process.argv.slice(1);
const report = JSON.parse(fs.readFileSync(file, "utf8"));
report.cache = { ...(report.cache || {}), profileHitRatio: Number(ratio) };
fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
'

# scrape_cache <out-var-prefix>: sets <prefix>_STATUS (ok|missing|error), <prefix>_HIT, <prefix>_MISS.
scrape_cache() {
  local prefix="$1" file="$WORK_DIR/metrics.$1.txt" code sums
  code="$(printf 'header = "X-Internal-Token: %s"\n' "$INTERNAL_API_TOKEN" |
    curl -sS -K - --max-time 10 -o "$file" -w '%{http_code}' "$CORE_URL/metrics" 2>/dev/null)" || code="000"
  case "$code" in
    200)
      if sums="$(node -e "$SUM_JS" "$file" 2>/dev/null)"; then
        printf -v "${prefix}_STATUS" ok
        printf -v "${prefix}_HIT" '%s' "${sums% *}"
        printf -v "${prefix}_MISS" '%s' "${sums#* }"
      else
        printf -v "${prefix}_STATUS" error
      fi
      ;;
    404) printf -v "${prefix}_STATUS" missing ;;
    *)
      echo "WARNING: GET $CORE_URL/metrics returned HTTP $code" >&2
      printf -v "${prefix}_STATUS" error
      ;;
  esac
}

mkdir -p "$SCRIPT_DIR/reports"

BEFORE_STATUS=error BEFORE_HIT=0 BEFORE_MISS=0
scrape_cache BEFORE
touch "$WORK_DIR/started"

docker run --rm \
  --network host \
  --user "$(id -u):$(id -g)" \
  -v "$SCRIPT_DIR:/load" \
  -w /load \
  -e MODE="$MODE" \
  -e FLOW="$FLOW" \
  -e REPORT="$REPORT" \
  -e CORE_URL="$CORE_URL" \
  -e AUTH_URL="$AUTH_URL" \
  -e PERF_PASSWORD="$PERF_PASSWORD" \
  -e INTERNAL_API_TOKEN="${INTERNAL_API_TOKEN:-}" \
  -e GIT_REVISION="$GIT_REVISION" \
  -e ENV_CPU="$ENV_CPU" \
  -e ENV_MEM_GB="$ENV_MEM_GB" \
  -e ENV_OS="$ENV_OS" \
  -e ENV_NODE="$ENV_NODE" \
  -e ENV_NOTES="${ENV_NOTES:-}" \
  "$K6_IMAGE" run /load/k6/key-endpoints.js
K6_EXIT=$?

AFTER_STATUS=error AFTER_HIT=0 AFTER_MISS=0
scrape_cache AFTER

# Hit ratio over the whole run, warm-up included, which makes the check conservative.
if [ "$BEFORE_STATUS" = missing ] || [ "$AFTER_STATUS" = missing ]; then
  echo "WARNING: /metrics returned 404 (pre-B6 code?), skipping the cache hit ratio check" >&2
  exit "$K6_EXIT"
fi

RATIO=""
if [ "$BEFORE_STATUS" = ok ] && [ "$AFTER_STATUS" = ok ]; then
  RATIO="$(node -e '
    const [bh, bm, ah, am] = process.argv.slice(1).map(Number);
    const hit = ah - bh, miss = am - bm;
    if (hit < 0 || miss < 0 || hit + miss === 0) process.exit(0);
    console.log((hit / (hit + miss)).toFixed(4));
  ' "$BEFORE_HIT" "$BEFORE_MISS" "$AFTER_HIT" "$AFTER_MISS")"
fi

if [ -z "$RATIO" ]; then
  echo "WARNING: cache hit ratio unavailable (metrics scrape failed, counters reset or no profile cache traffic)" >&2
  if [ "$MODE" = gate ] && [ "$K6_EXIT" -eq 0 ]; then
    echo "FAILED cache:profileHitRatio unavailable"
    exit 1
  fi
  exit "$K6_EXIT"
fi

echo "cache:profileHitRatio $RATIO"
if [ "$REPORT_FILE" -nt "$WORK_DIR/started" ]; then
  node -e "$MERGE_JS" "$REPORT_FILE" "$RATIO" || echo "WARNING: could not merge cache ratio into $REPORT_FILE" >&2
fi

if [ "$MODE" = gate ] && [ "$K6_EXIT" -eq 0 ] &&
  awk -v r="$RATIO" -v min="$MIN_HIT_RATIO" 'BEGIN { exit !(r < min) }'; then
  echo "FAILED cache:profileHitRatio $RATIO < 0.80"
  exit 1
fi
exit "$K6_EXIT"
