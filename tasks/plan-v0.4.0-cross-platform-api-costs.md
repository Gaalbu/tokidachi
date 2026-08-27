# Roadmap plan: v0.4.0 cross-platform support and optional API cost estimates

## Goal

Create two focused GitHub issues that become the source of truth for a later
implementation plan and PRs: one for Windows/macOS support and one for an
opt-in API-usage and estimated-cost section. Propose `v0.4.0` as the next
minor release milestone; do not promise that every platform host ships in the
first PR.

## Current constraints

- The collector is Java 21 and can be compiled as a native executable, but the
  visual host is a GNOME Shell extension and therefore Linux/GNOME-specific.
- The collector-to-widget JSON contract is version 1. New data must be additive
  so existing extensions ignore it safely.
- Claude/Codex subscription windows are already privacy-conscious: credentials
  are not logged or cached. API keys and spend data require the same or a
  stronger boundary.
- Discovery confirmed that the documented OpenAI and Anthropic cost APIs are
  organization-admin interfaces. Individual accounts cannot be promised API
  cost reporting without another documented provider path.

## Issue 1: Cross-platform desktop support for Windows and macOS

**Proposed title:** `feat: plan Windows and macOS desktop support`

**Labels:** `enhancement`, `architecture`

**Milestone proposal:** `v0.4.0`

**Issue scope:**

1. Document the split between the reusable collector contract and the current
   GNOME-specific host.
2. Compare supported host options for Windows and macOS (native companion,
   menu-bar/tray application, or another maintained desktop runtime) against
   package size, native notifications, auto-start, accessibility, and release
   automation.
3. Define the smallest cross-platform vertical slice: run the collector,
   display Claude/Codex data, refresh on a timer, and expose a visible error
   state. Dragging, mascot animation, and every GNOME-specific customization
   are explicitly follow-up work unless the chosen host supports them cleanly.
4. Add CI/release requirements for Windows and macOS artifacts and manual
   smoke checks on each OS.

**Acceptance criteria for the future PR:**

- A documented host decision and supported-version matrix exist.
- At least one non-GNOME platform host consumes the existing collector JSON
  without changing or breaking version-1 fields.
- Install/uninstall and first-run authentication guidance is documented.
- Windows/macOS build artifacts are reproducible in CI and have smoke coverage.

**Dependencies:** none for issue creation; architecture decision is the first
implementation task.

## Issue 2: Optional API usage and estimated-cost display

**Proposed title:** `feat: add opt-in API usage and estimated-cost display`

**Labels:** `enhancement`, `architecture`, `security`

**Milestone proposal:** `v0.4.0`

**Issue scope:**

1. Add an explicit, disabled-by-default configuration section for API usage.
   No API key is read, stored, transmitted, or rendered unless the user enables
   the corresponding provider.
2. Define an additive collector contract, for example an optional `apiUsage`
   object per provider containing a collection period, usage units, currency,
   pricing-source timestamp/version, estimated cost, and a bounded status or
   error message.
3. Build provider adapters only from documented APIs or local first-party usage
   data. Validate all external responses at the adapter boundary and distinguish
   unavailable, unauthenticated, and estimated values.
4. Render the API section only when enabled and data is available. Clearly mark
   calculated values as estimates and retain the current subscription-window UI
   unchanged when disabled.
5. Keep credentials outside logs, cache, CLI arguments, and widget state.
   Cache only non-sensitive normalized usage/cost values with existing private
   permissions.

**Acceptance criteria for the future PR:**

- Fresh installations show no API section and make no API-usage/cost request.
- Enabling one provider produces a bounded, validated API-usage view without
  exposing credentials.
- The widget identifies an estimated cost, currency, period, and source/pricing
  freshness instead of presenting it as an invoice.
- Disabling the setting hides the section and stops collection on the next
  refresh.
- Existing version-1 consumers continue to render subscription windows if they
  ignore the optional fields.

**Dependencies:** a short discovery task per provider is required before an
implementation PR, because availability, granularity, pricing, and
authentication models differ.

## Execution order after approval

1. Create the `v0.4.0` milestone if it does not already exist, then create the
   two GitHub issues from the proposed bodies above.
2. Publish the API discovery and additive contract as a documentation PR,
   because it establishes credential, privacy, and account-eligibility limits
   before any collection code is written.
3. Create a separate architecture decision or PR for the cross-platform host;
   do not mix a Windows/macOS runtime rewrite with the API-cost feature.
4. Release only completed, tested scope under the selected minor version; move
   unfinished platform work to the next milestone instead of shipping a partly
   supported OS claim.

## Risks and decisions to keep visible

| Risk | Mitigation |
| --- | --- |
| Windows/macOS cannot run a GNOME extension | Treat the visual host as a new platform adapter, not a port of `extension.js`. |
| API pricing changes or differs by model/region | Store pricing-source metadata and call the value an estimate. |
| API credentials are sensitive | Default off; use provider-approved configuration and never persist secrets in Tokidachi state/cache. |
| Cross-platform work becomes too broad | Ship one tested vertical slice per OS and keep feature parity as follow-up scope. |
| A personal account cannot access an organization cost API | Keep the feature off and report the provider as unavailable rather than inferring spend. |

## Explicit non-goals for the first implementation PRs

- Replacing or removing the GNOME extension.
- Claiming exact billing or invoice totals.
- Enabling API cost collection by default.
- Shipping an unsupported Windows/macOS build merely because the Java collector
  compiles there.
