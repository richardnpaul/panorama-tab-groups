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

      // A window of its own, with one tab: it is given a native group like
      // any other, and the window stays
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
      nativeGroupOfSecond: expect.any(Number),
      groupedTabs: 1,
    });
  });

  test('sending the last tab of the shown group to another group switches the window to that group', async ({
    page,
    context,
  }) => {
    const sent = await page.evaluate(async () => {
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

      // A window of its own with two tabs, one in each of two groups, the
      // first of which is shown
      const created = await browser.windows.create({ url: 'about:blank' });
      const windowId = idOf(created);
      const [lone] = created.tabs ?? [];
      if (lone === undefined) throw new Error('The new window has no tab');
      await until(() => browser.sessions.getTabValue(idOf(lone), 'groupId'));
      await browser.sessions.setWindowValue(windowId, 'groups', [
        group(0, 'Shown'),
        group(1, 'Other'),
        // Every window keeps the group for ungrouped tabs, which is not one of the user's
        { ...group(-2, 'Ungrouped Tabs'), isSystemGroup: true },
      ]);
      await browser.sessions.setWindowValue(windowId, 'activeGroup', 0);
      await browser.sessions.setTabValue(idOf(lone), 'groupId', 0);
      const other = await browser.tabs.create({
        windowId,
        url: 'about:blank',
        active: false,
      });
      await until(() => browser.sessions.getTabValue(idOf(other), 'groupId'));
      await sleep(1500);
      await browser.sessions.setTabValue(idOf(other), 'groupId', 1);

      return { windowId, lone: idOf(lone), other: idOf(other) };
    });

    // The menu of the tab sends it to a group; a click on it is the event the browser would send
    const [worker] = context.serviceWorkers();
    if (worker === undefined) {
      throw new Error('The extension has no service worker');
    }
    await worker.evaluate(({ lone, windowId }) => {
      const read = (value: unknown, key: string): unknown =>
        typeof value === 'object' && value !== null
          ? Reflect.get(value, key)
          : undefined;
      const event = read(
        read(Reflect.get(globalThis, 'chrome'), 'contextMenus'),
        'onClicked',
      );
      const dispatch = read(event, 'dispatch');
      if (typeof dispatch !== 'function') {
        throw new Error('The event of the menu cannot be fired from here');
      }
      Reflect.apply(dispatch, event, [
        { menuItemId: '1' },
        { id: lone, windowId },
      ]);
    }, sent);

    const result = await page.evaluate(async (ids) => {
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
      const switched = await until(async () => {
        const activeGroup: unknown = await browser.sessions.getWindowValue(
          ids.windowId,
          'activeGroup',
        );
        return activeGroup === 1;
      });
      const title = await until(async () => {
        const text = await browser.action.getTitle({});
        return text === 'Active Group: Other' ? text : undefined;
      });
      const sentTabGroup: unknown = await browser.sessions.getTabValue(
        ids.lone,
        'groupId',
      );
      const badge = await browser.action.getBadgeText({});
      const nativeOfSent = (await browser.tabs.get(ids.lone)).groupId;
      const nativeOfOther = (await browser.tabs.get(ids.other)).groupId;
      return {
        switched,
        title,
        badge,
        sentTabGroup,
        nativeOfSent,
        nativeOfOther,
      };
    }, sent);

    expect(result).toMatchObject({
      switched: true,
      title: 'Active Group: Other',
      // The two groups of the user, not the group for ungrouped tabs
      badge: '2',
      sentTabGroup: 1,
    });
    // The tab and the tab that was in the group are in the one native group
    expect(result.nativeOfSent).toBeGreaterThan(0);
    expect(result.nativeOfOther).toBe(result.nativeOfSent);
  });
  test('a tab that arrives in a native group while native groups are off is taken out of it, and keeps its group', async ({
    page,
    context,
  }) => {
    const arranged = await page.evaluate(async () => {
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
      const idOf = ({ id }: { id?: number | undefined }): number => {
        if (id === undefined) throw new Error('The browser gave no id');
        return id;
      };

      await browser.storage.sync.set({ useNativeGroups: false });
      const created = await browser.windows.create({ url: 'about:blank' });
      const windowId = idOf(created);
      const [tab] = created.tabs ?? [];
      if (tab === undefined) throw new Error('The new window has no tab');
      await until(() => browser.sessions.getTabValue(idOf(tab), 'groupId'));
      await browser.sessions.setWindowValue(windowId, 'groups', [
        {
          id: 0,
          name: 'Only',
          containerId: 'browser-default',
          rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
        },
      ]);
      await browser.sessions.setWindowValue(windowId, 'activeGroup', 0);
      await browser.sessions.setTabValue(idOf(tab), 'groupId', 0);
      // As a window comes back from being closed with a native group
      const nativeGroupId = await browser.tabs.group({
        tabIds: [idOf(tab)],
        createProperties: { windowId },
      });
      return { tabId: idOf(tab), windowId, nativeGroupId };
    });
    expect(arranged.nativeGroupId).toBeGreaterThan(0);

    // The browser says the tab was created, in its native group
    const [worker] = context.serviceWorkers();
    if (worker === undefined) {
      throw new Error('The extension has no service worker');
    }
    await worker.evaluate(({ tabId, windowId, nativeGroupId }) => {
      const read = (value: unknown, key: string): unknown =>
        typeof value === 'object' && value !== null
          ? Reflect.get(value, key)
          : undefined;
      const event = read(
        read(Reflect.get(globalThis, 'chrome'), 'tabs'),
        'onCreated',
      );
      const dispatch = read(event, 'dispatch');
      if (typeof dispatch !== 'function') {
        throw new Error('The event of the tabs cannot be fired from here');
      }
      Reflect.apply(dispatch, event, [
        { id: tabId, windowId, groupId: nativeGroupId, active: true },
      ]);
    }, arranged);

    const result = await page.evaluate(async (ids) => {
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
      const left = await until(
        async () => (await browser.tabs.get(ids.tabId)).groupId === -1,
      );
      const group: unknown = await browser.sessions.getTabValue(
        ids.tabId,
        'groupId',
      );
      return { left, group };
    }, arranged);

    expect(result).toEqual({ left: true, group: 0 });
  });
});
