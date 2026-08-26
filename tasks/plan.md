# Implementation Plan: Widget language selection

## Overview

Add English and Brazilian Portuguese UI translations, defaulting to the system
language, with an in-widget language selector whose choice persists across Shell
restarts.

## Architecture Decisions

- Keep translations in a small pure JavaScript module so locale resolution and
  fallback behavior can be unit tested outside GNOME Shell.
- Store the user's selection (`auto`, `en`, or `pt-BR`) in the existing UI state;
  `auto` resolves from GNOME's language list.
- Translate widget-owned copy only. Provider names, collector errors, window
  labels, and reset descriptions remain source data.

## Task List

### Phase 1: Translation foundation

- [x] Add failing tests for locale resolution, fallback, and interpolation.
- [x] Implement the translation catalog and helper functions.

### Checkpoint: Translation foundation

- [x] Focused localization tests pass.

### Phase 2: Widget integration

- [x] Add a language row to the widget menu and persist its selection.
- [x] Refresh visible copy immediately when the language changes.
- [x] Include the localization module in install and release packages.
- [x] Document the language behavior.

### Checkpoint: Complete

- [x] JavaScript and Java tests pass.
- [x] Packaging scripts include every runtime module.
- [x] Static syntax checks and quality scan pass.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| GNOME locale names include encoding or region suffixes | Wrong fallback to English | Normalize locale separators and inspect the ordered system language list |
| Switching language leaves stale dynamic labels | Mixed-language UI | Re-render the last usage or failure state after changing language |
| New module omitted from installed extension | Runtime import failure | Update and test both installer and packaging file lists |

## Open Questions

- None. The selector cycles through System, English, and Portuguese (Brazil).
