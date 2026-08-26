# Widget language selection

## Task 1: Translation foundation

**Acceptance criteria:**

- [x] System Portuguese locales resolve to `pt-BR`; unsupported locales fall back to English.
- [x] English and Brazilian Portuguese strings support named interpolation.

**Verification:**

- [x] `node --experimental-default-type=module --test tests/i18n.test.js`

**Dependencies:** None

## Task 2: Widget integration

**Acceptance criteria:**

- [x] The context menu exposes System, English, and Portuguese (Brazil).
- [x] Selection persists and updates all widget-owned visible and accessible copy immediately.
- [x] Installation and release archives contain the localization module.

**Verification:**

- [x] `make test`
- [x] `node --check tokidachi@gaalbu.github.io/i18n.js`

**Dependencies:** Task 1

## Checkpoint

- [x] Full test suite passes.
- [x] Quality scan has no unresolved errors.
