# Optional API usage and estimated cost

Tokidachi's existing bars show Claude Code and Codex subscription windows.
They do not represent API billing. API usage is a separate, opt-in capability
planned for v0.4.0.

## Safe default

API usage and cost collection is disabled by default. Until a provider is
explicitly enabled, Tokidachi must not read an API credential, make a cost or
usage request, add an API-cost section to the widget, or cache API data.

Each provider is independently enabled. Create
`$XDG_CONFIG_HOME/tokidachi/api-usage.json` (or
`~/.config/tokidachi/api-usage.json`) in the user configuration directory,
never in the extension package or Git:

```json
{
  "version": 1,
  "apiUsage": {
    "periodDays": 30,
    "claude": {"enabled": false},
    "codex": {"enabled": false}
  }
}
```

Credentials stay in user-managed environment variables or an operating-system
secret store. They must never be written to Tokidachi configuration, state,
cache files, logs, process arguments, or release artifacts. The Codex adapter
reads `TOKIDACHI_OPENAI_ADMIN_KEY` only when `apiUsage.codex.enabled` is true;
`periodDays` accepts 1–31 days and defaults to 30.

## Additive collector contract

The collector's existing `version: 1` fields remain unchanged. A provider may
add this optional object only when that provider is explicitly enabled:

```json
{
  "apiUsage": {
    "status": "ok",
    "periodStart": "2026-08-01T00:00:00Z",
    "periodEnd": "2026-08-27T00:00:00Z",
    "currency": "USD",
    "estimatedCost": "12.34",
    "sourceUpdatedAt": "2026-08-27T03:00:00Z",
    "message": null
  }
}
```

`estimatedCost` is a decimal string so the widget does not introduce
floating-point rounding into a displayed currency value. `status` is one of
`ok`, `unavailable`, `unauthenticated`, or `error`; messages are bounded and
must not include provider responses or credentials. Older widgets ignore the
optional object and continue rendering subscription windows.

The widget renders this section only for an enabled provider whose object is
present. It labels the amount as an estimate, displays the currency, and never
presents it as an invoice.

## Provider boundaries

OpenAI's organization Usage and Costs APIs require an admin key and report
organization-level data. Anthropic's Usage and Cost Admin API also requires an
admin key and is unavailable to individual accounts. Therefore v0.4.0 must not
claim support for personal API billing unless a provider documents an eligible
personal-account endpoint.

- OpenAI Usage and Costs API: https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage
- Anthropic Usage and Cost API: https://platform.claude.com/docs/en/manage-claude/usage-cost-api

Both providers return third-party data. Adapters must cap response size, use
HTTPS with timeouts, validate the complete response shape before aggregation,
and retain only normalized non-sensitive results. A credential failure maps to
`unauthenticated`; an unsupported account or plan maps to `unavailable`.

## Current adapter status

The v0.4 foundation implements the OpenAI organization-cost adapter for Codex.
It emits `ok`, `unauthenticated`, or `error`; the widget shows a cost only for
an `ok` estimate. Claude opt-in currently emits `unavailable`, because its
organization cost report needs a separate daily-pagination adapter. Neither
provider is queried unless explicitly enabled.
