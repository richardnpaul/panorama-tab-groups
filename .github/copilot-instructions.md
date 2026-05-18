# Panorama Tab Groups — Copilot Instructions

## Core Principles

1. **Vanilla JS Only** — ES2022, no TypeScript. Do not introduce TypeScript or build steps.
2. **StateManager is Sacred** — Never call `browser.storage` or `browser.sessions` directly. Always use `StateManager`.
3. **Lint-Clean Commits** — `npm run lint` must pass before any review or merge.
4. **Plan Before Execute** — Complex features require a written plan in `docs/plans/` before code is written.
5. **Firefox-First** — Primary target is Firefox MV3; Chromium support is experimental.

## Stack

- Vanilla JavaScript (ES2022 modules)
- Firefox MV3 (primary), Chromium MV3 (experimental)
- Playwright 1.59+ for E2E testing
- ESLint (airbnb-base) + Prettier for linting/formatting
- web-ext for building and packaging

## Build & Test Commands

| Command             | Purpose                                |
| ------------------- | -------------------------------------- |
| `npm run lint`      | ESLint + Prettier check + web-ext lint |
| `npm run format`    | Auto-fix Prettier + ESLint violations  |
| `npm run build:xpi` | Build Firefox XPI via web-ext          |
| `npm run test:e2e`  | Playwright E2E (Chromium + Firefox)    |
| `npm test`          | Alias for lint (CI primary command)    |

## Architecture

- **`src/js/background.js`** — MV3 service worker entry; event-driven, ephemeral (state is lost on termination)
- **`src/js/background/StateManager.js`** — Single source of truth for all extension state; wraps `browser.sessions` (per-window/tab, Firefox-only) and `browser.storage.local` (persistent, cross-browser)
- **`src/js/background/constants.js`** — Reserved group IDs and application constants
- **`src/js/view/`** — Freeform tab groups canvas view
- **`src/popup-view/`** — Quick group switcher popup
- **`src/js/_share/js/models/`** — Shared `View`, `Group`, `Tab` base models

## Code Conventions

**Imports** — explicit `.js` extension always required:

```js
import { StateManager } from './StateManager.js'; // ✅
import { StateManager } from './StateManager'; // ❌ ESLint error
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

Config in `.eslintrc.js` (airbnb-base) and `.prettierrc` (single quotes, 80-char, trailing commas, `arrowParens: always`).
Run `npm run format` before committing. Run `npm run lint` to validate.

## Testing

Playwright E2E only — no unit tests. Custom fixtures in `playwright.config.js` handle MV3 persistent context,
Firefox RDP extension loading, and `moz-extension://` navigation quirks.
See `#skill:playwright-webext` for details.

## Skills

- `#skill:js-codebase-patterns` — Codebase conventions (StateManager, JSDoc, exports, View models)
- `#skill:webext-api` — WebExtension MV3 API reference, Firefox/Chrome compat
- `#skill:playwright-webext` — E2E testing patterns and fixture anatomy
- `#skill:webext-security` — Security checklist for browser extensions

## Agents

See `AGENTS.md` for the full agent lifecycle (coordinator / planner / implementer / reviewer).
