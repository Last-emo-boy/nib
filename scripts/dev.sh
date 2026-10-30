#!/bin/sh
# Development: a daemon on port 7461 with its own home (so it never touches the daemon agents use) and
# the editor on Vite's server at http://localhost:5173, both reloading on change.
cd "$(dirname "$0")/.."
export NIB_PORT=${NIB_PORT:-7461}
export NIB_HOME=${NIB_HOME:-/tmp/nib-dev-home}
export NIB_TOKEN=${NIB_TOKEN:-nib-dev-token}
export NIB_DEV_ORIGIN=${NIB_DEV_ORIGIN:-http://localhost:5173}
export NIB_IDLE_MS=${NIB_IDLE_MS:-86400000}
node --watch packages/daemon/src/main.ts &
DAEMON=$!
trap 'kill $DAEMON' EXIT INT TERM
(cd apps/editor && npx vite)
