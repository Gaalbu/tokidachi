# Cross-platform desktop host decision

Tokidachi has two layers:

1. The Java collector emits a portable, versioned JSON document.
2. The current presentation host is a GNOME Shell extension.

Windows and macOS cannot run a GNOME Shell extension, so cross-platform work
must add a host instead of attempting to port `extension.js`.

## v0.4.0 decision

Keep the collector JSON as the only shared interface and prototype a separate
desktop companion per operating system. A supported host must run the collector
as a child process, validate the JSON before rendering it, refresh on a bounded
timer, show an explicit collector failure state, and provide installation and
uninstall instructions.

The first host slice deliberately excludes GNOME-specific drag behavior,
mascot animation, and visual parity. Those are presentation features, not part
of the collector contract.

## Release gate

Tokidachi may claim support for Windows or macOS only after that host has:

- a reproducible artifact built in CI;
- a smoke test that starts the collector and renders valid fixture data;
- a manual test on the target operating system; and
- documented authentication, install, update, and uninstall behavior.

Until then, the official supported desktop host remains GNOME Shell on Linux.
