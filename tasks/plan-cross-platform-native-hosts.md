# Plan: native Windows and macOS hosts under the Tokidachi umbrella

## Decision (recorded 2026-09-02)

Three repositories, three native hosts, one shared collector contract:

- **`tokidachi`** (this repo) — Linux/GNOME Shell host + the Java collector.
  Stays the source of truth for the collector and the JSON contract.
- **`tokidachiWin`** (new repo) — Windows host, **WinUI 3 / .NET**, tray app.
- **`tokidachiMac`** (new repo) — macOS host, **Swift/AppKit/SwiftUI**, menu
  bar app, styled after `yurirxmos/metria`'s architecture.

Rejected: Electron/Tauri for either host. Both platforms get a fully native
rewrite of the presentation layer; nothing in `extension.js`/`providerModel.js`/
`i18n.js` is reused code, only reused *behavior* (what a card shows, how
percentages/notices/theme states map to UI). Rejected: merging Windows+macOS
into one repo — since neither shares a runtime with the other, a shared repo
would only add coordination overhead, mirroring the reasoning in
`docs/CROSS_PLATFORM.md` and `yurirxmos/metria`'s plan 001, which kept native
macOS and the Electron companion apart because they share no source.

This extends, not replaces, `docs/CROSS_PLATFORM.md`: that document decided
"a host per OS consuming the collector's JSON," this plan picks the stack and
repo for each host and sequences the work.

## Why Tokidachi's starting position is better than Metria's was

Metria had to reimplement provider/credential logic per platform because its
shared code was Swift/AppKit, which cannot run outside macOS. Tokidachi
already separated that: the collector is Java 21, compiles to a GraalVM
native image, and a portability audit of its provider code shows it is close
to platform-neutral already:

- `ClaudeProvider` resolves `~/.claude/.credentials.json` via
  `CLAUDE_CONFIG_DIR` env var, falling back to `HOME`/`user.home`
  (`ClaudeProvider.java:86,104,107`) — no POSIX-only path assumption. Claude
  Code CLI is documented to use the same `~/.claude` layout on Windows and
  macOS, but this has **not been verified against a real Windows/macOS Claude
  Code install** and must be confirmed in Phase 0 below before any host
  claims Claude support.
- `CodexProvider` shells out to `codex app-server --stdio` on `PATH`
  (JSON-RPC `account/rateLimits/read`) instead of reading Codex's auth file
  directly — this should work unmodified wherever the `codex` binary is
  installed and logged in, Windows included.
- `CacheStore.setPermissions` already catches
  `UnsupportedOperationException` when POSIX permissions aren't available
  (`CacheStore.java:104-109`), so it degrades gracefully on Windows (NTFS
  ACLs instead of `0600`) instead of crashing.

The real unknowns are GraalVM native-image builds for `windows-x86_64` and
`macos-x86_64`/`macos-aarch64` (untested — only `ubuntu-24.04` builds today
per `ci.yml`), and whether the JVM fallback (`java -jar tokidachi-*-all.jar`)
is an acceptable stopgap for a host's first release if native-image proves
harder on a given OS.

## Umbrella branding across three repos

Keep the "Metria pattern" for making three repos read as one product:

- Same owner (`gaalbu`), same product name (`Tokidachi`) in every repo title,
  same mascot/theme language and screenshots style across all three READMEs.
- Each repo's README states plainly which OS it covers and links to the other
  two ("Windows? see tokidachiWin. macOS? see tokidachiMac.") — exactly the
  gap identified in Metria's setup, where the two repos don't cross-link or
  share a landing page.
- A single downloads entry point: either a short landing page (GitHub Pages,
  since `tokidachi@gaalbu.github.io` already exists as a namespace) that
  detects the visitor's OS and links straight to the right release asset, or
  at minimum an OS-picker table repeated verbatim in all three READMEs. Build
  this once the first non-Linux release ships — don't block Phase 1 on it.
- Each repo keeps its own release tags/channels (`v*` stays Linux/collector,
  propose `win-v*` and `mac-v*`), so a broken Windows release never blocks a
  macOS or Linux release, mirroring Metria's `macos-v*` / `electron-v*` split.

## Shared contract: what must not fork

- The JSON contract (`version`, `providers.<id>.{displayName,color,pet,status,
  configured,windows,notices}`, optional `apiUsage`) stays owned by this repo.
  `tokidachiWin` and `tokidachiMac` are pure consumers — they must not
  reimplement provider parsing, only render what the collector emits.
- Both new hosts bundle the *same* per-OS collector binary this repo produces
  in CI; they never fork `ClaudeProvider`/`CodexProvider` logic into C#/Swift.
  If a host needs a new field, it is proposed as an additive change here
  first (same rule Metria enforces for its protocol fixtures).
- Add non-secret fixture JSON documents (`ok`, `error`, `stale`,
  multi-provider, empty) to this repo under e.g. `fixtures/collector/`, so
  `tokidachiWin`/`tokidachiMac` can build and CI-test their rendering without
  a live collector or real credentials — this is the missing piece Metria's
  plan 001 called "Phase 0" and is worth doing here before either new repo's
  first PR.

## Phase 0 — prove collector portability (do this in `tokidachi`, before creating the new repos)

1. Add `windows-latest` and `macos-latest` jobs to `ci.yml` that run
   `mvn -Pnative package` and smoke-test `--pretty` against a fixture-only
   environment (isolated `CLAUDE_CONFIG_DIR`/`CODEX_HOME`, no real
   credentials) — confirms native-image actually builds on both OSes before
   any host work depends on it.
2. Manually verify, on one real Windows machine and one real Mac, that a
   logged-in Claude Code CLI populates `~/.claude/.credentials.json` (or the
   Windows-equivalent home path) in the same shape the collector already
   parses, and that `codex app-server --stdio` behaves identically. This is
   the single biggest risk in the whole plan — if credential discovery
   differs, **stop and fix the collector first**, before either new host is
   written against a false assumption.
3. Publish `fixtures/collector/*.json` (ok/error/stale/multi-provider/empty)
   for the new hosts to build against.

**Gate:** native image builds green in CI on all three OSes, or a documented,
explicit fallback (ship the JAR + bundled JRE) is chosen per OS; credential
discovery confirmed on real Windows and macOS installs, not inferred from
docs.

## Phase 1 — `tokidachiMac` (Swift/AppKit/SwiftUI menu bar app)

Scope mirrors Metria's own "vertical slice" gate: tray/menu-bar icon,
dashboard popover with per-provider cards, manual refresh, explicit
collector-failure state. No drag-anywhere widget, no mascot animation, no
theme cycling in v1 — those are the same "presentation extras, not part of
the collector contract" items `docs/CROSS_PLATFORM.md` already excluded.

1. New repo `tokidachiMac`, macOS 13+ target (matches Metria's floor).
2. App bundles the macOS collector binary from Phase 0, launches it as a
   child process on a timer (mirrors `UsageStore`'s poll loop in Metria),
   parses the same JSON contract.
3. Menu bar status item + popover with static SwiftUI cards per provider
   (icon, status, window percentages, notices). No custom mascot rendering
   yet — reuse the provider SVGs as plain `NSImage`/`Image` assets.
4. Persist settings (enabled providers, refresh interval) in
   `UserDefaults`, namespaced separately from anything else on the machine.
5. Packaging: unsigned `.app`/`.zip` first (ad hoc signed, like Metria's
   current state), Developer ID signing/notarization and Sparkle as a
   follow-up once the vertical slice is proven — don't block v1 on paid
   Apple Developer enrollment if that's a blocker for you.

**Gate:** reproducible CI build on `macos-latest`, smoke test renders a
fixture JSON correctly, manual test on a real Mac with a real Claude/Codex
login, install/uninstall documented.

## Phase 2 — `tokidachiWin` (WinUI 3 / .NET tray app)

Same vertical-slice scope as Phase 1, adapted to Windows idioms.

1. New repo `tokidachiWin`, WinUI 3 + .NET (pick LTS .NET, e.g. .NET 8/9),
   packaged with MSIX for install/uninstall/auto-update hooks Windows users
   expect.
2. Tray icon (`NotifyIcon`/`H.NotifyIcon` for WinUI) + a flyout/window with
   the same per-provider cards as macOS, built independently in XAML — no
   shared UI code with `tokidachiMac`, only the shared JSON shape.
3. Bundle the Windows collector binary from Phase 0; if native-image proves
   unreliable on Windows, ship the shaded JAR plus a documented JRE
   requirement as an explicit, disclosed fallback rather than silently
   degrading.
4. Settings persisted via `ApplicationData.Current.LocalSettings` or a local
   settings file under `%LOCALAPPDATA%\Tokidachi`.
5. Packaging: MSIX, unsigned/self-signed first (Windows will show a
   SmartScreen warning, same category of friction Metria currently has on
   its Electron Windows build) — document the workaround, defer paid
   code-signing to a later phase.

**Gate:** reproducible CI build on `windows-latest`, smoke test renders a
fixture JSON correctly, manual test on real Windows with a real Claude/Codex
login (native Windows install, not WSL, for v1 — WSL credential discovery is
explicitly out of scope until the native path is proven), install/uninstall
documented.

## Explicit non-goals for Phase 1/2

- Pixel parity with the GNOME widget's drag/resize/pill-minimize interaction.
- Mascot motion/animation states.
- Theme cycling (Dark/Light/Glass).
- WSL-based credential discovery on Windows.
- API-usage/cost section (`apiUsage`) rendering — ship it once the base
  provider cards are stable on both new hosts; it's already gated behind its
  own opt-in flag in the collector, so omitting it from v1 breaks nothing.
- Any shared UI code or shared repo between `tokidachiWin` and `tokidachiMac`.

## Risks

| Risk | Mitigation |
| --- | --- |
| GraalVM native-image fails or is flaky on Windows/macOS CI runners | Fall back to shipping the shaded JAR with a bundled/required JRE per OS, disclosed in the README, not silently |
| Claude/Codex credential layout differs on Windows/macOS from the Linux assumption baked into the collector | Phase 0 manual verification gates all host work; fix the collector first, never fork provider logic per host |
| Three repos drift in branding/behavior over time | Shared fixtures in `tokidachi/fixtures/collector/`, cross-linked READMEs, and an explicit rule that new JSON fields land in the collector repo first |
| Unsigned installers trigger OS security warnings (Gatekeeper / SmartScreen) | Document the workaround in v1 (same as Metria today); schedule paid signing/notarization as a separate, later phase, not a v1 blocker |
| Windows tray/WinUI packaging (MSIX) has its own quirks (sideloading, cert requirements) | Time-box a packaging spike in Phase 2 before writing UI, same as Metria's package-macos.sh dry-run discipline |

## Done criteria

- [ ] Phase 0 gate passed: native-image (or documented fallback) green on
  Linux, Windows, macOS in CI; credential discovery confirmed on real
  Windows and macOS machines.
- [ ] `fixtures/collector/*.json` published and referenced by both new repos.
- [ ] `tokidachiMac` v1: tray/menu bar + dashboard + manual refresh + failure
  state, CI-built, manually tested on a real Mac, install/uninstall
  documented.
- [ ] `tokidachiWin` v1: tray + dashboard + manual refresh + failure state,
  CI-built via MSIX, manually tested on real Windows, install/uninstall
  documented.
- [ ] All three READMEs cross-link and state their OS scope plainly; no repo
  claims support for an OS it doesn't build/test.
- [ ] Neither new repo contains a forked copy of provider/credential parsing
  logic; both consume the collector's JSON contract only.

## Open questions for you

- Personal GitHub account or an org for the umbrella (affects whether
  `tokidachiWin`/`tokidachiMac` are created under `gaalbu` or a new org)?
- Do you have a paid Apple Developer account already (for eventual
  notarization), or should that stay an explicit "not yet" like Metria's
  current ad hoc signing?
- Any preference on .NET version / MSIX vs. a plain installer (Squirrel.Windows,
  Inno Setup) for `tokidachiWin` if MSIX sideloading friction turns out to be
  worse than expected in the Phase 2 packaging spike?
