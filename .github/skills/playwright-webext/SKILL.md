---
name: playwright-webext
description: Playwright E2E testing for the tab-groups-viewer extension in Firefox and Chromium. Covers how differently the two browsers are set up (real extension in Chromium, extension pages over HTTP with a stand-in browser API in Firefox), what each can prove, the fixtures, where a test that needs real Firefox goes, how to add a test, running tests and common pitfalls. Load before writing or modifying any test under tests/e2e.
---

## When to Use

Load before writing a test, changing an existing one, or investigating an E2E failure. For unit tests
see `#skill:ts-codebase-patterns` and the project rule on verification.

This skill explains the setup and its limits. The mechanism is in `tests/e2e/fixtures.ts`; read it for
the current detail, and `references/fixture-anatomy.md` for a walkthrough of why it is built this way.

## The two browsers are not set up alike

This is the most important thing to know before writing a test.

|                              | Chromium                                                                                  | Firefox                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| How the extension is loaded  | `--load-extension` on the full Chromium binary (the headless shell cannot run extensions) | Temporary add-on, installed over Firefox's remote debugging protocol                                   |
| What a test's `page` runs    | The **real** extension page, with the real background                                     | The extension page **served over HTTP** from `dist/`, with `window.browser` replaced by a **stand-in** |
| Where `browser.*` comes from | The real browser                                                                          | A small fake in `fixtures.ts`, keeping its state in the page's `localStorage`                          |
| Extension id                 | Read from the service worker's URL                                                        | The UUID Firefox writes to the profile's `prefs.js`                                                    |

Why: Playwright cannot open `moz-extension://` addresses in Firefox. The `page` fixture therefore maps
`page.goto('moz-extension://<uuid>/view.html')` to `http://127.0.0.1:<port>/view.html`, served from
`dist/`, and `page.url()` maps it back.

What that means for what a test proves:

- **A Firefox page test checks the page's own code against a fake `browser`.** It does not exercise the
  real background script, real `tabs`, real `sessions` or real tab groups. Do not claim it does.
- **A Chromium test exercises the real extension.** It is the one that covers background, messaging and
  storage end to end (`chromium-stored-data.spec.ts` asserts what a real Chromium stores).
- **Behaviour that needs a real Firefox** (tab hiding, native groups, the real `sessions` API) is tested
  with the **lab**: `tests/e2e/lab/` starts a real Firefox that a test can ask things of, with a probe
  extension that calls `browser.*` for it. See `firefox-facts.spec.ts` and
  `native-groups-first-run.spec.ts`. Do not try to make the `page` fixture do it.
- The fake `browser` only implements what the pages call. If a page starts using a `browser.*` API the
  fake lacks, the Firefox test fails with that API undefined; add the smallest fake that makes it
  behave, in the fixture, and say so in the test.

## Fixtures

All come from `tests/e2e/fixtures.ts`. Import `test` and `expect` from `./fixtures.js` (the `.js` specifier
resolves to the `.ts` file), never from `@playwright/test`, which has none of them.

| Fixture             | What it is                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `context`           | A persistent browser context with the extension loaded. A fresh profile every run                 |
| `page`              | The context's first page; on Firefox wrapped by the page proxy (the mapping above)                |
| `extensionProtocol` | `moz-extension` or `chrome-extension`                                                             |
| `extensionId`       | The extension's id in this browser                                                                |
| `uiLanguage`        | An option, default `en-US`: the language the browser starts in, which picks the `_locales` folder |

Use the provided `page`. Make extra pages with `context.newPage()`, which is already wrapped on
Firefox; do not wrap a page in a second proxy.

## Adding a test

Create `tests/e2e/<name>.spec.ts`:

```typescript
import { test, expect } from './fixtures.js';

test('shows the view', async ({ page, extensionProtocol, extensionId }) => {
  await page.goto(`${extensionProtocol}://${extensionId}/view.html`);
  await expect(page.locator('body')).toHaveClass(/view-ready/);
});
```

- **Pages and helpers.** `tests/e2e/pages.ts` knows how to open and wait for each page of the extension
  (`pagesOfTheExtension`) and has layout helpers; reuse them before writing another wait.
- **Page paths** are those of the built extension under `dist/` (for example `view.html`,
  `options.html`, `migration-status.html`, `popup-view/index.html`). Check `src/` for the current set.
- **One browser only:** skip the other with a reason, as the existing specs do:

```typescript
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'Chromium keeps these values itself; Firefox has the real API',
);
```

- Every new feature gets at least one E2E test (`AGENTS.md`). Say in the test which browser(s) it is
  meaningful for, given the table above, and say in the report whether it ran against the real
  extension or the Firefox stand-in. Behaviour that exists only in Firefox (tab hiding, native groups,
  the real `sessions` API) needs a lab test; a Firefox page test cannot prove it.

## Running

```bash
npm run test:e2e                          # builds dist/ and dist-firefox/ first, then both browsers
npx playwright test --project=firefox     # one browser; does NOT rebuild
npx playwright test --project=chromium
npx playwright test tests/e2e/<file>.spec.ts
npx playwright show-report
```

- **`npx playwright test` does not rebuild.** The `pretest:e2e` hook only runs for `npm run test:e2e`.
  After changing `src/`, run `npm run dist && npm run dist:firefox` (or use `npm run test:e2e`), or the
  tests run against the old build.
- **Settings** (`playwright.config.ts`): serial (`workers: 1`, `fullyParallel: false`), one `timeout` for
  all projects, two retries on CI and none locally, an HTML report that never opens by itself, and
  trace, screenshot and video recording. Read the file for the values.
- **Headless by default.** `PLAYWRIGHT_HEADED=1` (or `PLAYWRIGHT_FIREFOX_HEADED=1`, or `PWDEBUG`) runs
  headed, which needs `DISPLAY` or `WAYLAND_DISPLAY`; `CI` forces headless.
- **Profiles** are `test-user-data-<browser>/` in the repository root (ignored by git), deleted and
  recreated at the start of each run. At the end the Firefox process that used the profile is killed.

## Common pitfalls

| Pitfall                                                | Cause                                                              | Fix                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| A Firefox test passes but the real extension is broken | The page ran against the stand-in `browser`, not the real one      | Cover real behaviour in Chromium, or with the lab for Firefox                    |
| `browser.x is not a function` only in Firefox tests    | The stand-in lacks that API                                        | Add the smallest fake to the fixture                                             |
| Tests ignore your change                               | Ran `npx playwright test` against an old `dist/`                   | Rebuild, or use `npm run test:e2e`                                               |
| `goto()` hangs or `NS_ERROR_NOT_AVAILABLE` in Firefox  | Went around the proxied `page`, or wrapped a page twice            | Use the `page` fixture and `context.newPage()` as they are                       |
| "Extension ID for firefox was not resolved"            | `prefs.js` had no UUID within the wait; the manifest id changed    | Check `EXTENSION_ID` in the fixture matches `browser_specific_settings.gecko.id` |
| Headed run fails at once                               | No display                                                         | Set `DISPLAY`/`WAYLAND_DISPLAY`, or run headless                                 |
| Chromium has no service worker                         | Headless shell used instead of the full binary                     | The fixture picks the full binary; do not change it                              |
| Stale profile errors                                   | A crashed run left a profile or process behind                     | Delete `test-user-data-*/` and kill the leftover browser                         |
| Passes on one browser, fails on the other              | The two setups differ (table above), or an API is browser-specific | Decide which browser the test is for and skip the other with a reason            |

> See [references/fixture-anatomy.md](./references/fixture-anatomy.md) for how the fixtures are built.
