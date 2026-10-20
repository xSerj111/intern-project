#!/usr/bin/env bash
# Runs the k6 key-endpoints profile in a pinned grafana/k6 image and writes
# test/load/reports/$REPORT.json (contracts/perf-tooling.md).
#
# Usage: MODE=measure FLOW=legacy REPORT=baseline PERF_PASSWORD=... bash run-k6.sh
# Env:   MODE (measure), FLOW (legacy|current, default current), REPORT (default baseline),
#        CORE_URL (http://localhost:3001), AUTH_URL (http://localhost:3002),
#        PERF_PASSWORD (shared perf seed password, default PerfPassword123!),
#        INTERNAL_API_TOKEN (passed through), ENV_NOTES (free text for the report).
# Exit code is k6's.
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

mkdir -p "$SCRIPT_DIR/reports"

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
exit $?
