// eslint-disable-next-line import/no-extraneous-dependencies
import {
  defineConfig,
  devices,
  test as base,
  expect,
  chromium,
  firefox,
} from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import http from 'http';

let localServer = null;
let localServerPort = 0;

async function startLocalServer() {
  if (localServer) return localServerPort;

  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };

  const rootDir = fs.realpathSync(path.join(process.cwd(), 'src'));

  localServer = http.createServer((req, res) => {
    let filePath = path.join(rootDir, req.url.split('?')[0]);

    try {
      filePath = fs.realpathSync(filePath);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      try {
        filePath = fs.realpathSync(filePath);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      });
      res.end(data);
    });
  });
  await new Promise((resolve) => {
    localServer.listen(0, '127.0.0.1', resolve);
  });
  localServerPort = localServer.address().port;
  return localServerPort;
}

function stopLocalServer() {
  if (localServer) {
    localServer.close();
    localServer = null;
    localServerPort = 0;
  }
}

const firefoxPageProxies = new WeakMap();

function createFirefoxPageProxy(initialPage) {
  const activePage = initialPage;
  return new Proxy(initialPage, {
    get(_target, prop) {
      if (prop === 'goto') {
        return async (url, options = {}) => {
          if (!url.startsWith('moz-extension://')) {
            return activePage.goto(url, options);
          }

          // eslint-disable-next-line no-underscore-dangle
          const extensionId = activePage.context()._panoramaExtensionId;
          const urlObj = new URL(url);
          const localUrl = `http://127.0.0.1:${localServerPort}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;

          console.log(`[PROXY GOTO] Mapping ${url} -> ${localUrl}`);

          await activePage.addInitScript({
            content: `
              (function() {
                const extId = '${extensionId}';
                const port = ${localServerPort};
                window.browser = {
                  runtime: {
                    getURL: (p) => 'moz-extension://' + extId + '/' + p,
                    getManifest: () => ({ version: '0.9.0' }),
                    sendMessage: async () => ({ success: true }),
                    openOptionsPage: () => {
                      window.location.href = 'http://127.0.0.1:' + port + '/options.html';
                    }
                  },
                  storage: {
                    sync: {
                      get: async (defaults) => {
                        const data = {};
                        const keys = typeof defaults === 'string' ? [defaults] : (Array.isArray(defaults) ? defaults : Object.keys(defaults));
                        for (const key of keys) {
                          const val = localStorage.getItem('sync_' + key);
                          data[key] = val !== null ? JSON.parse(val) : (typeof defaults === 'object' ? defaults[key] : undefined);
                        }
                        return data;
                      },
                      set: async (data) => {
                        for (const [key, val] of Object.entries(data)) {
                          localStorage.setItem('sync_' + key, JSON.stringify(val));
                        }
                      },
                      clear: async () => localStorage.clear()
                    },
                    local: {
                      get: async (defaults) => {
                        const data = {};
                        const keys = typeof defaults === 'string' ? [defaults] : (Array.isArray(defaults) ? defaults : Object.keys(defaults));
                        for (const key of keys) {
                          const val = localStorage.getItem('local_' + key);
                          data[key] = val !== null ? JSON.parse(val) : (typeof defaults === 'object' ? defaults[key] : undefined);
                        }
                        return data;
                      },
                      set: async (data) => {
                        for (const [key, val] of Object.entries(data)) {
                          localStorage.setItem('local_' + key, JSON.stringify(val));
                        }
                      },
                      clear: async () => localStorage.clear()
                    },
                    onChanged: { addListener: () => {} }
                  },
                  windows: {
                    getCurrent: async () => ({ id: 1 })
                  },
                  tabs: {
                    getCurrent: async () => ({ id: 100 }),
                    query: async () => [
                      { id: 101, windowId: 1, pinned: false, lastAccessed: Date.now() - 10000, active: true, title: 'Tab 1', url: 'https://example.com' },
                      { id: 102, windowId: 1, pinned: false, lastAccessed: Date.now() - 20000, active: false, title: 'Tab 2', url: 'https://google.com' }
                    ],
                    get: async (tabId) => ({ id: tabId, windowId: 1 }),
                    update: async () => {},
                    create: async () => {},
                    remove: async () => {},
                    onActivated: { addListener: () => {} },
                    onUpdated: { addListener: () => {} },
                    onCreated: { addListener: () => {} },
                    onRemoved: { addListener: () => {} },
                    onMoved: { addListener: () => {} },
                    onAttached: { addListener: () => {} },
                    onDetached: { addListener: () => {} }
                  },
                  sessions: {
                    getWindowValue: async (windowId, key) => {
                      const val = localStorage.getItem('session_' + windowId + '_' + key);
                      return val !== null ? JSON.parse(val) : null;
                    },
                    setWindowValue: async (windowId, key, value) => {
                      localStorage.setItem('session_' + windowId + '_' + key, JSON.stringify(value));
                    }
                  },
                  commands: {
                    getAll: async () => []
                  },
                  tabGroups: {
                    query: async () => []
                  },
                  i18n: {
                    getMessage: (key, placeholders) => {
                      const msgs = {
                        defaultGroupName: 'Group',
                        newGroupButton: 'New Group',
                        closeGroup: 'Close Group',
                        closeGroupWarning: 'Are you sure you want to close this group?',
                        tabCount: (placeholders && placeholders[0] === 1) ? '1 Tab' : (placeholders ? placeholders[0] + ' Tabs' : 'Tabs'),
                        searchForTab_placeholder: 'Search for a tab...',
                        searchForTab_noResults: 'No tabs found',
                        settingsButton: 'Settings',
                        optionKeyboardShortcuts: 'Keyboard Shortcuts',
                        optionsTheme: 'Theme',
                      };
                      const val = msgs[key] || key;
                      if (typeof val === 'function') return val(placeholders);
                      return val;
                    }
                  }
                };
              })();
            `,
          });

          return activePage.goto(localUrl, options);
        };
      }

      if (prop === 'url') {
        return () => {
          const currentUrl = activePage.url();
          if (currentUrl.startsWith(`http://127.0.0.1:${localServerPort}/`)) {
            // eslint-disable-next-line no-underscore-dangle
            const extensionId = activePage.context()._panoramaExtensionId;
            return currentUrl.replace(
              `http://127.0.0.1:${localServerPort}/`,
              `moz-extension://${extensionId}/`,
            );
          }
          return currentUrl;
        };
      }

      const val = activePage[prop];
      if (prop === 'constructor') return val;
      return typeof val === 'function' ? val.bind(activePage) : val;
    },
  });
}

const pathToExtension = path.join(process.cwd(), 'src');
// Must match browser_specific_settings.gecko.id in manifest.json
const EXTENSION_ID = 'tab-groups-viewer@example.com';

function isTruthyEnv(value) {
  return value === '1' || value === 'true';
}

function shouldRunHeadless(browserName) {
  if (process.env.CI) {
    return true;
  }

  if (process.env.PWDEBUG || isTruthyEnv(process.env.PLAYWRIGHT_HEADED)) {
    return false;
  }

  if (
    browserName === 'firefox' &&
    isTruthyEnv(process.env.PLAYWRIGHT_FIREFOX_HEADED)
  ) {
    return false;
  }

  return true;
}

function assertHeadedDisplayAvailable(browserName, headless) {
  if (headless) {
    return;
  }

  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    return;
  }

  throw new Error(
    `Headed ${browserName} Playwright runs require DISPLAY or WAYLAND_DISPLAY. ` +
      'Use the dev container desktop or run headless by omitting PLAYWRIGHT_HEADED/PLAYWRIGHT_FIREFOX_HEADED.',
  );
}

function getFirefoxPageProxy(page) {
  if (!firefoxPageProxies.has(page)) {
    firefoxPageProxies.set(page, createFirefoxPageProxy(page));
  }

  return firefoxPageProxies.get(page);
}

function ensureExtensionId(browserName, id) {
  if (!id) {
    throw new Error(
      `Extension ID for ${browserName} was not resolved. ` +
        'Check the Playwright browser install, extension bootstrap logs, and prefs.js UUID registration.',
    );
  }

  return id;
}

// Poll prefs.js until Firefox has written the extension's UUID (typically < 2s).
async function readFirefoxUuidFromPrefs(
  prefsPath,
  extensionId,
  timeoutMs = 10000,
) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-await-in-loop
  while (Date.now() < deadline) {
    if (fs.existsSync(prefsPath)) {
      const contents = fs.readFileSync(prefsPath, 'utf8');
      const match = contents.match(
        /user_pref\("extensions\.webextensions\.uuids",\s*"(.+?)"\)/,
      );
      if (match) {
        const uuids = JSON.parse(match[1].replace(/\\"/g, '"'));
        if (uuids[extensionId]) return uuids[extensionId];
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => {
      setTimeout(r, 500);
    });
  }
  return null;
}

export const test = base.extend({
  context: async ({ browserName }, use) => {
    const userDataDir = path.join(
      process.cwd(),
      `test-user-data-${browserName}`,
    );
    const headless = shouldRunHeadless(browserName);

    assertHeadedDisplayAvailable(browserName, headless);

    let context;

    if (browserName === 'chromium') {
      fs.mkdirSync(userDataDir, { recursive: true });
      // Use the full Chromium binary (not chrome-headless-shell) so that
      // MV3 extension service workers are registered. The headless shell
      // strips the UI layer and does not support extensions.
      context = await chromium.launchPersistentContext(userDataDir, {
        executablePath: chromium.executablePath(),
        headless,
        args: [
          `--disable-extensions-except=${pathToExtension}`,
          `--load-extension=${pathToExtension}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
        ],
      });
    } else if (browserName === 'firefox') {
      await startLocalServer();

      // Fresh profile on every run to avoid Firefox version-mismatch errors.
      fs.rmSync(userDataDir, { recursive: true, force: true });
      fs.mkdirSync(userDataDir, { recursive: true });

      // Use Firefox DevTools RDP to install the extension as a temporary addon.
      // We start Firefox with --start-debugger-server so the RDP server is
      // available, connect, install the addon, then IMMEDIATELY DISCONNECT.
      // Keeping the RDP connection open puts Firefox in "debugger-attached" mode
      // which prevents Juggler's navigation events from firing for
      // moz-extension:// URLs — disconnecting avoids that interference.
      const { connectWithMaxRetries, findFreeTcpPort } =
        await import('playwright-webextext/dist/firefox_remote.js');
      const rdpPort = await findFreeTcpPort();

      console.log('[DEBUG] launching context');
      context = await firefox.launchPersistentContext(userDataDir, {
        headless,
        env: {
          ...process.env,
          MOZ_HEADLESS: shouldRunHeadless(browserName) ? '1' : undefined,
        },
        args: [
          '--start-debugger-server',
          String(rdpPort),
          '--disable-default-apps',
        ],
        firefoxUserPrefs: {
          'devtools.debugger.remote-enabled': true,
          'devtools.debugger.prompt-connection': false,
          'extensions.manifestV3.enabled': true,
          'xpinstall.signatures.required': false,
        },
      });

      // Connect via RDP (retrying until Firefox's server is ready), install the
      // addon, then disconnect so Firefox exits debugger-attached mode.
      console.log('[DEBUG] connecting to RDP');
      const rdpClient = await connectWithMaxRetries({ port: rdpPort });
      console.log('[DEBUG] installing addon');
      await rdpClient.installTemporaryAddon(pathToExtension);
      console.log('[DEBUG] disconnected RDP');
      rdpClient.disconnect();

      // Wait for Firefox to register the extension and assign it a UUID.
      const prefsPath = path.join(userDataDir, 'prefs.js');
      console.log('[DEBUG] reading UUID');
      const uuid = await readFirefoxUuidFromPrefs(
        prefsPath,
        EXTENSION_ID,
        15000,
      );
      // eslint-disable-next-line no-underscore-dangle
      context._panoramaExtensionId = ensureExtensionId(browserName, uuid);
      // eslint-disable-next-line no-underscore-dangle
      console.log(
        // eslint-disable-next-line no-underscore-dangle
        `[rdp] Extension installed, UUID: ${context._panoramaExtensionId}`,
      );
    }

    if (context) {
      context.on('page', (page) => {
        page.on('console', (msg) =>
          console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`),
        );
        page.on('pageerror', (err) =>
          console.error(`[Browser Error] ${err.message}`),
        );
      });
      // Wrap context.newPage so that tests creating pages directly (e.g. the
      // options test) also get a proxy that can follow extension URL navigation.
      if (browserName === 'firefox') {
        const origNewPage = context.newPage.bind(context);
        context.newPage = async (opts) => {
          const p = await origNewPage(opts);
          return getFirefoxPageProxy(p);
        };
      }
      try {
        await use(context);
      } finally {
        try {
          await context.close();
        } catch (ignoreError) {
          // context already closed or closing
        }
        // Safety net: kill any lingering Firefox process that used this profile.
        // Matching on the profile path is safe — it will never match the user's
        // personal Firefox, which uses a completely different profile directory.
        if (browserName === 'firefox') {
          spawnSync('pkill', ['-f', userDataDir], { stdio: 'ignore' });
        }
        stopLocalServer();
      }
    }
  },
  page: async ({ context, browserName }, use) => {
    if (browserName === 'firefox') {
      // Do NOT depend on the built-in `page` fixture: it would call our wrapped
      // context.newPage(), producing a proxy. Then wrapping that proxy in another
      // proxy here causes two simultaneous goto() calls on the same real page,
      // which cancel each other (NS_ERROR_NOT_AVAILABLE).
      // Instead, take the initial page that launchPersistentContext already opened.
      const initialPage = context.pages()[0];
      await use(getFirefoxPageProxy(initialPage));
    } else {
      await use(context.pages()[0]);
    }
  },
  extensionProtocol: async ({ browserName }, use) => {
    await use(browserName === 'firefox' ? 'moz-extension' : 'chrome-extension');
  },
  extensionId: async ({ context, browserName }, use) => {
    let id = null;

    if (browserName === 'chromium') {
      // Service worker may already be registered before this fixture runs.
      // Check synchronously first, then fall back to waitForEvent.
      const existingWorkers = context.serviceWorkers();
      if (existingWorkers.length > 0) {
        [, , id] = existingWorkers[0].url().split('/');
      } else {
        try {
          const worker = await context.waitForEvent('serviceworker', {
            timeout: 15000,
          });
          [, , id] = worker.url().split('/');
        } catch (ignoreError) {
          // One final synchronous check after the wait in case it registered
          // during the timeout window without firing the event.
          const lateworkers = context.serviceWorkers();
          if (lateworkers.length > 0) {
            [, , id] = lateworkers[0].url().split('/');
          }
        }
      }
    } else if (browserName === 'firefox') {
      // eslint-disable-next-line no-underscore-dangle
      id = context._panoramaExtensionId;
    }

    const resolvedId = ensureExtensionId(browserName, id);
    console.log(`Extension ID for ${browserName}: ${resolvedId}`);
    await use(resolvedId);
  },
});

export { expect };

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }]],
  timeout: 45000,
  use: {
    trace: 'on',
    screenshot: 'on',
    video: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      timeout: 10000,
    },
  ],
});
