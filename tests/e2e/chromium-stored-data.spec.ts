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
      /** Put tabs in a new native group, with a title, as the user would */
      group: (tabIds: number[], windowId: number, title: string) =>
        page.evaluate(
          async (args) => {
            const id = await browser.tabs.group({
              tabIds: args.tabIds,
              createProperties: { windowId: args.windowId },
            });
            await browser.tabGroups.update(id, { title: args.title });
          },
          { tabIds, windowId, title },
        ),
      /** One value of a window or a tab, as the emulation keeps it */
      valueOf: async (scope: 'tabs' | 'windows', id: number, key: string) => {
        const values = (await scopeOf(scope))[String(id)];
        return isRecord(values) ? values[key] : undefined;
      },
      /** The links of the groups of a window to native groups, in `storage.session` */
      links: (windowId: number): Promise<Record<string, unknown>> =>
        page.evaluate(async (id) => {
          const stored = await browser.storage.session.get(null);
          return Object.fromEntries(
            Object.entries(stored).filter(([key]) =>
              key.startsWith(`nativeGroup:${String(id)}:`),
            ),
          );
        }, windowId),
      /** The native group a tab is in, or -1 */
      nativeGroupOf: (tabId: number) =>
        page.evaluate(
          async (id) => (await browser.tabs.get(id)).groupId,
          tabId,
        ),
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

  test('lets go of the values of a tab when it is closed, and keeps those of a window that is for a while', async () => {
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

      // The tabs are gone, and so are their values: a tab that comes back has a new id
      const remaining = Object.keys(await look.stored('tabs'));
      open.forEach(({ id }) => {
        expect(remaining).not.toContain(String(id));
      });

      // A window that closes is dated and kept, for a window that comes back to be given its groups
      const closing = await context.newPage();
      await closing.goto(`chrome-extension://${extensionId}/options.html`);
      const windowId = await closing.evaluate(async () => {
        const created = await browser.windows.create({ url: 'about:blank' });
        return created.id ?? 0;
      });
      await settle();
      expect(Object.keys(await look.stored('windows'))).toContain(
        String(windowId),
      );
      await closing.evaluate(async (id) => {
        await browser.windows.remove(id);
      }, windowId);
      await settle();

      const dated = await look.valueOf('windows', windowId, 'closedAt');
      expect(typeof dated).toBe('number');
    } finally {
      await context.close();
    }
  });

  test('gives a tab and a window that are restored new ids, and lets go of the values under the old ones once the window has used them', async () => {
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
      // What was stored under the old ids is not: the window's groups went to the window that came
      // back (the next test), and the tab's values with no tab to reach are let go of
      expect(tabs[String(original?.id)]).toBeUndefined();
      expect(windows[String(original?.windowId)]).toBeUndefined();
      // The restored tab has the group the add-on found for it, not the one the old tab had
      expect(tabs[String(restored?.id)]).not.toMatchObject({ groupId: 7 });
      expect(windows[String(restored?.windowId)]).toMatchObject({
        groups: expect.arrayContaining([expect.objectContaining({ id: 0 })]),
      });
    } finally {
      await second.context.close();
    }
  });

  test('rebuilds the groups of a window that is restored from its native groups and what was kept of the window', async () => {
    test.setTimeout(90000);
    const rects = {
      Grp0: { x: 0, y: 0, w: 0.5, h: 0.5 },
      Alpha: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      Beta: { x: 0.5, y: 0.1, w: 0.2, h: 0.2 },
      Empty: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 },
    };
    const first = await launch();
    try {
      await settle();
      const look = await inspector(first.context, first.extensionId);
      await Promise.all(
        ['a1', 'a2', 'b1'].map(async (name) => {
          const page = await first.context.newPage();
          await page.goto(`http://127.0.0.1:${String(port)}/${name}`);
        }),
      );
      await settle();
      const open = await look.tabs();
      const idOf = (name: string): number =>
        open.find(({ url }) => url?.endsWith(`/${name}`))?.id ?? 0;
      const windowId =
        open.find(({ url }) => url?.endsWith('/a1'))?.windowId ?? 0;

      // As the user would have made them: two native groups with titles, and groups of the add-on's
      // with places of their own, one of which has no tab
      await look.group([idOf('a1'), idOf('a2')], windowId, 'Alpha');
      await look.group([idOf('b1')], windowId, 'Beta');
      await look.keep('windows', windowId, 'groups', [
        // The group the add-on made for the tabs the window began with
        { id: 0, name: 'Grp0', rect: rects.Grp0 },
        { id: 3, name: 'Alpha', rect: rects.Alpha },
        { id: 5, name: 'Beta', rect: rects.Beta },
        { id: 8, name: 'Empty', rect: rects.Empty },
      ]);
      await look.keep('windows', windowId, 'activeGroup', 3);
      await look.keep('windows', windowId, 'groupIndex', 9);
      await look.keep('tabs', idOf('a1'), 'groupId', 3);
      await look.keep('tabs', idOf('a2'), 'groupId', 3);
      await look.keep('tabs', idOf('b1'), 'groupId', 5);
      await settle();
    } finally {
      await first.context.close();
    }

    const second = await launch(true);
    try {
      await settle();
      const look = await inspector(second.context, second.extensionId);
      const restored = await look.tabs();
      const idOf = (name: string): number =>
        restored.find(({ url }) => url?.endsWith(`/${name}`))?.id ?? 0;
      const windowId =
        restored.find(({ url }) => url?.endsWith('/a1'))?.windowId ?? 0;

      const groups = (await look.stored('windows'))[String(windowId)];
      expect(groups).toMatchObject({
        groups: [
          { id: 0, name: 'Grp0', rect: rects.Grp0 },
          { id: 3, name: 'Alpha', rect: rects.Alpha },
          { id: 5, name: 'Beta', rect: rects.Beta },
          { id: 8, name: 'Empty', rect: rects.Empty },
          { id: -2 },
        ],
      });
      expect(
        Number(await look.valueOf('windows', windowId, 'groupIndex')),
      ).toBeGreaterThanOrEqual(9);
      const tabs = await look.stored('tabs');
      expect(
        ['a1', 'a2', 'b1'].map((name) => tabs[String(idOf(name))]),
      ).toMatchObject([{ groupId: 3 }, { groupId: 3 }, { groupId: 5 }]);
      // Each group is linked to the native group its tabs are in
      const links = await look.links(windowId);
      expect(Object.keys(links).sort()).toEqual([
        `nativeGroup:${String(windowId)}:0`,
        `nativeGroup:${String(windowId)}:3`,
        `nativeGroup:${String(windowId)}:5`,
      ]);
      expect(await look.nativeGroupOf(idOf('a1'))).toBe(
        links[`nativeGroup:${String(windowId)}:3`],
      );
      expect(await look.nativeGroupOf(idOf('b1'))).toBe(
        links[`nativeGroup:${String(windowId)}:5`],
      );
    } finally {
      await second.context.close();
    }
  });
});
