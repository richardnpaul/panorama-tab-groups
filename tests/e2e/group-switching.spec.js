import { test, expect } from '../../playwright.config.js';

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
      const sleep = (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
      // Tries again until the background has caught up
      const until = async (read, attempts = 50) => {
        const value = await read();
        if (value || attempts <= 1) return value;
        await sleep(100);
        return until(read, attempts - 1);
      };
      const group = (id, name) => ({
        id,
        name,
        containerId: 'browser-default',
        rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      });
      const groupsOf = (windowId) =>
        browser.sessions.getWindowValue(windowId, 'groups');
      const nativeIdOf = async (windowId, id) =>
        (await groupsOf(windowId))?.find((g) => g.id === id)?.nativeGroupId;

      const { id: windowId } = await browser.windows.getCurrent();
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
      await until(() => browser.sessions.getTabValue(first.id, 'groupId'));
      await settle();
      const second = await browser.tabs.create({
        url: 'about:blank',
        active: false,
      });
      await until(() => browser.sessions.getTabValue(second.id, 'groupId'));
      await settle();
      await browser.sessions.setTabValue(second.id, 'groupId', 1);
      await settle();

      await browser.tabs.update(first.id, { active: true });
      const firstNative = await until(() => nativeIdOf(windowId, 0));
      await settle();

      // Activating a tab of the second group is what switches to that group
      await browser.tabs.update(second.id, { active: true });
      const secondNative = await until(() => nativeIdOf(windowId, 1));
      const switched = await until(
        async () =>
          (await browser.sessions.getWindowValue(windowId, 'activeGroup')) ===
          1,
      );
      const collapsedFirst = await until(
        async () => (await browser.tabGroups.get(firstNative)).collapsed,
      );
      const secondGroup = await browser.tabGroups.get(secondNative);

      return {
        switched: switched === true,
        collapsedFirst: collapsedFirst === true,
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
      const sleep = (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
      // Tries again until the background has caught up
      const until = async (read, attempts = 50) => {
        const value = await read();
        if (value || attempts <= 1) return value;
        await sleep(100);
        return until(read, attempts - 1);
      };
      const group = (id, name) => ({
        id,
        name,
        containerId: 'browser-default',
        rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      });

      // A window of its own, with one tab: grouping that tab would leave
      // nothing outside the group, so no native group is made for it
      const created = await browser.windows.create({ url: 'about:blank' });
      const windowId = created.id;
      const [lone] = created.tabs;
      await until(() => browser.sessions.getTabValue(lone.id, 'groupId'));
      await browser.sessions.setWindowValue(windowId, 'groups', [
        group(0, 'Lone A'),
        group(1, 'Lone B'),
      ]);
      await browser.sessions.setWindowValue(windowId, 'activeGroup', 0);
      await browser.sessions.setTabValue(lone.id, 'groupId', 1);

      // Closing the tab opened beside it brings the lone tab back into view
      const beside = await browser.tabs.create({
        windowId,
        url: 'about:blank',
        active: true,
      });
      await until(() => browser.sessions.getTabValue(beside.id, 'groupId'));
      await browser.tabs.remove(beside.id);

      const switched = await until(
        async () =>
          (await browser.sessions.getWindowValue(windowId, 'activeGroup')) ===
          1,
      );
      const title = await until(async () => {
        const text = await browser.action.getTitle({});
        return text === 'Active Group: Lone B' ? text : undefined;
      });
      const groups = await browser.sessions.getWindowValue(windowId, 'groups');
      const groupedTabs = (await browser.tabs.query({ windowId })).filter(
        (tab) => tab.groupId !== -1,
      );

      return {
        switched: switched === true,
        title,
        nativeGroupOfSecond: groups.find((g) => g.id === 1)?.nativeGroupId,
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
