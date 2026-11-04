import { chromium, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// What Chromium does with pinned tabs and native tab groups (docs/plans/data-structures-review.md,
// decision 6), asked of the real browser through a page of the add-on. A page of the add-on is used
// for its `browser.tabs`; the tests make their own tabs in a window of their own.

test.describe('Pinned tabs and native groups, in Chromium', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Asked of the Chromium that Playwright brings',
  );

  test('unpins a tab it groups, whether the group is new or exists; pinning takes a tab out of its group, and unpinning does not put it back', async () => {
    test.setTimeout(60000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-profile-'));
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
    try {
      const [worker] = context.serviceWorkers();
      const found =
        worker ??
        (await context.waitForEvent('serviceworker', { timeout: 15000 }));
      const extensionId = found.url().split('/')[2] ?? '';
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);

      const facts = await page.evaluate(async () => {
        const idOf = ({ id }: { id?: number | undefined }): number => {
          if (id === undefined) throw new Error('The browser gave no id');
          return id;
        };
        const window = await browser.windows.create({ url: 'about:blank' });
        const windowId = idOf(window);
        const make = async (pinned: boolean) =>
          idOf(
            await browser.tabs.create({
              windowId,
              url: 'about:blank',
              pinned,
              active: false,
            }),
          );
        const state = async (id: number) => {
          const tab = await browser.tabs.get(id);
          return { pinned: tab.pinned, groupId: tab.groupId };
        };

        // Grouping a pinned tab into a new group
        const first = await make(true);
        const second = await make(false);
        const group = await browser.tabs.group({
          tabIds: [first, second],
          createProperties: { windowId },
        });
        const groupedNew = await state(first);

        // and into one that exists
        const third = await make(true);
        await browser.tabs.group({ tabIds: [third], groupId: group });
        const groupedExisting = await state(third);

        // Pinning a tab that is in a group, then unpinning it: what the browser says at once, for
        // the add-on's own background goes on to put a pinned tab back in its group (decision 6)
        const afterPin = await browser.tabs.update(second, { pinned: true });
        const pinnedInGroup = {
          pinned: afterPin.pinned,
          groupId: afterPin.groupId,
        };
        const afterUnpin = await browser.tabs.update(second, { pinned: false });
        const unpinned = {
          pinned: afterUnpin.pinned,
          groupId: afterUnpin.groupId,
        };

        return {
          groupId: group,
          groupedNew,
          groupedExisting,
          pinnedInGroup,
          unpinned,
        };
      });

      expect(facts.groupId).toBeGreaterThan(0);
      // Grouping unpins, for a new group and for one that exists
      expect(facts.groupedNew).toEqual({
        pinned: false,
        groupId: facts.groupId,
      });
      expect(facts.groupedExisting).toEqual({
        pinned: false,
        groupId: facts.groupId,
      });
      // Pinning takes the tab out of its group, and unpinning does not put it back
      expect(facts.pinnedInGroup).toEqual({ pinned: true, groupId: -1 });
      expect(facts.unpinned).toEqual({ pinned: false, groupId: -1 });
    } finally {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });

  test('the add-on gives a pinned tab no group, never unpins it by grouping, and leaves it ungrouped when it is unpinned', async () => {
    test.setTimeout(60000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-profile-'));
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
    try {
      const [worker] = context.serviceWorkers();
      const found =
        worker ??
        (await context.waitForEvent('serviceworker', { timeout: 15000 }));
      const extensionId = found.url().split('/')[2] ?? '';
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);

      const result = await page.evaluate(async () => {
        const idOf = ({ id }: { id?: number | undefined }): number => {
          if (id === undefined) throw new Error('The browser gave no id');
          return id;
        };
        const sleep = (ms: number) =>
          new Promise((resolve) => {
            setTimeout(resolve, ms);
          });
        const isTruthy = (value: unknown): boolean => Boolean(value);
        const until = async <T>(
          read: () => Promise<T>,
          attempts = 50,
        ): Promise<T> => {
          const value = await read();
          if (isTruthy(value) || attempts <= 1) return value;
          await sleep(100);
          return until(read, attempts - 1);
        };
        const window = await browser.windows.create({ url: 'about:blank' });
        const windowId = idOf(window);
        const make = async () => {
          const tab = idOf(
            await browser.tabs.create({
              windowId,
              url: 'about:blank',
              active: false,
            }),
          );
          await until(() => browser.sessions.getTabValue(tab, 'groupId'));
          return tab;
        };
        const stored = (tab: number) =>
          browser.sessions.getTabValue(tab, 'groupId');
        const state = async (tab: number) => {
          const each = await browser.tabs.get(tab);
          return { pinned: each.pinned, native: each.groupId };
        };

        const pinned = await make();
        await sleep(1500);
        await browser.tabs.update(pinned, { pinned: true });
        const storedAfterPin = await until(
          async () => (await stored(pinned)) === undefined,
        );
        // Another tab is made, which gives the group a native group again
        await make();
        await sleep(1500);
        const afterGrouping = await state(pinned);
        const storedAfterGrouping = await stored(pinned);

        await browser.tabs.update(pinned, { pinned: false });
        const ungrouped = await until(async () =>
          Object.is(await stored(pinned), -2),
        );
        await sleep(500);
        return {
          storedAfterPin,
          afterGrouping,
          storedAfterGrouping,
          ungrouped,
          afterUnpin: await state(pinned),
        };
      });

      expect(result).toEqual({
        storedAfterPin: true,
        afterGrouping: { pinned: true, native: -1 },
        storedAfterGrouping: undefined,
        ungrouped: true,
        afterUnpin: { pinned: false, native: -1 },
      });
    } finally {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
  test('shows a pinned tab that is made while the view is open among the pinned tabs, though it has no group', async () => {
    test.setTimeout(60000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-profile-'));
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
    try {
      const [worker] = context.serviceWorkers();
      const found =
        worker ??
        (await context.waitForEvent('serviceworker', { timeout: 15000 }));
      const extensionId = found.url().split('/')[2] ?? '';
      const view = await context.newPage();
      await view.goto(`chrome-extension://${extensionId}/view.html`);
      await expect(view.locator('body.view-ready')).toBeVisible({
        timeout: 10000,
      });
      const pinned = view.locator('#pinnedTabs .tab');
      await expect(pinned).toHaveCount(0);

      const tabId = await view.evaluate(async () => {
        const made = await browser.tabs.create({
          url: 'about:blank',
          pinned: true,
          active: false,
        });
        return made.id;
      });

      // Without the page being shown again: the tab arrives as the view is open
      await expect(pinned).toHaveCount(1, { timeout: 10000 });
      await expect(pinned.first()).toHaveAttribute('tabId', String(tabId));
      const stored = await view.evaluate(
        (id) => browser.sessions.getTabValue(id ?? 0, 'groupId'),
        tabId,
      );
      expect(stored).toBeUndefined();
    } finally {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
});
