import {
  test as base,
  expect,
  chromium,
  firefox,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { isRecord, isString } from '../../src/js/share/guards.js';

let localServer: http.Server | null = null;
let localServerPort = 0;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/** The file under the root a request asks for; nothing for one outside it or missing */
function servedFile(rootDir: string, url: string | undefined): string | null {
  const requested = path.join(rootDir, (url ?? '/').split('?')[0] ?? '/');
  try {
    const real = fs.realpathSync(requested);
    if (!real.startsWith(rootDir)) {
      return null;
    }
    return fs.statSync(real).isDirectory()
      ? servedFile(
          rootDir,
          path.relative(rootDir, path.join(real, 'index.html')),
        )
      : real;
  } catch {
    return null;
  }
}

async function startLocalServer(): Promise<number> {
  if (localServer) return localServerPort;

  const rootDir = fs.realpathSync(path.join(process.cwd(), 'dist'));

  const server = http.createServer((req, res) => {
    const filePath = servedFile(rootDir, req.url);
    if (filePath === null) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type':
          MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      });
      res.end(data);
    });
  });
  localServer = server;
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The local server is not listening on a port');
  }
  localServerPort = address.port;
  return localServerPort;
}

function stopLocalServer(): void {
  if (localServer) {
    localServer.close();
    localServer = null;
    localServerPort = 0;
  }
}

/** The commands of the built manifest, with the keys each comes with */
function manifestCommands(): { name: string; shortcut: string }[] {
  const manifest: unknown = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'dist', 'manifest.json'), 'utf8'),
  );
  const commands = isRecord(manifest) ? manifest.commands : undefined;
  return Object.entries(isRecord(commands) ? commands : {}).map(
    ([name, command]) => {
      const keys = isRecord(command) ? command.suggested_key : undefined;
      const shortcut = isRecord(keys) ? keys.default : undefined;
      return { name, shortcut: isString(shortcut) ? shortcut : '' };
    },
  );
}

// The UUID Firefox gave the extension in each context
const firefoxExtensionIds = new WeakMap<BrowserContext, string>();
const firefoxPageProxies = new WeakMap<Page, Page>();

/**
 * A page that loads `moz-extension://` addresses from the local server, with a
 * stand-in for the `browser` API, because Playwright cannot open them in Firefox
 */
function createFirefoxPageProxy(activePage: Page, extensionId: string): Page {
  const goto: Page['goto'] = async (url, options) => {
    if (!url.startsWith('moz-extension://')) {
      return activePage.goto(url, options);
    }

    const urlObj = new URL(url);
    const localUrl = `http://127.0.0.1:${String(localServerPort)}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;

    console.log(`[PROXY GOTO] Mapping ${url} -> ${localUrl}`);

    const messagesJson = fs.readFileSync(
      path.join(process.cwd(), 'dist', '_locales', 'en', 'messages.json'),
      'utf8',
    );
    const commandsJson = JSON.stringify(manifestCommands());

    await activePage.addInitScript({
      content: `
              (function() {
                const extId = '${extensionId}';
                const port = ${String(localServerPort)};
                const rawMessages = ${messagesJson};
                const msgs = {};
                for (const key in rawMessages) {
                  msgs[key] = rawMessages[key].message;
                }
                msgs['tabCount'] = (placeholders) => (placeholders && placeholders[0] === 1) ? '1 Tab' : (placeholders ? placeholders[0] + ' Tabs' : 'Tabs');
                msgs['closeGroupWarning'] = (placeholders) => 'Are you sure you want to close this group?';

                let mockTabs = JSON.parse(localStorage.getItem('mockTabs') || '[{"id":101,"windowId":1,"pinned":false,"lastAccessed":0,"active":true,"title":"Tab 1","url":"https://example.com"},{"id":102,"windowId":1,"pinned":false,"lastAccessed":0,"active":false,"title":"Tab 2","url":"https://google.com"}]');
                let mockTabIdCounter = parseInt(localStorage.getItem('mockTabIdCounter') || '103', 10);

                // Like the real API, a change is told to the listeners of the page that made it
                const changeListeners = [];
                const told = (areaName, data) => {
                  const changes = {};
                  for (const [key, newValue] of Object.entries(data)) {
                    changes[key] = { newValue };
                  }
                  changeListeners.forEach((listener) => listener(changes, areaName));
                };

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
                        told('sync', data);
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
                        told('local', data);
                      },
                      clear: async () => localStorage.clear()
                    },
                    onChanged: { addListener: (listener) => { changeListeners.push(listener); } }
                  },
                  windows: {
                    getCurrent: async () => {
                      const wid = new URLSearchParams(window.location.search).get('windowId') || '1';
                      return { id: parseInt(wid, 10) };
                    }
                  },
                  tabs: {
                    getCurrent: async () => ({ id: 100 }),
                    query: async (q) => {
                      let wid;
                      if (q && q.windowId) {
                        wid = q.windowId;
                      } else if (q && q.currentWindow) {
                        wid = parseInt(new URLSearchParams(window.location.search).get('windowId') || '1', 10);
                      }
                      if (wid !== undefined) {
                        return mockTabs.filter(t => t.windowId === wid);
                      }
                      return mockTabs;
                    },
                    get: async (tabId) => mockTabs.find(t => t.id === tabId) || { id: tabId, windowId: 1 },
                    update: async () => {},
                    create: async () => {
                      const widStr = new URLSearchParams(window.location.search).get('windowId') || '1';
                      const wid = parseInt(widStr, 10);
                      const newTab = { id: mockTabIdCounter++, windowId: wid, active: true, title: 'New Tab', url: 'about:newtab' };
                      mockTabs.push(newTab);
                      localStorage.setItem('mockTabs', JSON.stringify(mockTabs));
                      localStorage.setItem('mockTabIdCounter', mockTabIdCounter.toString());
                      const activeGroupStr = localStorage.getItem('session_' + wid + '_activeGroup');
                      if (activeGroupStr !== null) {
                         localStorage.setItem('tab_' + newTab.id + '_groupId', activeGroupStr);
                      }
                      return newTab;
                    },
                    remove: async (tabId) => {
                      mockTabs = mockTabs.filter(t => t.id !== tabId);
                      localStorage.setItem('mockTabs', JSON.stringify(mockTabs));
                    },
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
                    },
                    getTabValue: async (tabId, key) => {
                      const val = localStorage.getItem('tab_' + tabId + '_' + key);
                      return val !== null ? JSON.parse(val) : undefined;
                    },
                    setTabValue: async (tabId, key, value) => {
                      localStorage.setItem('tab_' + tabId + '_' + key, JSON.stringify(value));
                    },
                    removeTabValue: async (tabId, key) => {
                      localStorage.removeItem('tab_' + tabId + '_' + key);
                    }
                  },
                  commands: {
                    // The commands of the manifest, with the keys a user set
                    getAll: async () => ${commandsJson}.map((command) => ({
                      ...command,
                      shortcut: localStorage.getItem('command_' + command.name) ?? command.shortcut,
                    })),
                    update: async ({ name, shortcut }) => {
                      localStorage.setItem('command_' + name, shortcut);
                    },
                    reset: async (name) => {
                      localStorage.removeItem('command_' + name);
                    }
                  },
                  tabGroups: {
                    query: async () => []
                  },
                  i18n: {
                    getMessage: (key, placeholders) => {
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

  const url: Page['url'] = () => {
    const currentUrl = activePage.url();
    const local = `http://127.0.0.1:${String(localServerPort)}/`;
    return currentUrl.startsWith(local)
      ? currentUrl.replace(local, `moz-extension://${extensionId}/`)
      : currentUrl;
  };

  return new Proxy(activePage, {
    get(target, prop) {
      if (prop === 'goto') return goto;
      if (prop === 'url') return url;
      const value: unknown = Reflect.get(target, prop);
      if (prop === 'constructor') return value;
      if (typeof value !== 'function') return value;
      // A method runs on the real page, whatever it is called on
      return (...args: unknown[]): unknown => {
        const result: unknown = Reflect.apply(value, target, args);
        return result;
      };
    },
  });
}

const pathToExtension = path.join(process.cwd(), 'dist');
// Must match browser_specific_settings.gecko.id in manifest.json
const EXTENSION_ID = 'tab-groups-viewer@example.com';

function isTruthyEnv(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function shouldRunHeadless(browserName: string): boolean {
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

function assertHeadedDisplayAvailable(
  browserName: string,
  headless: boolean,
): void {
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

function getFirefoxPageProxy(page: Page, extensionId: string): Page {
  const existing = firefoxPageProxies.get(page);
  if (existing !== undefined) {
    return existing;
  }
  const proxy = createFirefoxPageProxy(page, extensionId);
  firefoxPageProxies.set(page, proxy);
  return proxy;
}

function ensureExtensionId(
  browserName: string,
  id: string | undefined,
): string {
  if (!id) {
    throw new Error(
      `Extension ID for ${browserName} was not resolved. ` +
        'Check the Playwright browser install, extension bootstrap logs, and prefs.js UUID registration.',
    );
  }

  return id;
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function extensionUuidIn(
  prefsPath: string,
  extensionId: string,
): string | undefined {
  if (!fs.existsSync(prefsPath)) return undefined;
  const contents = fs.readFileSync(prefsPath, 'utf8');
  const match =
    /user_pref\("extensions\.webextensions\.uuids",\s*"(.+?)"\)/.exec(contents);
  if (match?.[1] === undefined) return undefined;
  const uuids: unknown = JSON.parse(match[1].replace(/\\"/g, '"'));
  const uuid = isRecord(uuids) ? uuids[extensionId] : undefined;
  return isString(uuid) ? uuid : undefined;
}

// Poll prefs.js until Firefox has written the extension's UUID (typically < 2s).
async function readFirefoxUuidFromPrefs(
  prefsPath: string,
  extensionId: string,
  timeoutMs = 10000,
  deadline = Date.now() + timeoutMs,
): Promise<string | undefined> {
  if (Date.now() >= deadline) return undefined;
  const uuid = extensionUuidIn(prefsPath, extensionId);
  if (uuid) return uuid;
  await sleep(500);
  return readFirefoxUuidFromPrefs(prefsPath, extensionId, timeoutMs, deadline);
}

/** The environment of this process without the variables that are not set */
const definedEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );

async function launchChromium(
  userDataDir: string,
  headless: boolean,
  uiLanguage: string,
): Promise<BrowserContext> {
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  // Use the full Chromium binary (not chrome-headless-shell) so that
  // MV3 extension service workers are registered. The headless shell
  // strips the UI layer and does not support extensions.
  return chromium.launchPersistentContext(userDataDir, {
    executablePath: chromium.executablePath(),
    headless,
    // The language of the browser itself, which is what picks the _locales folder
    env: { ...definedEnv(), LANGUAGE: uiLanguage },
    args: [
      `--lang=${uiLanguage}`,
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
}

async function launchFirefox(
  userDataDir: string,
  headless: boolean,
  uiLanguage: string,
): Promise<BrowserContext> {
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
  const context = await firefox.launchPersistentContext(userDataDir, {
    headless,
    env: { ...definedEnv(), ...(headless ? { MOZ_HEADLESS: '1' } : {}) },
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
      'intl.locale.requested': uiLanguage,
      'intl.accept_languages': uiLanguage,
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
  const uuid = ensureExtensionId(
    'firefox',
    await readFirefoxUuidFromPrefs(prefsPath, EXTENSION_ID, 15000),
  );
  firefoxExtensionIds.set(context, uuid);
  console.log(`[rdp] Extension installed, UUID: ${uuid}`);
  return context;
}

/** The id the browser gave the extension, from its service worker in Chromium */
async function chromiumExtensionId(
  context: BrowserContext,
): Promise<string | undefined> {
  const idOf = (url: string) => url.split('/')[2];
  // Service worker may already be registered before this fixture runs.
  // Check synchronously first, then fall back to waitForEvent.
  const [existing] = context.serviceWorkers();
  if (existing !== undefined) {
    return idOf(existing.url());
  }
  try {
    const worker = await context.waitForEvent('serviceworker', {
      timeout: 15000,
    });
    return idOf(worker.url());
  } catch {
    // One final synchronous check after the wait in case it registered
    // during the timeout window without firing the event.
    const [late] = context.serviceWorkers();
    return late === undefined ? undefined : idOf(late.url());
  }
}

interface ExtensionFixtures {
  /** The scheme of the extension's own pages in this browser */
  extensionProtocol: string;
  extensionId: string;
}

interface ExtensionOptions {
  /** The language the browser is started in, as a BCP 47 tag such as `pt-BR` */
  uiLanguage: string;
}

export const test = base.extend<ExtensionFixtures & ExtensionOptions>({
  uiLanguage: ['en-US', { option: true }],
  context: async ({ browserName, uiLanguage }, use) => {
    const userDataDir = path.join(
      process.cwd(),
      `test-user-data-${browserName}`,
    );
    const headless = shouldRunHeadless(browserName);

    assertHeadedDisplayAvailable(browserName, headless);

    if (browserName !== 'chromium' && browserName !== 'firefox') {
      throw new Error(`The extension is not tested in ${browserName}`);
    }
    const context =
      browserName === 'chromium'
        ? await launchChromium(userDataDir, headless, uiLanguage)
        : await launchFirefox(userDataDir, headless, uiLanguage);

    context.on('page', (page) => {
      page.on('console', (msg) => {
        console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
      });
      page.on('pageerror', (err) => {
        console.error(`[Browser Error] ${err.message}`);
      });
    });
    // Wrap context.newPage so that tests creating pages directly (e.g. the
    // options test) also get a proxy that can follow extension URL navigation.
    const firefoxId = firefoxExtensionIds.get(context);
    if (firefoxId !== undefined) {
      const origNewPage = context.newPage.bind(context);
      context.newPage = async () =>
        getFirefoxPageProxy(await origNewPage(), firefoxId);
    }
    try {
      await use(context);
    } finally {
      try {
        await context.close();
      } catch {
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
  },
  page: async ({ context }, use) => {
    // Do NOT depend on the built-in `page` fixture: it would call our wrapped
    // context.newPage(), producing a proxy. Then wrapping that proxy in another
    // proxy here causes two simultaneous goto() calls on the same real page,
    // which cancel each other (NS_ERROR_NOT_AVAILABLE).
    // Instead, take the initial page that launchPersistentContext already opened.
    const [initialPage] = context.pages();
    if (initialPage === undefined) {
      throw new Error('The browser opened no page');
    }
    const firefoxId = firefoxExtensionIds.get(context);
    await use(
      firefoxId === undefined
        ? initialPage
        : getFirefoxPageProxy(initialPage, firefoxId),
    );
  },
  extensionProtocol: async ({ browserName }, use) => {
    await use(browserName === 'firefox' ? 'moz-extension' : 'chrome-extension');
  },
  extensionId: async ({ context, browserName }, use) => {
    const id =
      browserName === 'chromium'
        ? await chromiumExtensionId(context)
        : firefoxExtensionIds.get(context);

    const resolvedId = ensureExtensionId(browserName, id);
    console.log(`Extension ID for ${browserName}: ${resolvedId}`);
    await use(resolvedId);
  },
});

export { expect };
