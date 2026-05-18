# Reference: Fixture Anatomy

Annotated walkthrough of the custom Playwright fixtures in `playwright.config.js`.
These fixtures exist to work around Firefox MV3 + Juggler navigation quirks.

---

## `createFirefoxPageProxy(initialPage)`

Wraps a Playwright `Page` to patch `page.goto()` for `moz-extension://` URLs.

**Root cause of the problem:**
With `--start-debugger-server` active (required for RDP addon install), Juggler's
`Page.navigate` for `moz-extension://` URLs returns `{ navigationId: null }` because
the juggler-navigation-started-browser observer fires asynchronously. Playwright's
`goto()` then waits for a same-document navigation commit event that never fires,
blocking the test forever.

**The fix — polling the frame's execution context:**

```javascript
function createFirefoxPageProxy(initialPage) {
  let activePage = initialPage;
  return new Proxy(initialPage, {
    get(_target, prop) {
      if (prop === 'goto') {
        return async (url, options = {}) => {
          // Non-extension URLs go through the normal path.
          if (!url.startsWith('moz-extension://'))
            return activePage.goto(url, options);

          const timeout = options.timeout ?? 30000;

          // Fire the navigate command but don't await it — with RDP active,
          // the response has navigationId=null and goto() will hang.
          // We give it a 2s timeout so it fails fast (the navigation itself
          // continues in Firefox regardless).
          activePage
            .goto(url, { waitUntil: 'commit', timeout: 2000 })
            .catch(() => {});

          // Access Playwright's server-side Frame via the in-process bridge.
          // This bypasses the public API and lets us inspect the navigation
          // state machine directly.
          const serverFrame = activePage._connection.toImpl(
            activePage.mainFrame(),
          );

          // Poll for the new execution context.
          //
          // Navigation sequence for moz-extension:// URLs:
          //   1. about:blank context exists
          //   2. Context is cleared to null (navigation started)
          //   3. Extension page context appears (navigation committed)
          //
          // We wait for the null → non-null transition to confirm the page loaded.
          let sawNullCtx = false;
          await new Promise((resolve, reject) => {
            const start = Date.now();
            const poll = () => {
              if (Date.now() - start > timeout) {
                reject(
                  new Error(
                    `Extension page did not load within ${timeout}ms: ${url}`,
                  ),
                );
                return;
              }
              const ctx = serverFrame._contextData.get('main')?.context;
              if (!ctx) sawNullCtx = true;
              if (sawNullCtx && ctx) {
                // New execution context arrived after the old one was cleared.
                // Manually commit the navigation so Playwright's pendingDocument
                // is cleared and assertions can run.
                const pending = serverFrame.pendingDocument();
                if (pending) {
                  try {
                    serverFrame._page.frameManager.frameCommittedNewDocumentNavigation(
                      serverFrame._id,
                      url,
                      '',
                      pending.documentId ?? '',
                      false,
                    );
                  } catch (_) {
                    /* already committed or frame gone */
                  }
                }
                resolve();
                return;
              }
              setTimeout(poll, 100);
            };
            setTimeout(poll, 200); // initial delay to let navigation start
          });

          return null;
        };
      }
      // All other page methods (click, locator, etc.) are proxied through to
      // the underlying real page unchanged.
      const val = activePage[prop];
      return typeof val === 'function' ? val.bind(activePage) : val;
    },
  });
}
```

---

## `readFirefoxUuidFromPrefs(prefsPath, extensionId, timeoutMs)`

Firefox writes each extension's UUID to `prefs.js` as a JSON-encoded string
inside a `user_pref` call. This function polls until the UUID appears.

```javascript
async function readFirefoxUuidFromPrefs(
  prefsPath,
  extensionId,
  timeoutMs = 10000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(prefsPath)) {
      const contents = fs.readFileSync(prefsPath, 'utf8');
      // Example line in prefs.js:
      //   user_pref("extensions.webextensions.uuids", "{\"tab-groups-viewer@example.com\":\"abc-123\"}");
      const match = contents.match(
        /user_pref\("extensions\.webextensions\.uuids",\s*"(.+?)"\)/,
      );
      if (match) {
        const uuids = JSON.parse(match[1].replace(/\\"/g, '"'));
        if (uuids[extensionId]) return uuids[extensionId];
      }
    }
    await new Promise((r) => setTimeout(r, 500)); // poll every 500ms
  }
  return null; // timed out — extension ID not registered
}
```

**Timeout**: 15 seconds (set in the `context` fixture call). Typically completes
within 1-2 seconds of addon install.

---

## `context` Fixture

Provides a persistent `BrowserContext` with the extension loaded.

```javascript
context: async ({ browserName }, use) => {
  const userDataDir = path.join(process.cwd(), `test-user-data-${browserName}`);

  if (browserName === 'chromium') {
    // Chromium: load extension directly via command-line flags.
    // No RDP required. Profile is reused across runs.
    fs.mkdirSync(userDataDir, { recursive: true });
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: !!process.env.CI,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
  } else if (browserName === 'firefox') {
    // Firefox: fresh profile on every run to avoid version-mismatch errors.
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.mkdirSync(userDataDir, { recursive: true });

    // Start Firefox with RDP server enabled.
    const { connectWithMaxRetries, findFreeTcpPort } =
      await import('./node_modules/playwright-webextext/dist/firefox_remote.js');
    const rdpPort = await findFreeTcpPort();

    context = await firefox.launchPersistentContext(userDataDir, {
      headless: !!process.env.CI,
      args: ['--start-debugger-server', String(rdpPort)],
      firefoxUserPrefs: {
        'devtools.debugger.remote-enabled': true,
        'devtools.debugger.prompt-connection': false,
        'extensions.manifestV3.enabled': true,
        'xpinstall.signatures.required': false,
      },
    });

    // Install addon via RDP, then IMMEDIATELY DISCONNECT.
    // Keeping the RDP connection open holds Firefox in "debugger-attached" mode
    // which prevents Juggler navigation events from firing for moz-extension:// URLs.
    const rdpClient = await connectWithMaxRetries({ port: rdpPort });
    await rdpClient.installTemporaryAddon(pathToExtension);
    rdpClient.disconnect(); // <-- critical: disconnect right away

    // Wait for Firefox to write the UUID to prefs.js.
    const prefsPath = path.join(userDataDir, 'prefs.js');
    const uuid = await readFirefoxUuidFromPrefs(prefsPath, EXTENSION_ID, 15000);
    if (uuid) console.log(`[rdp] Extension installed, UUID: ${uuid}`);
    else
      console.warn('[rdp] Extension UUID not found in prefs.js after install');
  }

  // Patch context.newPage() so tests that call it directly also get a proxy.
  if (browserName === 'firefox') {
    const origNewPage = context.newPage.bind(context);
    context.newPage = async (opts) => {
      const p = await origNewPage(opts);
      return createFirefoxPageProxy(p);
    };
  }

  try {
    await use(context);
  } finally {
    try {
      await context.close();
    } catch (e) {}
    // Kill any lingering Firefox process using this profile.
    // Safe: matches on the specific test profile path, never the user's profile.
    if (browserName === 'firefox') {
      spawnSync('pkill', ['-f', userDataDir], { stdio: 'ignore' });
    }
  }
};
```

---

## `page` Fixture

Returns the first page in context, proxied on Firefox.

```javascript
page: async ({ context, browserName }, use) => {
  if (browserName === 'firefox') {
    // IMPORTANT: Do NOT use the built-in `page` fixture here.
    // It calls the wrapped context.newPage(), producing a double-proxy which
    // causes two simultaneous goto() calls that cancel each other
    // (NS_ERROR_NOT_AVAILABLE).
    // Instead take the page that launchPersistentContext already opened.
    const initialPage = context.pages()[0];
    await use(createFirefoxPageProxy(initialPage));
  } else {
    await use(context.pages()[0]);
  }
};
```

---

## `extensionId` Fixture

Extracts the extension's runtime ID/UUID for constructing `moz-extension://` or `chrome-extension://` URLs.

```javascript
extensionId: async ({ context, browserName }, use) => {
  let id = null;

  if (browserName === 'chromium') {
    // Chromium: get the extension ID from the service worker URL.
    const workers = context.serviceWorkers();
    if (workers.length > 0) {
      id = workers[0].url().split('/')[2];
    } else {
      const worker = await context.waitForEvent('serviceworker', {
        timeout: 15000,
      });
      id = worker.url().split('/')[2];
    }
  } else if (browserName === 'firefox') {
    // Firefox: UUID was written to prefs.js during context fixture setup.
    const prefsPath = path.join(
      process.cwd(),
      'test-user-data-firefox',
      'prefs.js',
    );
    id = await readFirefoxUuidFromPrefs(prefsPath, EXTENSION_ID);
  }

  console.log(`Extension ID for ${browserName}: ${id}`);
  await use(id);
};
```

---

## `defineConfig` Settings

| Setting                     | Value                    | Notes                                        |
| --------------------------- | ------------------------ | -------------------------------------------- |
| `workers`                   | `1`                      | Tests run serially — browser state is shared |
| `fullyParallel`             | `false`                  | Required for single-worker serial execution  |
| `timeout` (global)          | `60000ms`                | Default test timeout                         |
| `timeout` (Firefox project) | `180000ms`               | Firefox installs and navigates slowly        |
| `retries`                   | `2` on CI, `0` locally   |                                              |
| `reporter`                  | `html` (never auto-open) | Run `npx playwright show-report` manually    |
