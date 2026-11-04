import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type BrowserContext,
  type Page,
  chromium,
  expect,
  test,
} from '@playwright/test';
import { DATA_VERSION } from '../../src/js/app/migrations.js';
import { isRecord } from '../../src/js/share/guards.js';

// The add-on stopped and started again in a real Chromium (docs/plans/data-structures-review.md,
// decisions 3 and 7): what becomes of its open page, and its stored data brought to the current version.

const EMULATION_KEY = '__mock_sessions';

test.describe('The add-on started again, in Chromium', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Asked of the Chromium that Playwright brings',
  );

  let profile: string;
  let downloads: string;

  test.beforeEach(() => {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-profile-'));
    downloads = path.join(profile, 'Downloads');
    // The profile's own Downloads folder, so nothing is written to the user's
    fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
    fs.writeFileSync(
      path.join(profile, 'Default', 'Preferences'),
      JSON.stringify({
        download: { default_directory: downloads, prompt_for_download: false },
      }),
    );
  });

  test.afterEach(() => {
    fs.rmSync(profile, { recursive: true, force: true });
  });

  async function launch() {
    const dist = path.join(process.cwd(), 'dist');
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: chromium.executablePath(),
      headless: true,
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
    // Chromium's own way with downloads, which keeps the name and folder the add-on asks for
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
    const [worker] = context.serviceWorkers();
    const found =
      worker ??
      (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    return { context, worker: found };
  }

  /** A page of the add-on, to ask the browser what is stored */
  async function extensionPage(context: BrowserContext, extensionId: string) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    return page;
  }

  /** Stop the add-on's service worker, as the browser does after a while with nothing to do */
  async function stopBackground(context: BrowserContext, page: Page) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
  }

  /**
   * Stop it, and let the next event of the add-on's, a new tab, start it again: the background
   * starts from the beginning, as after an update. (Playwright's Chromium does not load an add-on
   * again after `runtime.reload()`: its pages are refused.)
   */
  async function restartBackground(context: BrowserContext, page: Page) {
    await stopBackground(context, page);
    await context.newPage();
  }

  /** Everything the emulation keeps, as it is stored */
  const emulation = (page: Page) =>
    page.evaluate(async (key) => {
      const items: Record<string, unknown> =
        await browser.storage.local.get(key);
      return items[key];
    }, EMULATION_KEY);

  /** The extension's values of a window, as the emulation keeps them */
  async function windowValues(
    page: Page,
    windowId: number,
  ): Promise<Record<string, unknown>> {
    const data = await emulation(page);
    const windows =
      isRecord(data) && isRecord(data.windows) ? data.windows : {};
    const values = windows[String(windowId)];
    return isRecord(values) ? values : {};
  }

  // `runtime.reload()` unloads the add-on, which is as far as this Chromium goes: it is not loaded again
  test('closes its open view when it is unloaded to start again', async () => {
    const { context, worker } = await launch();
    try {
      const extensionId = worker.url().split('/')[2] ?? '';
      const view = await context.newPage();
      await view.goto(`chrome-extension://${extensionId}/view.html`);

      worker
        .evaluate(() => {
          browser.runtime.reload();
        })
        .catch(() => undefined);

      await expect.poll(() => view.isClosed(), { timeout: 10000 }).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('backs up data of a version before 2, then brings it to the current version', async () => {
    test.setTimeout(60000);
    const { context, worker } = await launch();
    try {
      const extensionId = worker.url().split('/')[2] ?? '';
      const page = await extensionPage(context, extensionId);
      // The add-on has set up the window it was started in
      const windowId = await page.evaluate(
        async () => (await browser.windows.getCurrent()).id ?? 0,
      );
      await expect
        .poll(() => windowValues(page, windowId))
        .toMatchObject({ schemaVersion: DATA_VERSION });

      // What a version before 2 left: groups with a container, and no version anywhere
      const data = await emulation(page);
      const stored = isRecord(data) ? data : {};
      const windows = isRecord(stored.windows) ? stored.windows : {};
      const { schemaVersion, ...kept } = await windowValues(page, windowId);
      expect(schemaVersion).toBe(DATA_VERSION);
      // The name the group has, which is its native group's title: a report of the native group after
      // the start renames the group after it
      const groups: unknown[] = Array.isArray(kept.groups) ? kept.groups : [];
      const [first] = groups;
      const name: unknown = isRecord(first) ? first.name : undefined;
      const before = {
        ...stored,
        windows: {
          ...windows,
          [String(windowId)]: {
            ...kept,
            groups: [
              {
                id: 0,
                name,
                containerId: 'firefox-default',
                rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
              },
            ],
          },
        },
      };
      await page.evaluate(
        async ({ key, value }) => {
          await browser.storage.local.set({ [key]: value });
          await browser.storage.local.remove('schemaVersion');
        },
        { key: EMULATION_KEY, value: before },
      );

      await restartBackground(context, page);
      const after = page;

      await expect
        .poll(() => windowValues(after, windowId), { timeout: 20000 })
        .toMatchObject({ schemaVersion: DATA_VERSION });
      const values = await windowValues(after, windowId);
      expect(values).toMatchObject({
        groups: [{ id: 0, name }, { id: -2 }],
      });
      expect(JSON.stringify(values)).not.toContain('containerId');
      const version = await after.evaluate(async () => {
        const items: Record<string, unknown> =
          await browser.storage.local.get('schemaVersion');
        return items.schemaVersion;
      });
      expect(version).toBe(DATA_VERSION);

      // The data as it was before, in a backup
      const backup = path.join(
        downloads,
        'panorama-tab-groups-backups',
        'backup-1.json',
      );
      expect(fs.existsSync(backup)).toBe(true);
      expect(JSON.parse(fs.readFileSync(backup, 'utf8'))).toMatchObject({
        windows: [{ groups: [{ id: 0, name }] }],
      });
    } finally {
      await context.close();
    }
  });

  test('keeps the links to native groups in storage.session while its background is stopped and started again', async () => {
    test.setTimeout(60000);
    const { context, worker } = await launch();
    try {
      const extensionId = worker.url().split('/')[2] ?? '';
      const page = await extensionPage(context, extensionId);
      const links = () =>
        page.evaluate(async () =>
          Object.entries(await browser.storage.session.get(null)).filter(
            ([key]) => key.startsWith('nativeGroup:'),
          ),
        );
      // Tabs opened are put in the group shown, which is given a native group
      await context.newPage();
      await expect.poll(links, { timeout: 20000 }).not.toEqual([]);
      const before = await links();
      await worker.evaluate(() => {
        Reflect.set(globalThis, 'labMarker', 'first');
      });

      // While the background is stopped, what it kept is still there for its pages to read
      await stopBackground(context, page);
      expect(await links()).toEqual(before);

      // Started again by a new tab: a background that has nothing of the old one's memory
      await context.newPage();
      await expect
        .poll(() =>
          worker.evaluate(() => String(Reflect.get(globalThis, 'labMarker'))),
        )
        .toBe('undefined');
      expect(await links()).toEqual(before);
    } finally {
      await context.close();
    }
  });
});
