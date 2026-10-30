// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSessions } from '../../support/fake-sessions.js';
import { markedMessage, textsOutsideMessages } from '../../support/messages.js';

const backupJson = JSON.stringify({
  file: { type: 'tgvView', version: 1 },
  windows: [
    {
      groups: [{ id: 1, name: 'Work', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
      tabs: [{ url: 'https://a/', groupId: 1, pinned: false }],
      activeGroup: 1,
      groupIndex: 2,
    },
  ],
});

// The real options page, so the composition is checked against the real markup
const optionsPage = readFileSync('src/options.html', 'utf8');
const pageBody = /<body[^>]*>([\s\S]*)<\/body>/.exec(optionsPage)?.[1] ?? '';

const fn = () => undefined;

type StorageListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

function fakeBrowser(stored: Record<string, unknown>) {
  const sessions = createFakeSessions();
  const synced: Record<string, unknown> = { ...stored };
  const storageListeners: StorageListener[] = [];
  return {
    runtime: {
      getManifest: () => ({ version: '2.0' }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      sync: {
        get: vi.fn((defaults: object) =>
          Promise.resolve({ ...defaults, ...synced }),
        ),
        set: vi.fn((items: Record<string, unknown>) => {
          Object.assign(synced, items);
          const changes = Object.fromEntries(
            Object.entries(items).map(([name, newValue]) => [
              name,
              { newValue },
            ]),
          );
          storageListeners.forEach((listener) => {
            listener(changes, 'sync');
          });
          return Promise.resolve();
        }),
      },
      onChanged: {
        addListener: (listener: StorageListener) => {
          storageListeners.push(listener);
        },
      },
    },
    commands: {
      getAll: vi
        .fn()
        .mockResolvedValue([
          { name: 'activate-next-group', shortcut: 'Alt+W' },
        ]),
      update: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    },
    i18n: {
      getMessage: markedMessage,
    },
    sessions: sessions.api.sessions,
    windows: {
      getAll: vi.fn().mockResolvedValue([{ id: 1 }]),
      create: vi.fn().mockResolvedValue({ id: 9 }),
      update: vi.fn().mockResolvedValue({}),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([
        { id: 3, windowId: 1, index: 0, discarded: false },
        { id: 4, windowId: 2, index: 0, discarded: true },
      ]),
      create: vi.fn().mockResolvedValue({ id: 70 }),
      remove: vi.fn().mockResolvedValue(undefined),
      hide: fn,
      group: fn,
    },
    tabGroups: { query: fn },
    downloads: { download: vi.fn().mockResolvedValue(1) },
    tabValues: sessions.tabValues,
    windowValues: sessions.windowValues,
    slot: sessions.slot,
  };
}

type FakeBrowser = ReturnType<typeof fakeBrowser>;

/** The system's colour setting, which can be changed while the page is open */
function fakeSystemTheme(prefersDark: boolean) {
  const listeners: (() => void)[] = [];
  const query = {
    matches: prefersDark,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.push(listener);
    },
  };
  // Only the question about dark gets this answer; any other is a "no"
  vi.stubGlobal('matchMedia', (asked: string) =>
    asked === '(prefers-color-scheme: dark)'
      ? query
      : { matches: false, addEventListener: fn },
  );
  return {
    change: (nowDark: boolean) => {
      query.matches = nowDark;
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
}

async function start(
  stored: Record<string, unknown> = {},
  prepare: (browser: FakeBrowser) => void = fn,
) {
  vi.resetModules();
  const browser = fakeBrowser(stored);
  prepare(browser);
  vi.stubGlobal('browser', browser);
  const alert = vi.spyOn(window, 'alert').mockImplementation(fn);
  const { startOptions } = await import('../../../src/js/options/start.js');
  await startOptions();
  return { browser, alert };
}

const element = (selector: string): Element => {
  const found = document.querySelector(selector);
  if (found === null) {
    throw new Error(`test page has no ${selector}`);
  }
  return found;
};

const checkedValue = (name: string) =>
  document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)
    ?.value;

/** Choose these files in the backup input */
function chooseBackup(files: File[]) {
  const input = element('#backupFileInput');
  Object.defineProperty(input, 'files', {
    value: Object.assign([...files], {
      item: (index: number) => files[index] ?? null,
    }),
  });
  input.dispatchEvent(new Event('change'));
}

describe('options/start.ts', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(fn);
    document.body.innerHTML = pageBody;
    document.body.className = '';
    fakeSystemTheme(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  describe('theme', () => {
    it.each(['dark', 'light'])(
      'dresses the page in the %s theme that is stored',
      async (theme) => {
        await start({ theme });

        expect(document.body.classList.contains(`theme-${theme}`)).toBe(true);
      },
    );

    it('follows the system while the theme is Auto, as the system changes', async () => {
      const system = fakeSystemTheme(true);
      await start({ theme: 'auto' });
      expect(document.body.classList.contains('theme-dark')).toBe(true);

      system.change(false);

      expect(document.body.classList.contains('theme-light')).toBe(true);
      expect(document.body.classList.contains('theme-dark')).toBe(false);
    });

    it('changes the page as the theme is chosen, with no reload', async () => {
      await start({ theme: 'light' });
      expect(document.body.classList.contains('theme-light')).toBe(true);

      document.querySelector<HTMLInputElement>('#themeDark')?.click();

      await vi.waitFor(() => {
        expect(document.body.classList.contains('theme-dark')).toBe(true);
      });
      expect(document.body.classList.contains('theme-light')).toBe(false);
    });
  });

  it('shows the options that storage holds', async () => {
    await start({ view: 'freeform', theme: 'light', toolbarPosition: 'left' });

    expect(checkedValue('view')).toBe('freeform');
    expect(checkedValue('theme')).toBe('light');
    expect(checkedValue('toolbarPosition')).toBe('left');
  });

  it('shows the shortcuts of the browser and the texts of its language', async () => {
    await start();

    expect(
      document.querySelector<HTMLInputElement>('#activate-next-group input')
        ?.value,
    ).toBe('Alt+W');
    expect(element('#optionsView h2').textContent).toBe(
      markedMessage('optionsView'),
    );
  });

  it('sets the direction and the language of the page from the browser', async () => {
    await start({}, (browser) => {
      browser.i18n.getMessage = (name: string) =>
        ({ '@@bidi_dir': 'rtl', '@@ui_locale': 'ar' })[name] ??
        markedMessage(name);
    });

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('shows no text that is not from a message', async () => {
    await start();
    await vi.waitFor(() => {
      expect(element('#numberOfTabs').textContent).not.toBe('');
    });

    expect(textsOutsideMessages(document.body)).toEqual([]);
  });

  it('keeps only the option that changed', async () => {
    const { browser } = await start();

    document.querySelector<HTMLInputElement>('#themeDark')?.click();

    await vi.waitFor(() => {
      expect(browser.storage.sync.set).toHaveBeenCalledTimes(1);
    });
    expect(browser.storage.sync.set).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('tells what the browser can do with native groups', async () => {
    await start();

    expect(element('#nativeGroupsWarning').textContent).toBe(
      markedMessage('optionsNativeGroupsHybrid'),
    );
  });

  it('counts the tabs of every window and their thumbnails', async () => {
    const { browser } = await start({}, ({ tabValues, slot }) => {
      tabValues.set(slot(3, 'thumbnail'), 'ABCDE');
    });

    await vi.waitFor(() => {
      expect(element('#numberOfTabs').textContent).toBe(
        markedMessage('optionsStatisticsNumberOfTabsAndActive', ['2', '1']),
      );
    });
    expect(element('#thumbnailCacheSize').textContent).toBe(
      markedMessage('byteSizeBytes', ['5']),
    );
    expect(browser.tabs.query).toHaveBeenCalledWith({});
  });

  describe('backups', () => {
    it('opens the backup in the file that was chosen, in a window of its own', async () => {
      const { browser, alert } = await start();

      chooseBackup([
        new File([backupJson], 'backup.json', { type: 'application/json' }),
      ]);

      await vi.waitFor(() => {
        expect(browser.windowValues.get('9:activeGroup')).toBe(1);
      });
      expect(alert).not.toHaveBeenCalled();
      expect(browser.windows.create).toHaveBeenCalledTimes(1);
      expect(browser.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://a/', windowId: 9 }),
      );
    });

    it('says the file is invalid when it is not JSON', async () => {
      const { browser, alert } = await start();

      chooseBackup([new File(['x'], 'backup.txt', { type: 'text/plain' })]);

      await vi.waitFor(() => {
        expect(alert).toHaveBeenCalledWith(
          markedMessage('optionsBackupInvalidFile'),
        );
      });
      expect(browser.windows.create).not.toHaveBeenCalled();
    });

    it('offers a file made from a link to the backup', async () => {
      const createObjectURL = vi.fn().mockReturnValue('blob:backup');
      Object.defineProperty(URL, 'createObjectURL', {
        value: createObjectURL,
        configurable: true,
      });
      try {
        const { browser } = await start();

        element('#saveBackupButton').dispatchEvent(new Event('click'));

        await vi.waitFor(() => {
          expect(browser.downloads.download).toHaveBeenCalledTimes(1);
        });
        const blob: unknown = createObjectURL.mock.calls[0]?.[0];
        expect(blob).toBeInstanceOf(Blob);
        expect(blob instanceof Blob && blob.type).toBe('application/json');
        const text = blob instanceof Blob ? await blob.text() : '';
        expect(text).toContain('"type": "tgvView"');
        const options: unknown = browser.downloads.download.mock.calls[0]?.[0];
        expect(options).toMatchObject({
          url: 'blob:backup',
          conflictAction: 'uniquify',
          saveAs: true,
        });
        expect(JSON.stringify(options)).toMatch(
          /tgvView-backup-\d{6}-\d{6}\.json/u,
        );
      } finally {
        Reflect.deleteProperty(URL, 'createObjectURL');
      }
    });
  });
});
