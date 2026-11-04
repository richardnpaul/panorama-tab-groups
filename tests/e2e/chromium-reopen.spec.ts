import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { type Page, chromium, expect, test } from '@playwright/test';

// A tab that is reopened in a real Chromium (docs/plans/data-structures-review.md, decision 2): the
// browser gives it a new id and puts it back in its native group, and the add-on has to find the group
// it had for it. (A window that is reopened cannot be asked of Playwright's Chromium: `sessions.restore`
// of a window session answers "No active tab" from a page and from the background; that is manual test M6.)

test.describe('Tabs and windows that are reopened, in Chromium', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Asked of the Chromium that Playwright brings',
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

  const settle = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 2500);
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
    const [worker] = context.serviceWorkers();
    const found =
      worker ??
      (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    const extensionId = found.url().split('/')[2] ?? '';
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    return { context, page };
  }

  /** The stored group of each tab with an address under the port, by the end of the address */
  const storedGroups = (page: Page, names: string[]) =>
    page.evaluate(
      async ({ names: ends }) => {
        const tabs = await browser.tabs.query({});
        return Promise.all(
          ends.map(async (end) => {
            const tab = tabs.find(({ url }) => url?.endsWith(`/${end}`));
            const stored =
              tab?.id === undefined
                ? undefined
                : await browser.sessions.getTabValue(tab.id, 'groupId');
            return { end, native: tab?.groupId, stored };
          }),
        );
      },
      { names },
    );

  test('a tab that is reopened is in the group of the native group the browser puts it back in, and that group’s tabs are not moved', async () => {
    test.setTimeout(90000);
    const { context, page } = await launch();
    try {
      const base = `http://127.0.0.1:${String(port)}`;
      const made = await page.evaluate(async (url) => {
        const idOf = ({ id }: { id?: number | undefined }): number => {
          if (id === undefined) throw new Error('The browser gave no id');
          return id;
        };
        const created = await browser.windows.create({ url: `${url}/a1` });
        const windowId = idOf(created);
        const a2 = idOf(
          await browser.tabs.create({ windowId, url: `${url}/a2` }),
        );
        const a1 = idOf((created.tabs ?? [])[0] ?? {});
        return { windowId, a1, a2 };
      }, base);
      await settle();
      await page.evaluate(async (ids) => {
        const alpha = await browser.tabs.group({
          tabIds: [ids.a1, ids.a2],
          createProperties: { windowId: ids.windowId },
        });
        await browser.tabGroups.update(alpha, { title: 'Alpha' });
        await browser.sessions.setWindowValue(ids.windowId, 'groups', [
          { id: 3, name: 'Alpha', rect: { x: 0, y: 0, w: 0.3, h: 0.3 } },
          { id: 4, name: 'Other', rect: { x: 0.5, y: 0, w: 0.3, h: 0.3 } },
        ]);
        await browser.sessions.setWindowValue(ids.windowId, 'activeGroup', 4);
        await browser.sessions.setTabValue(ids.a1, 'groupId', 3);
        await browser.sessions.setTabValue(ids.a2, 'groupId', 3);
      }, made);
      await settle();
      const before = await storedGroups(page, ['a1', 'a2']);

      await page.evaluate(async (id) => {
        await browser.tabs.remove(id);
      }, made.a2);
      await settle();
      // "Reopen closed tab"
      await page.evaluate(async () => {
        await browser.sessions.restore();
      });
      await settle();

      const after = await storedGroups(page, ['a1', 'a2']);
      // Whichever way Chromium puts it back, the group the add-on has for the tab is the one of the
      // native group it is in, and the tab that stayed is where it was
      expect(after[0]).toEqual(before[0]);
      expect(after[1]?.native).toBe(after[0]?.native);
      expect(after[1]?.stored).toBe(3);
    } finally {
      await context.close();
    }
  });
});
