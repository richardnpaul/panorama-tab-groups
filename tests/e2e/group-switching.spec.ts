import { test, expect } from './fixtures.js';

// These drive the real background through the browser's own events, using an
// extension page as the bridge to the extension's APIs. Firefox runs extension
// pages behind a mock, so the real background cannot be reached there.
test.describe('Switching groups by activating tabs', () => {
  test.beforeEach(
    async ({ page, extensionId, extensionProtocol, browserName }) => {
      test.skip(
        browserName !== 'chromium',
        'The Firefox proxy mock prevents querying the real extension state',
      );

      await page.goto(`${extensionProtocol}://${extensionId}/options.html`);
      await expect(page.locator('body')).toBeVisible();
    },
  );

  test('activating a tab of another group makes that group the active one and collapses the others', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const sleep = (ms: number) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
      const isTruthy = (value: unknown): boolean => Boolean(value);
      // Tries again until the background has caught up
      const until = async <T>(
        read: () => Promise<T>,
        attempts = 50,
      ): Promise<T> => {
        const value = await read();
        if (isTruthy(value) || attempts <= 1) return value;
        await sleep(100);
        return until(read, attempts - 1);
      };
      const group = (id: number, name: string) => ({
        id,
        name,
        containerId: 'browser-default',
        rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      });
      // The id of a tab or window the browser made, which always has one
      const idOf = ({ id }: { id?: number | undefined }): number => {
        if (id === undefined) throw new Error('The browser gave no id');
        return id;
      };
      // The groups as stored, each as found, whatever it holds
      const storedGroups = async (windowId: number): Promise<unknown[]> => {
        const stored = await browser.sessions.getWindowValue(
          windowId,
          'groups',
        );
        const groups: unknown[] = Array.isArray(stored) ? stored : [];
        return groups;
      };
      const nativeIdOf = async (
        windowId: number,
        id: number,
      ): Promise<number | undefined> => {
        const found = (await storedGroups(windowId)).find(
          (g) =>
            typeof g === 'object' && g !== null && 'id' in g && g.id === id,
        );
        return typeof found === 'object' &&
          found !== null &&
          'nativeGroupId' in found &&
          typeof found.nativeGroupId === 'number'
          ? found.nativeGroupId
          : undefined;
      };
      const windowId = idOf(await browser.windows.getCurrent());
      await browser.sessions.setWindowValue(windowId, 'groups', [
        group(0, 'First'),
        group(1, 'Second'),
      ]);
      await browser.sessions.setWindowValue(windowId, 'activeGroup', 0);

      // The background reads the groups, works, and writes them back, so a
      // write from here in between would be overwritten: each step waits for
      // the background to be done
      const settle = () => sleep(1500);

      // The background puts new tabs in the active group, and gives that group
      // a native group; the second tab is then moved to the second group
      const first = await browser.tabs.create({
        url: 'about:blank',
        active: false,
      });
      await until(() => browser.sessions.getTabValue(idOf(first), 'groupId'));
      await settle();
      const second = await browser.tabs.create({
        url: 'about:blank',
        active: false,
      });
      await until(() => browser.sessions.getTabValue(idOf(second), 'groupId'));
      await settle();
      await browser.sessions.setTabValue(idOf(second), 'groupId', 1);
      await settle();

      await browser.tabs.update(idOf(first), { active: true });
      const firstNative = await until(() => nativeIdOf(windowId, 0));
      if (firstNative === undefined) {
        throw new Error('The first group got no native group');
      }
      await settle();

      // Activating a tab of the second group is what switches to that group
      await browser.tabs.update(idOf(second), { active: true });
      const secondNative = await until(() => nativeIdOf(windowId, 1));
      if (secondNative === undefined) {
        throw new Error('The second group got no native group');
      }
      const switched = await until(async () => {
        const activeGroup: unknown = await browser.sessions.getWindowValue(
          windowId,
          'activeGroup',
        );
        return activeGroup === 1;
      });
      const collapsedFirst = await until(
        async () => (await browser.tabGroups.get(firstNative)).collapsed,
      );
      const secondGroup = await browser.tabGroups.get(secondNative);

      return {
        switched,
        collapsedFirst,
        secondCollapsed: secondGroup.collapsed,
        secondTitle: secondGroup.title,
      };
    });

    expect(result).toEqual({
      switched: true,
      collapsedFirst: true,
      secondCollapsed: false,
      secondTitle: 'Second',
    });
  });

  test('activating the only tab of a window still switches that window to its group', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const sleep = (ms: number) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
      const isTruthy = (value: unknown): boolean => Boolean(value);
      // Tries again until the background has caught up
      const until = async <T>(
        read: () => Promise<T>,
        attempts = 50,
      ): Promise<T> => {
        const value = await read();
        if (isTruthy(value) || attempts <= 1) return value;
        await sleep(100);
        return until(read, attempts - 1);
      };
      const group = (id: number, name: string) => ({
        id,
        name,
        containerId: 'browser-default',
        rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      });
      // The id of a tab or window the browser made, which always has one
      const idOf = ({ id }: { id?: number | undefined }): number => {
        if (id === undefined) throw new Error('The browser gave no id');
        return id;
      };
      // The groups as stored, each as found, whatever it holds
      const storedGroups = async (windowId: number): Promise<unknown[]> => {
        const stored = await browser.sessions.getWindowValue(
          windowId,
          'groups',
        );
        const groups: unknown[] = Array.isArray(stored) ? stored : [];
        return groups;
      };
      const nativeIdOf = async (
        windowId: number,
        id: number,
      ): Promise<number | undefined> => {
        const found = (await storedGroups(windowId)).find(
          (g) =>
            typeof g === 'object' && g !== null && 'id' in g && g.id === id,
        );
        return typeof found === 'object' &&
          found !== null &&
          'nativeGroupId' in found &&
          typeof found.nativeGroupId === 'number'
          ? found.nativeGroupId
          : undefined;
      };

      // A window of its own, with one tab: grouping that tab would leave
      // nothing outside the group, so no native group is made for it
      const created = await browser.windows.create({ url: 'about:blank' });
      const windowId = idOf(created);
      const [lone] = created.tabs ?? [];
      if (lone === undefined) throw new Error('The new window has no tab');
      await until(() => browser.sessions.getTabValue(idOf(lone), 'groupId'));
      await browser.sessions.setWindowValue(windowId, 'groups', [
        group(0, 'Lone A'),
        group(1, 'Lone B'),
      ]);
      await browser.sessions.setWindowValue(windowId, 'activeGroup', 0);
      await browser.sessions.setTabValue(idOf(lone), 'groupId', 1);

      // Closing the tab opened beside it brings the lone tab back into view
      const beside = await browser.tabs.create({
        windowId,
        url: 'about:blank',
        active: true,
      });
      await until(() => browser.sessions.getTabValue(idOf(beside), 'groupId'));
      await browser.tabs.remove(idOf(beside));

      const switched = await until(async () => {
        const activeGroup: unknown = await browser.sessions.getWindowValue(
          windowId,
          'activeGroup',
        );
        return activeGroup === 1;
      });
      const title = await until(async () => {
        const text = await browser.action.getTitle({});
        return text === 'Active Group: Lone B' ? text : undefined;
      });
      const nativeGroupOfSecond = await nativeIdOf(windowId, 1);
      const groupedTabs = (await browser.tabs.query({ windowId })).filter(
        (tab) => tab.groupId !== -1,
      );

      return {
        switched,
        title,
        nativeGroupOfSecond,
        groupedTabs: groupedTabs.length,
      };
    });

    expect(result).toEqual({
      switched: true,
      title: 'Active Group: Lone B',
      nativeGroupOfSecond: undefined,
      groupedTabs: 0,
    });
  });
});
