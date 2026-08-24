# Migrating to Tokidachi 0.3.0

Tokidachi 0.3.0 renames the project, release artifacts, collector, local data
directories, and GNOME extension UUID. GitHub redirects the former repository
URL, but GNOME treats `tokidachi@gaalbu.github.io` as a different extension.
Remove the old UUID once, then install Tokidachi.

## Preserve preferences and remove the old extension

Run this before the Tokidachi installer:

```bash
set -euo pipefail
OLD_UUID='ai-usage-widget@gaalbu.github.io'
OLD_DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$OLD_UUID"
OLD_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/ai-usage-widget"
NEW_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/tokidachi"

gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
if [[ -d "$OLD_CONFIG" && ! -e "$NEW_CONFIG" ]]; then
    cp -a -- "$OLD_CONFIG" "$NEW_CONFIG"
fi
if [[ -d "$OLD_DEST" ]]; then
    gio trash "$OLD_DEST"
fi
```

Copying the state preserves the theme, minimized state, position, and scale.
Tokidachi creates a new usage-only cache under
`$XDG_CACHE_HOME/tokidachi/usage.json`. The old cache contains no credentials,
so you may remove it at any time.

Install Tokidachi with the command from the main README. On GNOME Wayland,
log out and back in once so Shell discovers the new UUID.

## Name mapping

| Before 0.3.0 | Tokidachi 0.3.0 |
|---|---|
| `Gaalbu/ai-usage-widget` | `Gaalbu/tokidachi` |
| `ai-usage-widget@gaalbu.github.io` | `tokidachi@gaalbu.github.io` |
| `ai-usage-widget-linux-x86_64.tar.gz` | `tokidachi-linux-x86_64.tar.gz` |
| `~/.config/ai-usage-widget` | `~/.config/tokidachi` |
| `~/.cache/ai-usage-widget` | `~/.cache/tokidachi` |
