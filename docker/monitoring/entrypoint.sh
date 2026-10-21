#!/bin/sh
# Writes the internal token to /run/secrets/internal_token (a tmpfs mount owned
# by the prometheus user) so prometheus.yml can reference it by file, then
# starts Prometheus. The token is never printed.
set -eu

: "${INTERNAL_API_TOKEN:?INTERNAL_API_TOKEN is required (set it in the root .env)}"

umask 077
printf '%s' "$INTERNAL_API_TOKEN" > /run/secrets/internal_token

exec /bin/prometheus "$@"
