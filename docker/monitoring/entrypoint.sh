#!/bin/sh
# Writes the internal token to /run/secrets/internal_token (a tmpfs mount owned
# by the prometheus user) so prometheus.yml can reference it by file, writes the
# scrape targets to /run/sd/targets.json (file_sd, also tmpfs), then starts
# Prometheus. The token is never printed.
#
# PROMETHEUS_TARGETS: comma-separated list of `host:port` or `name=host:port`.
# Default: host.docker.internal:3001,host.docker.internal:3002,host.docker.internal:3003
# The `service` label of a target is `name` when given; otherwise it is derived
# from the port (3001 core, 3002 auth, 3003 notifications) or, for any other
# port, from the host name (e.g. `api.internal:8080` -> `api.internal`).
# Example: PROMETHEUS_TARGETS=core=10.0.0.5:3001,auth=10.0.0.6:3002,notifications:3003
set -eu

: "${INTERNAL_API_TOKEN:?INTERNAL_API_TOKEN is required (set it in the root .env)}"

umask 077
printf '%s' "$INTERNAL_API_TOKEN" > /run/secrets/internal_token

TARGETS="${PROMETHEUS_TARGETS:-host.docker.internal:3001,host.docker.internal:3002,host.docker.internal:3003}"
SD_FILE="${PROMETHEUS_SD_FILE:-/run/sd/targets.json}"

out='['
sep=''
old_ifs="$IFS"
IFS=','
for entry in $TARGETS; do
  IFS="$old_ifs"
  # Strip whitespace; skip empty items (trailing comma).
  entry=$(printf '%s' "$entry" | tr -d ' \t\r\n')
  [ -n "$entry" ] || { IFS=','; continue; }
  case "$entry" in
    *[!A-Za-z0-9._:=-]*)
      echo "PROMETHEUS_TARGETS: invalid entry '$entry' (allowed: [A-Za-z0-9._:=-])" >&2
      exit 1
      ;;
  esac
  case "$entry" in
    *=*) name="${entry%%=*}"; addr="${entry#*=}" ;;
    *)
      name=''
      addr="$entry"
      ;;
  esac
  case "$addr" in
    *:*) host="${addr%:*}"; port="${addr##*:}" ;;
    *)
      echo "PROMETHEUS_TARGETS: '$entry' must be host:port" >&2
      exit 1
      ;;
  esac
  if [ -z "$name" ]; then
    case "$port" in
      3001) name=core ;;
      3002) name=auth ;;
      3003) name=notifications ;;
      *) name="$host" ;;
    esac
  fi
  out="$out$sep{\"targets\":[\"$addr\"],\"labels\":{\"service\":\"$name\"}}"
  sep=','
  IFS=','
done
IFS="$old_ifs"
out="$out]"

printf '%s\n' "$out" > "$SD_FILE"

exec /bin/prometheus "$@"
