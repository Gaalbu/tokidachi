#!/usr/bin/env bash
# Runs the GJS API-surface test against the GNOME introspection data installed
# on this machine. Skips (successfully) when GNOME Shell is not available, so
# the suite still runs on non-GNOME machines.
#
# Pass --require (or set TOKIDACHI_REQUIRE_GJS=1) to turn those skips into
# failures. CI uses it: in a container that is supposed to carry the GNOME
# introspection data, a skip means the environment is broken, and a silent
# pass would hide exactly what the job exists to check.
set -euo pipefail

REQUIRE="${TOKIDACHI_REQUIRE_GJS:-0}"
if [ "${1:-}" = "--require" ]; then
    REQUIRE=1
fi

missing() {
    if [ "$REQUIRE" = "1" ]; then
        echo "error: $1" >&2
        exit 1
    fi
    echo "skip: $1"
    exit 0
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v gjs >/dev/null 2>&1; then
    missing "gjs is not installed"
fi

MUTTER_DIR="$(dirname "$(find /usr/lib /usr/lib64 -name 'Meta-*.typelib' 2>/dev/null | head -1)")"
ST_DIR="$(dirname "$(find /usr/lib /usr/lib64 -name 'St-*.typelib' 2>/dev/null | head -1)")"

if [ ! -d "$MUTTER_DIR" ] || [ ! -d "$ST_DIR" ]; then
    missing "mutter/gnome-shell typelibs not found"
fi

export GI_TYPELIB_PATH="$MUTTER_DIR:$ST_DIR${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
export LD_LIBRARY_PATH="$MUTTER_DIR:$ST_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

gjs -m "$ROOT/tests/gjs/api-surface.js"
