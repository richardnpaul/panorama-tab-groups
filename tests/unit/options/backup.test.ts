// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backupJson = JSON.stringify({
  file: { type: 'panoramaView', version: 1 },
  windows: [
    {
      groups: [{ id: 1, name: 'Work', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
      tabs: [{ url: 'https://a/', groupId: 1, pinned: false }],
      activeGroup: 1,
      groupIndex: 2,
    },
  ],
});

function fakeBrowser() {
  const tabValues = new Map<string, unknown>();
  const windowValues = new Map<string, unknown>();
  return {
    runtime: {
      getManifest: () => ({ version: '2.0' }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      sync: {
        get: vi.fn((defaults: object) =>
          Promise.resolve({ ...defaults, view: 'popup' }),
        ),
      },
    },
    sessions: {
      getWindowValue: (id: number, key: string) =>
        Promise.resolve(windowValues.get(`${String(id)}:${key}`)),
      setWindowValue: (id: number, key: string, value: unknown) => {
        windowValues.set(`${String(id)}:${key}`, value);
        return Promise.resolve();
      },
      getTabValue: (id: number, key: string) =>
        Promise.resolve(tabValues.get(`${String(id)}:${key}`)),
      setTabValue: (id: number, key: string, value: unknown) => {
        tabValues.set(`${String(id)}:${key}`, value);
        return Promise.resolve();
      },
      removeTabValue: () => Promise.resolve(),
    },
    windows: {
      getAll: vi.fn().mockResolvedValue([{ id: 1 }]),
      create: vi.fn().mockResolvedValue({ id: 9 }),
      update: vi.fn().mockResolvedValue({}),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 70 }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    downloads: { download: vi.fn().mockResolvedValue(1) },
    tabValues,
    windowValues,
  };
}

async function load() {
  vi.resetModules();
  const browser = fakeBrowser();
  vi.stubGlobal('browser', browser);
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  const module = await import('../../../src/js/options/backup.js');
  return { ...module, browser, alert };
}

const inputWith = (files: File[]): HTMLInputElement => {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', {
    value: Object.assign([...files], {
      item: (index: number) => files[index] ?? null,
    }),
  });
  return input;
};

const changeOf = (input: HTMLInputElement): Event => {
  const event = new Event('change');
  Object.defineProperty(event, 'target', { value: input });
  return event;
};

describe('options/backup.ts', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('loadBackup', () => {
    it('opens the backup in the file that was chosen, in a window of its own', async () => {
      const { loadBackup, browser, alert } = await load();
      const file = new File([backupJson], 'backup.json', {
        type: 'application/json',
      });

      await loadBackup(changeOf(inputWith([file])));

      expect(alert).not.toHaveBeenCalled();
      expect(browser.windows.create).toHaveBeenCalledTimes(1);
      expect(browser.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://a/', windowId: 9 }),
      );
      expect(browser.windowValues.get('9:activeGroup')).toBe(1);
    });

    it('says the file is invalid when it is not JSON', async () => {
      const { loadBackup, alert, browser } = await load();
      const file = new File(['x'], 'backup.txt', { type: 'text/plain' });

      await loadBackup(changeOf(inputWith([file])));

      expect(alert).toHaveBeenCalledWith('Invalid file');
      expect(browser.windows.create).not.toHaveBeenCalled();
    });

    it('says the file is invalid when none was chosen', async () => {
      const { loadBackup, alert } = await load();

      await loadBackup(changeOf(inputWith([])));

      expect(alert).toHaveBeenCalledWith('Invalid file');
    });

    it('says the file is invalid when the event is not from an input', async () => {
      const { loadBackup, alert } = await load();
      const event = new Event('change');
      Object.defineProperty(event, 'target', {
        value: document.createElement('div'),
      });

      await loadBackup(event);

      expect(alert).toHaveBeenCalledWith('Invalid file');
    });

    it('says the file is invalid when the event has no target', async () => {
      const { loadBackup, alert } = await load();

      await loadBackup(new Event('change'));

      expect(alert).toHaveBeenCalledWith('Invalid file');
    });
  });

  describe('saveBackup', () => {
    it('offers a file made from a link to the backup', async () => {
      const { saveBackup, browser } = await load();
      const createObjectURL = vi.fn().mockReturnValue('blob:backup');
      Object.defineProperty(URL, 'createObjectURL', {
        value: createObjectURL,
        configurable: true,
      });

      try {
        await saveBackup();
      } finally {
        Reflect.deleteProperty(URL, 'createObjectURL');
      }

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob: unknown = createObjectURL.mock.calls[0]?.[0];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob instanceof Blob && blob.type).toBe('application/json');
      const text = blob instanceof Blob ? await blob.text() : '';
      expect(text).toContain('"type": "panoramaView"');
      const options: unknown = browser.downloads.download.mock.calls[0]?.[0];
      expect(options).toMatchObject({
        url: 'blob:backup',
        conflictAction: 'uniquify',
        saveAs: true,
      });
      expect(JSON.stringify(options)).toMatch(
        /panoramaView-backup-\d{6}-\d{6}\.json/u,
      );
    });
  });
});
