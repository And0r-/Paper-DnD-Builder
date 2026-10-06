#!/usr/bin/env bash
# Starts and stops a local review server for this checkout: an in-memory
# database, a mail folder instead of SMTP, and the demo package unless
# another package is given. State lives in .dev-server/ of this checkout, so
# several checkouts can run side by side without touching each other.
#
#   scripts/dev-server.sh [start] [--packages DIR] [--port N] [--dev] [--build]
#   scripts/dev-server.sh status
#   scripts/dev-server.sh stop
#
#   --packages DIR  PACKAGES_DIR: one package or a folder of packages
#                   (e.g. packages-mount/); default packages/demo-package
#   --port N        fixed port instead of the first free one in the range
#   --dev           `next dev` instead of a production build (`next start`)
#   --build         rebuild before `next start` (it builds anyway if no
#                   build exists yet)
#
# DATABASE_URL, MAIL_OUTBOX_DIR and BASE_URL are used as given if set.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
web="$root/apps/web"
state="$root/.dev-server"
pidfile="$state/server.pid"
portfile="$state/server.port"
logfile="$state/server.log"
tools_env=${BUILDER_TOOLS_ENV:-/paperclip/instances/default/workspaces/_tools/env.sh}

# Port ranges per agent, so parallel review servers never pick the same
# port. Unknown callers share the last range.
port_range() {
  case "${PAPERCLIP_AGENT_ID:-}" in
    aaee5765-*) echo "4100 4119" ;; # Baumeister
    256c08ac-*) echo "4200 4219" ;; # Gestalter
    7d3c4a42-*) echo "4300 4319" ;; # Regelprüfer
    b517644b-*) echo "4400 4419" ;; # Archivar
    db5d315a-*) echo "4500 4519" ;; # Neuling
    db77521d-*) echo "4600 4619" ;; # Chief
    *) echo "4900 4999" ;;
  esac
}

# A port is free if nothing listens on it (same bind as `next start`).
port_free() {
  node -e 'require("node:net").createServer().once("error", () => process.exit(1)).listen(Number(process.argv[1]), () => process.exit(0))' "$1"
}

# Only a live process that is still our server counts; a stale PID may by
# now belong to something else.
running_pid() {
  [[ -f "$pidfile" ]] || return 1
  local pid
  pid=$(<"$pidfile")
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null || return 1
  grep -qa next "/proc/$pid/cmdline" 2>/dev/null || return 1
  echo "$pid"
}

cmd_status() {
  local pid
  if pid=$(running_pid); then
    echo "running: pid $pid, http://localhost:$(<"$portfile")"
  else
    echo "not running"
    return 1
  fi
}

cmd_stop() {
  local pid
  if ! pid=$(running_pid); then
    echo "not running"
    rm -f "$pidfile" "$portfile"
    return 0
  fi
  # The server was started as leader of its own session: signal exactly that
  # process group (the server and its workers), nothing else.
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile" "$portfile"
  echo "stopped pid $pid"
}

cmd_start() {
  local packages="$root/packages/demo-package" port="" mode=start build=no
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --packages) packages=$2; shift 2 ;;
      --port) port=$2; shift 2 ;;
      --dev) mode=dev; shift ;;
      --build) build=yes; shift ;;
      *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
  done

  if cmd_status >/dev/null 2>&1; then
    echo "already running: $(cmd_status)" >&2
    exit 1
  fi
  packages=$(cd "$packages" && pwd) || { echo "no such folder: $packages" >&2; exit 2; }

  if [[ -z "$port" ]]; then
    local from to p
    read -r from to < <(port_range)
    for ((p = from; p <= to; p++)); do
      if port_free "$p"; then port=$p; break; fi
    done
    [[ -n "$port" ]] || { echo "no free port in $from-$to" >&2; exit 1; }
  elif ! port_free "$port"; then
    echo "port $port is in use" >&2
    exit 1
  fi

  # Chromium variables for Playwright runs against this server; values that
  # are already set win (env.sh only fills in missing ones).
  if [[ -f "$tools_env" ]]; then
    # shellcheck source=/dev/null
    . "$tools_env"
  fi

  mkdir -p "$state/outbox"
  if [[ "$mode" == start && ( "$build" == yes || ! -f "$web/.next/BUILD_ID" ) ]]; then
    echo "building (log: $state/build.log) ..."
    (cd "$root" && NEXT_TELEMETRY_DISABLED=1 pnpm build) >"$state/build.log" 2>&1 || {
      tail -30 "$state/build.log" >&2
      exit 1
    }
  fi

  (
    cd "$web"
    export DATABASE_URL="${DATABASE_URL:-pglite:memory}"
    export MAIL_OUTBOX_DIR="${MAIL_OUTBOX_DIR:-$state/outbox}"
    export BASE_URL="${BASE_URL:-http://localhost:$port}"
    export PACKAGES_DIR="$packages"
    export NEXT_TELEMETRY_DISABLED=1
    exec setsid "$web/node_modules/.bin/next" "$mode" -p "$port" </dev/null >"$logfile" 2>&1
  ) &
  local pid=$!
  echo "$pid" >"$pidfile"
  echo "$port" >"$portfile"

  for _ in $(seq 1 120); do
    if curl -sf "http://localhost:$port/api/health" >/dev/null 2>&1; then
      echo "ready: http://localhost:$port (pid $pid, packages $packages)"
      echo "mail: $state/outbox  log: $logfile"
      grep -h "^Packages: \|REJECTED\|FAILED" "$logfile" || true
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.5
  done
  echo "server did not become ready; last log lines:" >&2
  tail -30 "$logfile" >&2
  cmd_stop >/dev/null
  exit 1
}

case "${1:-start}" in
  start) shift || true; cmd_start "$@" ;;
  --*) cmd_start "$@" ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *) echo "usage: $0 [start [options]] | status | stop" >&2; exit 2 ;;
esac
