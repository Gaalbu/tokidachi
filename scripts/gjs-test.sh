#!/usr/bin/env bash
# Runs the GJS API-surface test against the GNOME introspection data installed
# on this machine. Skips (successfully) when GNOME Shell is not available, so
# the suite still runs on non-GNOME machines and in CI containers.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v gjs >/dev/null 2>&1; then
    echo "skip: gjs is not installed"
    exit 0
fi

MUTTER_DIR="$(dirname "$(find /usr/lib /usr/lib64 -name 'Meta-*.typelib' 2>/dev/null | head -1)")"
ST_DIR="$(dirname "$(find /usr/lib /usr/lib64 -name 'St-*.typelib' 2>/dev/null | head -1)")"

if [ ! -d "$MUTTER_DIR" ] || [ ! -d "$ST_DIR" ]; then
    echo "skip: mutter/gnome-shell typelibs not found"
    exit 0
fi

export GI_TYPELIB_PATH="$MUTTER_DIR:$ST_DIR${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
export LD_LIBRARY_PATH="$MUTTER_DIR:$ST_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

gjs -m "$ROOT/tests/gjs/api-surface.js"
