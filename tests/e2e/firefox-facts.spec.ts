import { expect, test } from '@playwright/test';
import { type Lab, startLab } from './lab/lab.js';
import { numberFrom, worldOf } from './lab/world.js';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The session of the window that was closed last, from what `sessions.getRecentlyClosed` gave */
function closedWindowSession(recent: unknown): string | undefined {
  const sessions = Array.isArray(recent)
    ? recent.flatMap((item: unknown) =>
        isObject(item) &&
        isObject(item.window) &&
        typeof item.window.sessionId === 'string'
          ? [item.window.sessionId]
          : [],
      )
    : [];
  return sessions[0];
}

// What the real Firefox does with tabs and tab groups, asked of it by a probe extension.
// The fake browser of the unit tests (the memory ports) is built on these facts, and these
// tests are how it is kept true: when Firefox changes, one of them fails.
test.describe('What Firefox does with tab groups', () => {
  test.skip(
    ({ browserName }) => browserName !== 'firefox',
    'Native tab groups are tested in the Firefox that Playwright brings',
  );

  let lab: Lab;

  test.beforeEach(async () => {
    lab = await startLab({ probes: ['a', 'b'] });
  });

  test.afterEach(async () => {
    await lab.close();
  });

  /** A window of the browser, with tabs of these names, each in its own window as the browser opens them */
  async function withTabs(names: readonly string[]) {
    const world = worldOf(lab, 'a');
    const [windowId = 0] = await world.windowIds();
    await world.addTabs(windowId, names);
    // A tab has its title once its page has loaded
    await expect
      .poll(
        async () =>
          (await world.tabs()).filter((tab) => names.includes(tab.title))
            .length,
      )
      .toBe(names.length);
    const tabs = (await world.tabs())
      .filter((tab) => tab.windowId === windowId && names.includes(tab.title))
      .sort((first, second) => first.index - second.index);
    return { world, windowId, tabIds: tabs.map(({ id }) => id) };
  }

  test('has native tab groups', async () => {
    const a = lab.probe('a');

    expect(await a.call('tabGroups.query', {})).toEqual([]);
    const { world, tabIds } = await withTabs(['one', 'two']);

    const id = numberFrom(await a.call('tabs.group', { tabIds }), 'tabs.group');

    expect((await world.groups()).map((group) => group.id)).toEqual([id]);
    expect(
      (await world.tabs()).filter((tab) => tab.groupId === id),
    ).toHaveLength(2);
  });

  test('gives a tab group an id that is large, so no code may take it for a small number', async () => {
    const a = lab.probe('a');
    const { tabIds } = await withTabs(['one']);

    const id = numberFrom(await a.call('tabs.group', { tabIds }), 'tabs.group');

    // A moment of time in microseconds, as of this writing
    expect(id).toBeGreaterThan(2 ** 32);
    expect(Number.isSafeInteger(id)).toBe(true);
  });

  test('puts a hidden tab in a tab group, and the tab stays hidden', async () => {
    const a = lab.probe('a');
    const { world, tabIds } = await withTabs(['one', 'two']);
    const [hidden = 0, shown = 0] = tabIds;
    await a.call('tabs.hide', [hidden]);

    const id = numberFrom(
      await a.call('tabs.group', { tabIds: [hidden, shown] }),
      'tabs.group',
    );

    const tabs = await world.tabs();
    expect(tabs.find((tab) => tab.id === hidden)).toMatchObject({
      groupId: id,
      hidden: true,
    });
    expect(tabs.find((tab) => tab.id === shown)).toMatchObject({
      groupId: id,
      hidden: false,
    });
  });

  test('collapses a tab group that has a hidden tab in it', async () => {
    const a = lab.probe('a');
    const { world, tabIds } = await withTabs(['one', 'two']);
    const [hidden = 0] = tabIds;
    await a.call('tabs.hide', [hidden]);
    const id = numberFrom(await a.call('tabs.group', { tabIds }), 'tabs.group');

    await a.call('tabGroups.update', id, { collapsed: true, title: 'Work' });

    expect(await world.groups()).toMatchObject([
      { id, collapsed: true, title: 'Work' },
    ]);
  });

  test('keeps the values of a session for the extension that set them: another extension does not see them', async () => {
    const a = lab.probe('a');
    const b = lab.probe('b');
    const { windowId, tabIds } = await withTabs(['one']);
    const [tabId = 0] = tabIds;

    await a.call('sessions.setTabValue', tabId, 'groupId', 3);
    await a.call('sessions.setWindowValue', windowId, 'groups', [{ id: 3 }]);

    expect(await a.call('sessions.getTabValue', tabId, 'groupId')).toBe(3);
    expect(
      await b.call('sessions.getTabValue', tabId, 'groupId'),
    ).toBeUndefined();
    expect(await a.call('sessions.getWindowValue', windowId, 'groups')).toEqual(
      [{ id: 3 }],
    );
    expect(
      await b.call('sessions.getWindowValue', windowId, 'groups'),
    ).toBeUndefined();
  });

  test.describe('where a tab group is made', () => {
    /** Two windows, with two tabs in the first; the second was opened last and has the focus */
    async function twoWindows() {
      const { world, windowId, tabIds } = await withTabs(['a', 'b']);
      const other = await world.openWindow(['c']);
      return { world, windowId, tabIds, other };
    }

    test('is the window that has the focus when the window is not said, and the tabs are moved there', async () => {
      const a = lab.probe('a');
      const { world, tabIds, other } = await twoWindows();

      await a.call('tabs.group', { tabIds });

      const moved = (await world.tabs()).filter((tab) =>
        tabIds.includes(tab.id),
      );
      expect(moved.map((tab) => tab.windowId)).toEqual([
        other.windowId,
        other.windowId,
      ]);
    });

    test('is the window that is said, and the tabs stay where they were', async () => {
      const a = lab.probe('a');
      const { world, windowId, tabIds } = await twoWindows();

      const id = numberFrom(
        await a.call('tabs.group', { tabIds, createProperties: { windowId } }),
        'tabs.group',
      );

      const tabs = (await world.tabs()).filter((tab) =>
        tabIds.includes(tab.id),
      );
      expect(tabs.map((tab) => [tab.windowId, tab.groupId])).toEqual([
        [windowId, id],
        [windowId, id],
      ]);
      expect((await world.groups()).map((group) => group.windowId)).toEqual([
        windowId,
      ]);
    });
  });

  test('removes a tab group when its last tab is taken out of it, and when that tab is closed', async () => {
    const a = lab.probe('a');
    const { world, windowId, tabIds } = await withTabs(['one', 'two', 'three']);
    const [one = 0, two = 0, three = 0] = tabIds;
    const first = numberFrom(
      await a.call('tabs.group', {
        tabIds: [one, two],
        createProperties: { windowId },
      }),
      'tabs.group',
    );

    await a.call('tabs.ungroup', [one]);
    expect((await world.groups()).map((group) => group.id)).toEqual([first]);
    await a.call('tabs.ungroup', [two]);
    expect(await world.groups()).toEqual([]);

    const second = numberFrom(
      await a.call('tabs.group', {
        tabIds: [three],
        createProperties: { windowId },
      }),
      'tabs.group',
    );
    await a.call('tabs.remove', three);

    expect(await world.groups()).toEqual([]);
    // and the group is not there to be asked about
    await expect(a.call('tabGroups.get', second)).rejects.toThrow(
      'No group with id',
    );
  });

  test('takes no harm from being asked to take a tab out of a group it is not in', async () => {
    const a = lab.probe('a');
    const { world, tabIds } = await withTabs(['one']);
    const [one = 0] = tabIds;

    await a.call('tabs.ungroup', [one]);

    expect((await world.tabs()).find((tab) => tab.id === one)?.groupId).toBe(
      -1,
    );
    expect(await world.groups()).toEqual([]);
  });

  test('takes a tab out of its group when the tab moves to another window, and the group stays with the others', async () => {
    const a = lab.probe('a');
    const { world, windowId, tabIds } = await withTabs(['one', 'two', 'three']);
    const [one = 0, two = 0] = tabIds;
    const other = await world.openWindow(['elsewhere']);
    const group = numberFrom(
      await a.call('tabs.group', {
        tabIds: [one, two],
        createProperties: { windowId },
      }),
      'tabs.group',
    );

    await a.call('tabs.move', one, { windowId: other.windowId, index: -1 });

    const tabs = await world.tabs();
    expect(tabs.find((tab) => tab.id === one)).toMatchObject({
      windowId: other.windowId,
      groupId: -1,
    });
    expect(tabs.find((tab) => tab.id === two)?.groupId).toBe(group);
    expect((await world.groups()).map((each) => each.id)).toEqual([group]);
  });

  test('does not hide the active tab', async () => {
    const a = lab.probe('a');
    const { world, windowId, tabIds } = await withTabs(['one']);
    const [one = 0] = tabIds;
    const active = (await world.tabs()).find(
      (tab) => tab.windowId === windowId && tab.id !== one,
    );

    // The tab the browser has in front is the one it opened with the window
    expect(await a.call('tabs.hide', [active?.id])).toEqual([]);
    expect(await a.call('tabs.hide', [one])).toEqual([one]);
  });

  // The same id for the group is within the session; whether a restart keeps it could not be asked of
  // the Firefox that Playwright brings, which does not restore the session it had, so the model of
  // the unit tests takes the harder case: a group has a new id after a restart.
  test('restores a closed window with new ids for it and its tabs, and its tab group with the same id and name, and the values the extension kept', async () => {
    const a = lab.probe('a');
    const world = worldOf(lab, 'a');
    const closed = await world.openWindow(['r1', 'r2', 'r3']);
    await expect
      .poll(
        async () =>
          (await world.tabs()).filter((tab) => tab.title.startsWith('r'))
            .length,
      )
      .toBe(3);
    const [one = 0, two = 0, three = 0] = closed.tabIds;
    const group = numberFrom(
      await a.call('tabs.group', {
        tabIds: [one, two],
        createProperties: { windowId: closed.windowId },
      }),
      'tabs.group',
    );
    await a.call('tabGroups.update', group, { title: 'Work', color: 'blue' });
    await a.call('sessions.setTabValue', one, 'groupId', 7);
    await a.call('sessions.setTabValue', three, 'groupId', 8);
    await a.call('sessions.setWindowValue', closed.windowId, 'groups', [
      { id: 7 },
    ]);

    await a.call('windows.remove', closed.windowId);
    const recent = await a.call('sessions.getRecentlyClosed', {
      maxResults: 5,
    });
    const sessionId = closedWindowSession(recent);
    expect(sessionId).toBeDefined();
    await a.call('sessions.restore', sessionId);

    // A window and tabs that are new, with the group they were in, and what the extension kept with them
    await expect.poll(async () => (await world.groups()).length).toBe(1);
    const [restoredGroup] = await world.groups();
    expect(restoredGroup).toMatchObject({ title: 'Work' });
    expect(restoredGroup?.id).toBe(group);
    expect(restoredGroup?.windowId).not.toBe(closed.windowId);
    const restored = (await world.tabs()).filter(
      (tab) => tab.windowId === restoredGroup?.windowId,
    );
    expect(restored.map((tab) => tab.title)).toEqual(['r1', 'r2', 'r3']);
    expect(restored.map((tab) => tab.groupId === restoredGroup?.id)).toEqual([
      true,
      true,
      false,
    ]);
    expect(restored.map((tab) => closed.tabIds.includes(tab.id))).toEqual([
      false,
      false,
      false,
    ]);
    const values = await Promise.all(
      restored.map((tab) => a.call('sessions.getTabValue', tab.id, 'groupId')),
    );
    expect(values).toEqual([7, undefined, 8]);
    expect(
      await a.call(
        'sessions.getWindowValue',
        restoredGroup?.windowId,
        'groups',
      ),
    ).toEqual([{ id: 7 }]);
  });

  test('says the window that has the focus is the current one, to code that runs in no window; and a tab can be made the one in front of its window without giving the window the focus', async () => {
    const a = lab.probe('a');
    const world = worldOf(lab, 'a');
    const [first = 0] = await world.windowIds();
    const second = await world.openWindow(['u', 'v']);
    const idOf = async (call: string) => {
      const window = await a.call(call, {});
      return typeof window === 'object' && window !== null && 'id' in window
        ? window.id
        : undefined;
    };

    expect(await idOf('windows.getCurrent')).toBe(second.windowId);
    await a.call('windows.update', first, { focused: true });
    await expect.poll(() => idOf('windows.getCurrent')).toBe(first);

    // A tab of the other window is made the one in front there; that window is not the current one
    const [, behind = 0] = second.tabIds;
    await a.call('tabs.update', behind, { active: true });
    const tabs = await world.tabs();
    expect(tabs.find((tab) => tab.id === behind)).toBeDefined();
    const active: unknown = await a.call('tabs.query', {
      windowId: second.windowId,
      active: true,
    });
    expect(active).toMatchObject([{ id: behind }]);
    expect(await idOf('windows.getCurrent')).toBe(first);
  });

  test('makes a tab group of the only tab of a window, and the window stays', async () => {
    const a = lab.probe('a');
    const world = worldOf(lab, 'a');
    const solo = await world.openWindow(['solo']);

    await a.call('tabs.group', {
      tabIds: solo.tabIds,
      createProperties: { windowId: solo.windowId },
    });

    expect(await world.windowIds()).toContain(solo.windowId);
    expect(
      (await world.tabs()).filter((tab) => tab.windowId === solo.windowId),
    ).toHaveLength(1);
    expect((await world.groups()).map((group) => group.windowId)).toEqual([
      solo.windowId,
    ]);
  });
});
