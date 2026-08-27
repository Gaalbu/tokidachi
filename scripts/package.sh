#!/usr/bin/env bash
set -euo pipefail

readonly UUID='tokidachi@gaalbu.github.io'
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly COLLECTOR="${1:-$PROJECT_DIR/target/tokidachi}"
readonly STAGE_ROOT="$PROJECT_DIR/build/release"
readonly EXTENSION_STAGE="$STAGE_ROOT/$UUID"
readonly DIST_DIR="$PROJECT_DIR/dist"

if [[ ! -x "$COLLECTOR" ]]; then
    echo "Native collector not found or not executable: $COLLECTOR" >&2
    exit 1
fi

rm -rf -- "$STAGE_ROOT"
mkdir -p "$EXTENSION_STAGE" "$STAGE_ROOT/scripts" "$STAGE_ROOT/config" "$DIST_DIR"
for file in metadata.json extension.js i18n.js providerModel.js stylesheet.css config.json; do
    install -m 0644 "$PROJECT_DIR/$UUID/$file" "$EXTENSION_STAGE/$file"
done
cp -a -- "$PROJECT_DIR/$UUID/pets" "$EXTENSION_STAGE/pets"
install -m 0755 "$COLLECTOR" "$EXTENSION_STAGE/collector"
install -m 0755 "$PROJECT_DIR/scripts/install.sh" "$STAGE_ROOT/scripts/install.sh"
install -m 0755 "$PROJECT_DIR/scripts/uninstall.sh" "$STAGE_ROOT/scripts/uninstall.sh"
install -m 0644 "$PROJECT_DIR/config/api-usage.json" "$STAGE_ROOT/config/api-usage.json"

(
    cd "$EXTENSION_STAGE"
    zip -q -r "$DIST_DIR/$UUID.shell-extension.zip" .
)
tar -C "$STAGE_ROOT" -czf "$DIST_DIR/tokidachi-linux-x86_64.tar.gz" "$UUID" scripts config
printf 'Created:\n  %s\n  %s\n' \
    "$DIST_DIR/$UUID.shell-extension.zip" \
    "$DIST_DIR/tokidachi-linux-x86_64.tar.gz"
