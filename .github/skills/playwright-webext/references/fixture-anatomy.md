# Reference: Fixture Anatomy

A walkthrough of why the Playwright fixtures in `tests/e2e/fixtures.ts` are built the way they are. It
names functions instead of copying them: read the file for the code, and trust it over this page if the
two disagree.

## The two problems

1. **Playwright cannot open `moz-extension://` addresses in Firefox.** `page.goto()` to one never
   completes. Chromium has no such problem with `chrome-extension://`.
2. **Playwright cannot tell a test the extension's id in Firefox.** Firefox gives a temporary add-on a
   random UUID per profile and writes it to the profile's `prefs.js`.

Everything below works around those two, and the workaround for the first one is what limits what a
Firefox page test proves.

## Chromium: `launchChromium`

- A persistent context (extensions need one) on the **full** Chromium binary. Playwright's headless
  shell has no UI layer and does not register extension service workers.
- `--load-extension` and `--disable-extensions-except` point at `dist/`.
- The language is set with `--lang` and the `LANGUAGE` environment variable, which is what picks the
  `_locales` folder (the `uiLanguage` option).
- The extension id comes from the URL of the extension's service worker (`chromiumExtensionId`). The
  worker may already be registered when the fixture runs, so it checks existing workers first and only
  then waits for the `serviceworker` event.
- Pages are the real extension pages; the real background runs. This is the end-to-end browser.

## Firefox: `launchFirefox`

1. **Start the local server** (`startLocalServer`): a small HTTP server on `127.0.0.1`, random port,
   serving `dist/`. It refuses anything that resolves outside that folder (`servedFile`).
2. **Launch a persistent context** with `--start-debugger-server <port>` and preferences that allow
   remote debugging, unsigned add-ons and MV3, and set the language. Fresh profile each run.
3. **Install over RDP.** `playwright-webextext` connects to Firefox's remote debugging protocol
   (retrying until the server is up) and installs `dist/` as a temporary add-on.
4. **Disconnect straight away.** An open RDP connection leaves Firefox in "debugger attached" mode,
   which stops the navigation events Playwright waits for. The add-on stays installed.
5. **Read the UUID** (`readFirefoxUuidFromPrefs`): poll the profile's `prefs.js` for the
   `extensions.webextensions.uuids` entry of the extension's gecko id, every 500 ms, for up to 15 s.
   `EXTENSION_ID` in the fixture must equal `browser_specific_settings.gecko.id` in the manifest.

The UUID is kept per context in a `WeakMap` (`firefoxExtensionIds`).

## The Firefox page proxy: `createFirefoxPageProxy`

The proxy wraps the real page. For anything that is not a `moz-extension://` address it does nothing.
For one that is:

- **`goto` is remapped.** `moz-extension://<uuid>/view.html?x` becomes
  `http://127.0.0.1:<port>/view.html?x` on the local server, which serves the same files the add-on
  contains.
- **An init script runs first** and sets `window.browser` to a **stand-in**: a small hand-written fake of
  the parts of the API the pages call (`runtime`, `storage`, `windows`, `tabs`, `sessions`, `commands`,
  `tabGroups`, `i18n`). Its state lives in the page's `localStorage`. Messages come from the built
  `_locales/en/messages.json`, and the commands from the built manifest.
- **`page.url()` is mapped back** to the `moz-extension://` form, so assertions read as they would on
  Chromium.
- Every other property and method is forwarded to the real page.

So on Firefox the page's own scripts run, against a fake `browser`. The real background, real tabs and
real tab groups are not involved. Tests that need those use the lab (below).

When a page starts using a `browser.*` API the stand-in lacks, the Firefox run fails with it undefined.
Add the smallest fake that makes the page behave. Keep it a stand-in: it does not need to be right
about the browser, only enough for the page.

## The fixtures

- **`context`** launches the right browser, logs each page's console and page errors, and (Firefox only)
  replaces `context.newPage` so that pages a test creates are proxied too. On teardown it closes the
  context, kills any Firefox process still using this profile (matched by the profile path, so never
  the user's own Firefox), and stops the local server.
- **`page`** is the first page the context opened, proxied on Firefox. It deliberately does **not** use
  Playwright's built-in `page` fixture: that one calls the wrapped `context.newPage()`, and wrapping the
  result in a second proxy puts two `goto()` calls on one page, which cancel each other with
  `NS_ERROR_NOT_AVAILABLE`.
- **`extensionProtocol`** is `moz-extension` or `chrome-extension`.
- **`extensionId`** is the Firefox UUID or the Chromium worker's id; it throws if it was not resolved,
  with a message saying where to look.
- **`uiLanguage`** is an option (default `en-US`), set per test file with `test.use({ uiLanguage })`.

Headed or headless is decided by `shouldRunHeadless`: headless unless `PLAYWRIGHT_HEADED`,
`PLAYWRIGHT_FIREFOX_HEADED` or `PWDEBUG` says otherwise, and always headless on CI. A headed run
without `DISPLAY` or `WAYLAND_DISPLAY` fails with an explanation (`assertHeadedDisplayAvailable`).

## The lab (a different thing)

`tests/e2e/lab/` does not use these fixtures. `lab.ts` starts a real Firefox of its own and loads
extensions as temporary add-ons. A **probe** extension (`probe.ts`) runs `browser.<api>(...)` for the
test and reports what the browser answered, so a test can ask the real Firefox a question (can a hidden
tab join a group? what does another extension see of my session values?) and keep the answer as a test.
`world.ts` describes the tabs and windows it reports. Use it for behaviour only a real Firefox has;
`firefox-facts.spec.ts` and `native-groups-first-run.spec.ts` are the examples.

## Configuration

`playwright.config.ts` has the settings (serial run, timeout, retries, reporter, recording) and the two
projects, `chromium` and `firefox`. Read it rather than trusting a copy.
