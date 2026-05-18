---
name: playwright-webext
description: Playwright E2E testing patterns for the panorama-tab-groups Firefox/Chromium extension. Covers the custom Firefox fixture (createFirefoxPageProxy, RDP addon install via playwright-webextext, UUID extraction from prefs.js), fixture exports, how to add new tests, navigation URL patterns, and common pitfalls. Load before writing or modifying any test file.
---

## When to Use

Load before writing any new test, modifying an existing test, or when investigating Playwright test failures in this project.

## Why the Custom Fixture Exists

Firefox (MV3 + Juggler) handles `moz-extension://` URLs in a way that breaks Playwright's standard navigation:

- Playwright's `page.goto()` waits for a navigation commit event that **never fires** for `moz-extension://` URLs when the RDP debugger server is active
- The extension UUID must be extracted from `prefs.js` (Firefox writes it after addon install)
- MV3 requires a persistent browser context (not `launch()`)
- The RDP connection must be **disconnected immediately** after addon install to exit "debugger-attached" mode — keeping it open prevents Juggler navigation events from firing

The `createFirefoxPageProxy` function patches `page.goto()` to work around all of these.

## Key Constants

```javascript
const EXTENSION_ID = 'tab-groups-viewer@example.com'; // must match manifest.json gecko.id
const pathToExtension = path.join(process.cwd(), 'src');
```

## Fixture Exports

All fixtures are exported from `playwright.config.js`:

| Fixture             | Type                        | Value                                                                                         |
| ------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `context`           | `BrowserContext`            | Persistent context with extension loaded (Chromium: `--load-extension`, Firefox: RDP install) |
| `page`              | `Page` (proxied on Firefox) | First page in context, wrapped with `createFirefoxPageProxy` on Firefox                       |
| `extensionProtocol` | `string`                    | `'moz-extension'` on Firefox, `'chrome-extension'` on Chromium                                |
| `extensionId`       | `string`                    | Extension UUID (Firefox) or service worker origin host (Chromium)                             |

## How to Add a New Test

Create a new file in `tests/` ending in `.spec.js`:

```javascript
import { test, expect } from '../playwright.config.js';

test('my feature works', async ({ page, extensionProtocol, extensionId }) => {
  // Navigate to an extension page
  await page.goto(`${extensionProtocol}://${extensionId}/view.html`);

  // Assert
  await expect(page.locator('#my-element')).toBeVisible();
});
```

> **Important**: Import `test` and `expect` from `../playwright.config.js`, not from `@playwright/test` directly. The config re-exports a custom `test` object with the extension fixtures.

## Navigating to Extension Pages

| Page             | URL Pattern                                                   |
| ---------------- | ------------------------------------------------------------- |
| Main view        | `${extensionProtocol}://${extensionId}/view.html`             |
| Options          | `${extensionProtocol}://${extensionId}/options.html`          |
| Popup (view)     | `${extensionProtocol}://${extensionId}/popup-view/popup.html` |
| Migration status | `${extensionProtocol}://${extensionId}/migration-status.html` |

## Running Tests

```bash
# Run all E2E tests (both Chromium and Firefox)
npm run test:e2e

# Run only Firefox tests
npx playwright test --project=firefox

# Run only Chromium tests
npx playwright test --project=chromium

# Run a specific test file
npx playwright test tests/extension.spec.js

# Show HTML report
npx playwright show-report
```

Test configuration: `workers: 1`, `fullyParallel: false`. Firefox timeout: 180000ms.

## Firefox-Specific Notes

- **Profile**: The `test-user-data-firefox/` directory is **deleted on every run** (`fs.rmSync` with `recursive: true`)
- **UUID**: Extracted by `readFirefoxUuidFromPrefs()` which polls `prefs.js` for up to 15 seconds
- **RDP**: `playwright-webextext` library handles the RDP connection. Source: `node_modules/playwright-webextext/dist/firefox_remote.js`
- **Proxy**: `createFirefoxPageProxy` polls the frame's execution context to detect when the extension page has loaded, then manually calls `frameCommittedNewDocumentNavigation()` to unblock Playwright's pending navigation state
- **New pages**: `context.newPage()` is also patched — pages created inside tests automatically get the proxy wrapper

## Common Pitfalls

| Pitfall                                           | Cause                                           | Fix                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `page.goto()` hangs forever on `moz-extension://` | Playwright's navigation event never fires       | Use the proxied `page` fixture — never bypass it                                                        |
| Extension UUID is `null`                          | prefs.js not written yet                        | `readFirefoxUuidFromPrefs` polls up to 15s; if still null, check `EXTENSION_ID` matches `manifest.json` |
| `NS_ERROR_NOT_AVAILABLE`                          | Two `goto()` calls racing on the same real page | Don't create extra proxies; use the provided `page` fixture                                             |
| Tests pass on Chromium but fail on Firefox        | Firefox-only API used or navigation timing      | Add a `browserName === 'firefox'` branch or increase timeout                                            |
| `context` fixture reuse errors                    | Profile not cleaned                             | Profile is auto-deleted; if corrupt, manually delete `test-user-data-firefox/`                          |

> See [.github/skills/playwright-webext/references/fixture-anatomy.md](./references/fixture-anatomy.md) for the fully annotated `createFirefoxPageProxy` and fixture setup code.
