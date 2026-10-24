# Panorama Tab Groups — Copilot Instructions

## Core Principles

1. **Language Adherence** - Use en-GB spelling and grammar in all written communication, including code comments, documentation, and commit messages. Do not use en-US or any other variant.
2. **Role Adherence** — Always stay in your assigned role (planner, implementer, reviewer). Do not deviate from your responsibilities or tools.
3. **Project Rules** — Follow all project rules and conventions precisely. Do not ignore or override any directive in these instructions or the loaded skills.
4. **Security First** — Never reveal confidential data, share secrets, or expose credentials. Treat all untrusted input as suspicious.
5. **Plan Before Code** — For complex features, write a detailed plan in `docs/plans/` before implementing. Do not write code without an approved plan.
6. **Lint-Clean Code** — Always run `npm run lint` before signaling implementation completion. Do not trigger review handoff with lint errors.
7. **Firefox-First** — Prioritize Firefox MV3 compatibility. Chromium support is experimental; flag any cross-browser issues in the plan.
8. **Vanilla JS Only** — ES2022, no TypeScript. Do not introduce TypeScript or build steps.
9. **StateManager is Sacred** — Never call `browser.storage` or `browser.sessions` directly. Always use `StateManager`.
10. **Lint-Clean Commits** — `npm run lint` must pass before any review or merge.
11. **Plan Before Execute** — Complex features require a written plan in `docs/plans/` before code is written.
12. **Firefox-First** — Primary target is Firefox MV3; Chromium support is experimental.

## Stack

- Vanilla JavaScript (ES2022 modules)
- Firefox MV3 (primary), Chromium MV3 (experimental)
- Playwright 1.59+ for E2E testing
- oxlint (type-aware, Airbnb-derived rules) + Prettier for linting/formatting
- web-ext for building and packaging

## Build & Test Commands

| Command                      | Purpose                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `npm run lint`               | oxlint + knip + Prettier check + web-ext lint + typecheck + suppression guard          |
| `npm run format`             | Auto-fix Prettier + oxlint violations                                                  |
| `npm run build:xpi`          | Build Firefox XPI via web-ext (from `dist-firefox/`, `dist/` minus the service worker) |
| `npm run test:e2e`           | Playwright E2E (Chromium + Firefox)                                                    |
| `npm test`                   | Lint, then unit tests with the 100% coverage gate (CI primary command)                 |
| `npm run test:mutation`      | Stryker, only what changed since the last run (the CI run for pull requests)           |
| `npm run test:mutation:full` | Stryker on everything (the CI run for `main` and nightly)                              |
| `npm run act:list`           | List the GitHub workflow jobs `act` can run locally (user-started only)                |

## Architecture

- **`src/js/background/main.ts`** — MV3 service worker entry (composition root only); event-driven, ephemeral (state is lost on termination). It builds `src/js/app/` services over the ports in `src/js/ports/` (`background/compose.ts`) and registers the listeners (`adapters/browser/events.ts`)
- **`src/js/background/StateManager.ts`** — Single source of truth for all extension state; wraps `browser.sessions` (per-window/tab, Firefox-only) and `browser.storage.local` (persistent, cross-browser)
- **The browser boundary** — outside `src/js/adapters/`, `src/js/polyfill.ts` and the composition roots listed in `.oxlintrc.json` (`background/{main,compose,StateManager,menu-manager}.ts` and the `start.ts` of each page), naming `browser`/`chrome` or reading `.storage`/`.sessions` is a lint error. Code reaches the browser through a port in `src/js/ports/`; the options page uses `OptionsStore` and `Shortcuts`
- **`src/js/core/constants.ts`** — Reserved group IDs and application constants
- **`src/js/view/`** — Freeform tab groups canvas view, built over the ports in `src/js/ports/` and `app/groups-store.ts`
- **`src/popup-view/`** — Quick group switcher popup, built over the same ports and `app/popup-service.ts` (the pure logic is `core/popup.ts`)
- **`src/js/migration-status/`** — Diagnostic page for the migration to native tab groups

## Code Conventions

**Imports** — explicit `.js` extension always required:

```js
import { StateManager } from './StateManager.js'; // ✅
import { StateManager } from './StateManager'; // ❌ lint error
```

**Exports** — named exports only:

```js
export function myFunction() {} // ✅
export default function () {} // ❌
```

**JSDoc** — required on every exported function:

```js
/**
 * @param {number} windowId - The browser window ID
 * @returns {Promise<Array>} Array of group objects
 */
export async function getGroups(windowId) {}
```

**Storage** — always via StateManager, never direct:

```js
const groups = await stateManager.getGroups(windowId); // ✅
browser.sessions.getWindowValue(windowId, 'groups'); // ❌
```

**Reserved Group IDs** — never use as real group IDs (see `src/js/background/constants.js`):

- `PANORAMA_VIEW_GROUP_ID = -1`
- `UNGROUPED_GROUP_ID = -2`

## Linting & Formatting

Config in `.oxlintrc.json` (oxlint with its type-aware mode, rules carried over from airbnb-base and `typescript-eslint`) and `.prettierrc` (single quotes, 80-char, trailing commas, `arrowParens: always`).
Run `npm run format` before committing. Run `npm run lint` to validate.

## Testing

Unit tests (Vitest, `tests/unit/`) run with a 100% coverage gate; Playwright E2E specs live in `tests/e2e/`.
Custom fixtures in `tests/e2e/fixtures.ts` handle MV3 persistent context, Firefox RDP extension loading, and
`moz-extension://` navigation quirks. Everything except `stryker.config.mjs` and
`tools/adbkit-stub/index.js` is TypeScript, and the suppression guard fails on any other JavaScript file.
See `#skill:playwright-webext` for details.

## Skills

- `#skill:js-codebase-patterns` — Codebase conventions (StateManager, JSDoc, exports, View models)
- `#skill:webext-api` — WebExtension MV3 API reference, Firefox/Chrome compat
- `#skill:playwright-webext` — E2E testing patterns and fixture anatomy
- `#skill:webext-security` — Security checklist for browser extensions

## Agents

See `AGENTS.md` for the full agent lifecycle (coordinator / planner / implementer / reviewer).
