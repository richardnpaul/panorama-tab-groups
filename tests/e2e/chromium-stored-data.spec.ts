import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { type BrowserContext, chromium, expect, test } from '@playwright/test';
import { isRecord } from '../../src/js/share/guards.js';

// What Chromium does with the values the add-on keeps. Chromium has no `browser.sessions` values,
// so the add-on keeps them in `storage.local` under the id of the tab or window they belong to
// (`adapters/browser/sessions-emulation.ts`). These facts are what the review of the data
// structures (docs/plans/data-structures-review.md, F1 and F2) found out, in a real Chromium.
// Where earlier versions kept the values (adapters/browser/sessions-emulation.ts)
const EMULATION_KEY = '__mock_sessions';

test.describe('Values kept in Chromium', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Only Chromium keeps them in storage',
  );

  let profile: string;
  let server: http.Server;
  let port: number;

  test.beforeEach(async () => {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-profile-'));
    server = http.createServer((request, response) => {
      // The address is shown as text, never as markup, as in the lab's pages (`lab/lab.ts`)
      const shown = (request.url ?? '').replace(/[<&]/gu, '');
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<title>${shown}</title>${shown}`);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;
  });

  test.afterEach(() => {
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  });

  /** Chromium with the extension, on the profile of the test; `restore` opens what was open before */
  async function launch(restore = false) {
    const dist = path.join(process.cwd(), 'dist');
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: chromium.executablePath(),
      headless: true,
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        ...(restore ? ['--restore-last-session'] : []),
      ],
    });
    const [worker] = context.serviceWorkers();
    const found =
      worker ??
      (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    return { context, extensionId: found.url().split('/')[2] ?? '' };
  }

  /** A page of the extension, to ask the browser what it knows and what is stored */
  async function inspector(context: BrowserContext, extensionId: string) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    const all = async (): Promise<Record<string, unknown>> => {
      const data: unknown = await page.evaluate(async (name) => {
        // Asked for by its name, so it is the only thing there is
        const items = await browser.storage.local.get(name);
        const value: unknown = Object.values(items)[0];
        return value;
      }, EMULATION_KEY);
      return isRecord(data) ? data : {};
    };
    const scopeOf = async (scope: 'tabs' | 'windows') => {
      const values = (await all())[scope];
      return isRecord(values) ? values : {};
    };

    return {
      tabs: () =>
        page.evaluate(async () => {
          const tabs = await browser.tabs.query({});
          return tabs.map(({ id, windowId, url }) => ({ id, windowId, url }));
        }),
      /** The values under each id of a tab or a window, as stored */
      stored: scopeOf,
      keep: async (
        scope: 'tabs' | 'windows',
        id: number,
        key: string,
        value: unknown,
      ) => {
        const data = await all();
        const values = await scopeOf(scope);
        const own = values[String(id)];
        await page.evaluate(
          async (next) => {
            await browser.storage.local.set(next);
          },
          {
            [EMULATION_KEY]: {
              ...data,
              [scope]: {
                ...values,
                [String(id)]: { ...(isRecord(own) ? own : {}), [key]: value },
              },
            },
          },
        );
      },
    };
  }

  const settle = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 2000);
    });

  test('keeps the values of tabs that are closed, and of windows that are, for ever', async () => {
    test.setTimeout(90000);
    const { context, extensionId } = await launch();
    try {
      await settle();
      const look = await inspector(context, extensionId);
      const pages = await Promise.all(
        [1, 2, 3].map(async (n) => {
          const page = await context.newPage();
          await page.goto(`http://127.0.0.1:${String(port)}/page${String(n)}`);
          return page;
        }),
      );
      await settle();
      const open = (await look.tabs()).filter(({ url }) =>
        url?.includes('/page'),
      );
      expect(open).toHaveLength(3);
      const storedOpen = Object.keys(await look.stored('tabs'));
      open.forEach(({ id }) => {
        expect(storedOpen).toContain(String(id));
      });

      await Promise.all(pages.map((page) => page.close()));
      await settle();

      // The tabs are gone; their values are not
      const remaining = Object.keys(await look.stored('tabs'));
      open.forEach(({ id }) => {
        expect(remaining).toContain(String(id));
      });
    } finally {
      await context.close();
    }
  });

  test('gives a tab and a window that are restored new ids, so the values under the old ones do not reach them', async () => {
    test.setTimeout(90000);
    const first = await launch();
    let original:
      | {
          id: number | undefined;
          windowId: number | undefined;
          url: string | undefined;
        }
      | undefined;
    try {
      await settle();
      const look = await inspector(first.context, first.extensionId);
      await Promise.all(
        [1, 2, 3].map(async (n) => {
          const page = await first.context.newPage();
          await page.goto(`http://127.0.0.1:${String(port)}/page${String(n)}`);
        }),
      );
      await settle();
      original = (await look.tabs()).find(({ url }) => url?.endsWith('/page2'));
      expect(original?.id).toBeDefined();
      // A group that this tab and no other is in, as the user would have made it
      await look.keep('tabs', original?.id ?? 0, 'groupId', 7);
      await look.keep('windows', original?.windowId ?? 0, 'activeGroup', 7);
      await settle();
    } finally {
      await first.context.close();
    }

    const second = await launch(true);
    try {
      await settle();
      const look = await inspector(second.context, second.extensionId);
      const restored = (await look.tabs()).find(({ url }) =>
        url?.endsWith('/page2'),
      );
      // The tab is back, in a window that is back, and neither has the id it had
      expect(restored).toBeDefined();
      expect(restored?.id).not.toBe(original?.id);
      expect(restored?.windowId).not.toBe(original?.windowId);

      const tabs = await look.stored('tabs');
      const windows = await look.stored('windows');
      // What was stored under the old ids is still there, where nothing will ask for it...
      expect(tabs[String(original?.id)]).toMatchObject({ groupId: 7 });
      expect(windows[String(original?.windowId)]).toMatchObject({
        activeGroup: 7,
      });
      // ...and the restored tab and window have what the add-on made for them since
      expect(tabs[String(restored?.id)]).not.toMatchObject({ groupId: 7 });
      expect(windows[String(restored?.windowId)]).not.toMatchObject({
        activeGroup: 7,
      });
    } finally {
      await second.context.close();
    }
  });
});
