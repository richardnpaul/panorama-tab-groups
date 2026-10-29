import path from 'node:path';
import { expect, test } from '@playwright/test';
import { type Lab, startLab } from './lab/lab.js';
import { worldOf } from './lab/world.js';

// The extension, as a person gets it, put into a real Firefox that already has windows
// with tabs, which is what first run next to another add-on (or after an update) is.
test.describe('First run over tabs that are already open', () => {
  test.skip(
    ({ browserName }) => browserName !== 'firefox',
    'Native tab groups are tested in the Firefox that Playwright brings',
  );

  let lab: Lab;

  test.beforeEach(async () => {
    lab = await startLab({ probes: ['a'] });
  });

  test.afterEach(async () => {
    await lab.close();
  });

  /** The window the browser opened with three tabs, one opened later (which has the focus) with three, and one with one tab */
  async function threeWindows() {
    const world = worldOf(lab, 'a');
    // The window that has the focus is not the one the first tabs are in: the browser makes a
    // group, if it is not told where, in the window that has the focus
    const [first = 0] = await world.windowIds();
    await world.addTabs(first, ['w1-a', 'w1-b']);
    const second = await world.openWindow(['w2-a', 'w2-b', 'w2-c']);
    const third = await world.openWindow(['w3-a']);
    const before = new Map(
      (await world.tabs()).map(({ id, windowId }) => [id, windowId] as const),
    );
    return { world, first, second, third, before };
  }

  test('leaves native groups off, over windows that have tabs, and keeps every tab in the window it was in', async () => {
    test.setTimeout(90000);
    const { world, first, second, third, before } = await threeWindows();

    await lab.installLogged(path.join(process.cwd(), 'dist-firefox'));
    // The extension sets itself up: it says so when it is done
    await expect
      .poll(() => lab.logs().join('\n'), { timeout: 30000 })
      .toContain('Finished setup');

    expect(await world.groups()).toEqual([]);
    const tabs = await world.tabs();
    expect(
      tabs
        .filter(({ id, windowId }) => before.get(id) !== windowId)
        .map(({ id }) => `tab ${String(id)} left its window`),
    ).toEqual([]);
    expect(await world.windowIds()).toEqual(
      expect.arrayContaining([first, second.windowId, third.windowId]),
    );
    expect(lab.logs().join('\n')).toContain(
      'native tab groups stay off until the user turns them on',
    );
  });

  test('keeps every tab in the window it was in, and makes a native group in each window that has tabs to group, when the user has chosen native groups', async () => {
    test.setTimeout(90000);
    const { world, first, second, third, before } = await threeWindows();

    await lab.installLogged(path.join(process.cwd(), 'dist-firefox'), {
      useNativeGroups: true,
    });

    // The extension sets itself up, and makes a native group in each window
    await expect
      .poll(async () => (await world.groups()).length, { timeout: 30000 })
      .toBe(2);

    const tabs = await world.tabs();
    const groups = await world.groups();
    expect(
      tabs
        .filter(({ id, windowId }) => before.get(id) !== windowId)
        .map(({ id }) => `tab ${String(id)} left its window`),
    ).toEqual([]);
    expect(tabs).toHaveLength(before.size);
    expect(await world.windowIds()).toEqual(
      expect.arrayContaining([first, second.windowId, third.windowId]),
    );

    // Each window with tabs to group has a group of its own, with all of them in it
    const groupOf = (windowId: number) =>
      groups.find((group) => group.windowId === windowId)?.id;
    expect(groups.map(({ windowId }) => windowId).sort()).toEqual(
      [first, second.windowId].sort(),
    );
    [first, second.windowId].forEach((windowId) => {
      expect(
        tabs
          .filter((tab) => tab.windowId === windowId)
          .every(({ groupId }) => groupId === groupOf(windowId)),
      ).toBe(true);
    });
    // and the window with one tab is left as it was: a group of the only tab of a window is not made
    expect(
      tabs
        .filter(({ windowId }) => windowId === third.windowId)
        .map(({ groupId }) => groupId),
    ).toEqual([-1]);
  });
});
