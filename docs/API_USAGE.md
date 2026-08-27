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
    "providers": [
      {"id": "codex", "collector": "openai-costs", "enabled": true},
      {"id": "claude", "collector": "anthropic-costs", "enabled": false},
      {
        "id": "team-openai",
        "displayName": "Team OpenAI",
        "collector": "openai-costs",
        "periodDays": 7,
        "enabled": false
      }
    ]
  }
}
```

Credentials stay in user-managed environment variables or an operating-system
secret store. They must never be written to Tokidachi configuration, state,
cache files, logs, process arguments, or release artifacts. The OpenAI adapter
reads `TOKIDACHI_OPENAI_ADMIN_KEY` only when an enabled `openai-costs` entry
exists; `periodDays` accepts 1–31 days and defaults to 30.

`id` is a unique lowercase identifier (letters, digits, and hyphens),
`displayName` is optional and bounded to 40 characters, and `collector` selects
an implemented adapter. Tokidachi deliberately does not accept arbitrary API
URLs, headers, or environment-variable names in this file: those would allow a
configuration file to redirect credentials or access local services. An
unknown collector is shown as unavailable without reading a credential or
making a network request. The former `apiUsage.codex` and `apiUsage.claude`
flags continue to work as a compatibility fallback.

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

The v0.4 foundation implements the `openai-costs` adapter, which can be
attached to Codex or to a custom provider ID such as `team-openai`. It emits
`ok`, `unauthenticated`, or `error`; the widget shows a cost only for an `ok`
estimate. `anthropic-costs` currently emits `unavailable`, because its
organization cost report needs a separate daily-pagination adapter. Neither
provider is queried unless explicitly enabled.
