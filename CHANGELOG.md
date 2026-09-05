# Changelog

All notable changes to Tokidachi are recorded here. Versions follow the
collector version in `pom.xml`; the GNOME extension version lives in
`tokidachi@gaalbu.github.io/metadata.json`.

## 0.4.0 — 2026-09-05

### Added

- Opt-in OpenAI and Anthropic API cost estimates, configured per adapter in
  `config/api-usage.json` and shipped disabled by default.
- OpenCode session activity provider.
- `layer` setting (`auto`, `desktop`, `overlay`) in `config.json` and in the
  widget menu, translated in English and Portuguese (Brazil).
- Native collector builds for Windows and macOS in CI.
- `tests/extension-behavior.test.js`: the extension now runs against a stub
  GNOME Shell (`tests/harness`) covering layers, grabs, placement, storage and
  teardown.
- `tests/gjs/api-surface.js` (via `scripts/gjs-test.sh`): checks every Clutter,
  Meta, St, GLib and Gio symbol the extension uses against the GNOME
  introspection data installed on the machine, and skips cleanly elsewhere.

### Fixed

- **The widget could be visible but completely unresponsive when other GNOME
  extensions were installed.** Tokidachi parked its card in the wallpaper layer
  and relied on `trackChrome()` for input. That only defines the shell's input
  region against windows, so anything else that claims the desktop — desktop
  icon extensions, which map a `DESKTOP`-type window over the whole screen, or
  wallpaper and blur effects, which stack actors on top of the background
  group — swallowed every pointer event. The card kept rendering, but dragging,
  clicking and the right-click menu all stopped working. Reported on GNOME 46 /
  Zorin OS.

  Tokidachi now detects that situation and moves itself to the overlay
  (chrome) layer on its own, logging the culprit:

  ```
  [Tokidachi] desktop layer input is blocked by desktop window "gjs"; switching the widget to the overlay layer
  ```

  When the conflict is only a stacking order inside the background group, the
  card reclaims the top of that group instead, and stays in the desktop layer.
  A **Layer** entry in the right-click menu (`Automatic → Desktop → On top`)
  and a `layer` key in `config.json` allow pinning the behaviour by hand.

- **Dragging and resizing could die halfway through.** Both listened for
  pointer motion on the stage, which never sees events that another window
  consumed. They now hold a `Clutter.Grab` on the card, so the interaction
  follows the pointer regardless of what is on top. The right-click menu holds
  the same grab, so clicking outside always closes it.

- The layer audit is retried when the card is first mapped and when it is
  first allocated: an unmapped or unallocated card has no geometry to test, so
  a conflict present at startup used to go unnoticed.

- A fresh install no longer logs `Invalid layout state` for the `layout.json`
  file it has not written yet.

- A collector reply that arrives after `disable()` no longer lands on a
  destroyed widget tree.

- Codex usage limits follow the current upstream format again.
- The release archive includes `config/api-usage.json`.

### Changed

- The collector `User-Agent` reports `tokidachi/0.4.0` on every provider; the
  two request paths had drifted to different versions.
- Extension `version` bumped to 6 for extensions.gnome.org.
