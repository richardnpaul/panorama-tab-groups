import { describe, expect, it } from 'vitest';
import {
  arrangeGroups,
  nativeGroupsOf,
  referencesOf,
  tabsInGroup,
  tabsThatMoved,
  windowOfEachTab,
} from '../../support/world/scenarios.js';
import { createWorld } from '../../support/world/world.js';

// What a person does with the add-on and the browser's tab groups, one story to a test,
// in a model of the browser that behaves as the real Firefox was seen to
// (tests/support/world, checked by tests/e2e/firefox-facts.spec.ts), running the whole of
// the background of the add-on. Each test ends by looking for a failure the add-on logged.
//
// "Legacy" groups are the add-on's own, which hide the tabs of the groups that are not
// shown; "native" groups are the browser's.
describe('user journeys with native tab groups', () => {
  describe('J1 first run in Firefox 139 or later, one window with a new tab', () => {
    it('makes one group and turns native groups on, as there is nothing to move', async () => {
      const world = createWorld();
      const { windowId, tabIds } = world.seedWindow(['about:newtab']);

      await world.start();

      expect((await world.options.load()).useNativeGroups).toBe(true);
      expect(world.options.stored.useNativeGroups).toBe(true);
      expect(
        (await world.groupsOf(windowId)).filter(({ id }) => id >= 0),
      ).toMatchObject([{ id: 0, name: 'Grp0' }]);
      expect(await world.groupState.getTabGroup(tabIds[0] ?? 0)).toBe(0);
      // The only tab of a window is not put in a native group
      expect(world.model.groups.size).toBe(0);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J2 first run in Firefox 139 or later, windows with many tabs and no groups known', () => {
    it('makes one group of the tabs of each window, and leaves native groups off, which the user can turn on', async () => {
      const world = createWorld();
      const first = world.seedWindow(['a', 'b', 'c']);
      const second = world.seedWindow(['d', 'e']);
      const before = await windowOfEachTab(world);

      await world.start();

      expect(world.options.stored.useNativeGroups).toBe(false);
      const windows = await world.windows();
      expect(windows.map(({ id }) => id)).toEqual([
        first.windowId,
        second.windowId,
      ]);
      windows.forEach((window) => {
        expect(tabsInGroup(window, 0)).toHaveLength(window.tabs.length);
      });
      expect(world.model.groups.size).toBe(0);
      expect(await tabsThatMoved(world, before)).toEqual([]);
      expect(world.logs.error).toEqual([]);
    });

    it('does not turn native groups on at the next start, though the tabs are as they were', async () => {
      const world = createWorld();
      world.seedWindow(['a', 'b', 'c']);
      await world.start();

      await world.restart();

      expect(world.options.stored.useNativeGroups).toBe(false);
      expect(world.model.groups.size).toBe(0);
    });
  });

  describe('J3 an update from an earlier version of the add-on, with groups stored', () => {
    it('keeps the groups and leaves native groups off, for there are groups to move', async () => {
      const world = createWorld();
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);

      await world.start();

      expect(world.options.stored.useNativeGroups).toBe(false);
      expect(
        (await world.groupsOf(windowId))
          .filter(({ id }) => id >= 0)
          .map(({ id, name }) => [id, name]),
      ).toEqual([
        [1, 'G1'],
        [2, 'G2'],
      ]);
      expect(
        await Promise.all(tabIds.map((id) => world.groupState.getTabGroup(id))),
      ).toEqual([1, 1, 2, 2]);
      // Native groups were made for the active group before this was seen to
      expect(world.model.groups.size).toBe(0);
      expect(world.logs.error).toEqual([]);
    });

    it('keeps what the user chose', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);

      await world.start();

      expect(world.options.stored.useNativeGroups).toBe(true);
      expect(world.model.groups.size).toBe(1);
    });
  });

  describe('J4 first run next to another add-on that has groups the add-on cannot read', () => {
    // What this add-on sees is windows full of tabs and no groups of its own: as in J2
    it('is J2: native groups stay off, and nothing is lost', async () => {
      const world = createWorld();
      world.seedWindow(['a', 'b', 'c', 'd']);
      const before = await windowOfEachTab(world);

      await world.start();

      expect(world.options.stored.useNativeGroups).toBe(false);
      expect(await tabsThatMoved(world, before)).toEqual([]);
    });

    it.todo(
      'offers to import the groups of the other add-on from its export, on the migration status page (Decision 4 of the plan)',
    );
  });

  describe('J5 switching native groups on, with three groups and tabs in each', () => {
    async function threeGroups() {
      const world = createWorld({ stored: { useNativeGroups: false } });
      const { windowId, tabIds } = world.seedWindow([
        'a',
        'b',
        'c',
        'd',
        'e',
        'f',
      ]);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2, 3, 3], 2);
      await world.start();
      return { world, windowId, tabIds };
    }

    it('makes no native group while native groups are off', async () => {
      const { world } = await threeGroups();

      expect(world.model.groups.size).toBe(0);
    });

    it('makes a native group for the group that is shown, named like it, with its tabs and no other; the tabs stay in their window', async () => {
      const { world, windowId, tabIds } = await threeGroups();
      const before = await windowOfEachTab(world);

      await world.setNativeGroups(true);

      const [window] = await world.windows();
      const [native] = [...world.model.groups.values()];
      expect(world.model.groups.size).toBe(1);
      expect(native).toMatchObject({ title: 'G2', windowId });
      expect(
        nativeGroupsOf(tabsInGroup(window ?? { id: 0, tabs: [] }, 2)),
      ).toEqual([native?.id]);
      expect(
        window?.tabs
          .filter((tab) => tab.nativeGroupId !== -1)
          .map(({ id }) => id),
      ).toEqual([tabIds[2], tabIds[3]]);
      expect(await referencesOf(world, windowId)).toEqual([
        undefined,
        native?.id,
        undefined,
      ]);
      expect(await tabsThatMoved(world, before)).toEqual([]);
      expect(world.logs.error).toEqual([]);
    });

    it('does nothing more when it is asked again', async () => {
      const { world } = await threeGroups();
      await world.setNativeGroups(true);
      const [first] = [...world.model.groups.keys()];

      await world.message({ action: 'migrateToHybridGroups' });

      expect([...world.model.groups.keys()]).toEqual([first]);
    });

    // The groups that are not shown have their tabs hidden, and Firefox does let hidden
    // tabs be in a tab group and the group be collapsed (firefox-facts.spec.ts), so a group
    // for each is possible. Whether it is wanted is for the owner to say, having looked at
    // how Firefox shows such a group; today the others get theirs when they are shown.
    it.todo(
      'makes a native group for every group at once, collapsed where it is not shown (Decision 3 of the plan)',
    );
  });

  describe('J6 switching native groups off', () => {
    async function withNativeGroups() {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);
      await world.start();
      return { world, windowId, tabIds };
    }

    it('takes the tabs out of the native groups and forgets them, and the groups of the add-on are as they were', async () => {
      const { world, windowId, tabIds } = await withNativeGroups();
      expect(world.model.groups.size).toBe(1);

      await world.setNativeGroups(false);

      expect(world.model.groups.size).toBe(0);
      expect(await referencesOf(world, windowId)).toEqual([
        undefined,
        undefined,
      ]);
      expect(
        await Promise.all(tabIds.map((id) => world.groupState.getTabGroup(id))),
      ).toEqual([1, 1, 2, 2]);
      expect(world.logs.error).toEqual([]);
    });

    it('stays off when the browser is started again', async () => {
      const { world } = await withNativeGroups();
      await world.setNativeGroups(false);

      await world.restart();

      expect(world.model.groups.size).toBe(0);
    });

    it('makes the native groups again, afresh, when it is switched on again', async () => {
      const { world, windowId } = await withNativeGroups();
      await world.setNativeGroups(false);

      await world.setNativeGroups(true);

      const [native] = [...world.model.groups.values()];
      expect(world.model.groups.size).toBe(1);
      expect(await referencesOf(world, windowId)).toEqual([
        native?.id,
        undefined,
      ]);
    });
  });

  describe('J7 several windows, native groups on', () => {
    it('gives each window native groups of its own, and no tab goes to another window', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const first = world.seedWindow(['a1', 'a2', 'a3']);
      const second = world.seedWindow(['b1', 'b2', 'b3']);
      await arrangeGroups(world, first.windowId, first.tabIds, [1, 1, 2], 1);
      await arrangeGroups(world, second.windowId, second.tabIds, [1, 2, 2], 2);
      const before = await windowOfEachTab(world);

      // The window that was opened last has the focus, and the first is not it
      await world.start();

      expect(world.model.groups.size).toBe(2);
      const groups = [...world.model.groups.values()];
      expect(groups.map(({ windowId }) => windowId).sort()).toEqual(
        [first.windowId, second.windowId].sort(),
      );
      expect(await tabsThatMoved(world, before)).toEqual([]);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J8 the browser is started again, with native groups', () => {
    async function withNativeGroup() {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2], 1);
      await world.start();
      return { world };
    }

    // The ids of windows, tabs and groups are new; that Firefox gives a group a new id is not
    // known (it could not be asked), and Chromium does, so the harder case is taken
    it('links the group to the native group the browser has made of its tabs, and makes no second one', async () => {
      const { world } = await withNativeGroup();

      await world.restart();

      const [window] = await world.windows();
      const [native] = [...world.model.groups.values()];
      expect(world.model.groups.size).toBe(1);
      expect(await referencesOf(world, window?.id ?? 0)).toEqual([
        native?.id,
        undefined,
      ]);
      expect(world.logs.error).toEqual([]);
    });

    it('does the same each time the browser is started', async () => {
      const { world } = await withNativeGroup();

      await world.restart();
      await world.restart();

      const [window] = await world.windows();
      const [native] = [...world.model.groups.values()];
      expect(world.model.groups.size).toBe(1);
      expect(await referencesOf(world, window?.id ?? 0)).toEqual([
        native?.id,
        undefined,
      ]);
    });
  });

  describe('J9 a closed window is restored', () => {
    it('brings back its groups with their tabs, and makes no group twice', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      world.seedWindow(['keep']);
      const closing = world.seedWindow(['a1', 'a2', 'a3']);
      await arrangeGroups(
        world,
        closing.windowId,
        closing.tabIds,
        [1, 1, 2],
        1,
      );
      await world.start();
      await world.closeWindow(closing.windowId);

      const restored = await world.restoreWindow();

      const window = (await world.windows()).find(
        ({ id }) => id === restored?.windowId,
      );
      expect(window).toBeDefined();
      expect(
        (await world.groupsOf(restored?.windowId ?? 0))
          .filter(({ id }) => id >= 0)
          .map(({ id }) => id),
      ).toEqual([1, 2]);
      expect(
        await world.groupState.getActiveGroup(restored?.windowId ?? 0),
      ).toBe(1);
      // The tabs of each group are in one native group, or none, and those of two groups never in the same
      const first = nativeGroupsOf(
        tabsInGroup(window ?? { id: 0, tabs: [] }, 1),
      );
      const second = nativeGroupsOf(
        tabsInGroup(window ?? { id: 0, tabs: [] }, 2),
      );
      expect(first).toHaveLength(1);
      expect(second.filter((id) => first.includes(id))).toEqual([]);
      // and what each group refers to is what its tabs are in
      const references = await referencesOf(world, restored?.windowId ?? 0);
      expect(references[0]).toBe(first[0]);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J10 the user takes a native group apart', () => {
    it('keeps the group of the add-on, forgets the reference, and the tabs stay where they are', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2], 1);
      await world.start();
      const [native] = [...world.model.groups.keys()];

      await world.ungroupGroup(native ?? 0);

      expect(world.model.groups.size).toBe(0);
      expect(await referencesOf(world, windowId)).toEqual([
        undefined,
        undefined,
      ]);
      expect(
        await Promise.all(tabIds.map((id) => world.groupState.getTabGroup(id))),
      ).toEqual([1, 1, 2]);
      expect(world.model.tabsOf(windowId)).toHaveLength(3);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J11 a tab is sent to another group from its menu', () => {
    async function twoGroups() {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);
      await world.start();
      return { world, windowId, tabIds };
    }

    it('puts it in the native group of the group that is shown', async () => {
      const { world, windowId, tabIds } = await twoGroups();
      const [native] = [...world.model.groups.keys()];

      await world.sendTabToGroup(tabIds[3] ?? 0, 1);

      expect(world.model.tabs.get(tabIds[3] ?? 0)?.groupId).toBe(native);
      expect(await world.groupState.getTabGroup(tabIds[3] ?? 0)).toBe(1);
      expect(world.model.tabsOf(windowId)).toHaveLength(4);
      expect(world.logs.error).toEqual([]);
    });

    it('takes it out of the native group of the group it left, where the group it goes to has none, for it is hidden', async () => {
      const { world, tabIds } = await twoGroups();

      await world.sendTabToGroup(tabIds[0] ?? 0, 2);

      const tab = world.model.tabs.get(tabIds[0] ?? 0);
      expect(await world.groupState.getTabGroup(tabIds[0] ?? 0)).toBe(2);
      expect(tab?.groupId).toBe(-1);
      expect(tab?.hidden).toBe(true);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J12 a group is deleted', () => {
    it('closes its tabs and removes its native group, and the other group stays', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);
      await world.start();
      const [deletedGroupsNative] = [...world.model.groups.keys()];

      const answer = await world.deleteGroup(windowId, 1);

      expect(answer).toEqual({ success: true });
      expect(world.model.groups.has(deletedGroupsNative ?? 0)).toBe(false);
      // The group that is shown now has a native group, as one that is shown does
      expect(
        [...world.model.groups.values()].map(({ windowId: where }) => where),
      ).toEqual([windowId]);
      expect(world.model.tabsOf(windowId).map(({ id }) => id)).toEqual([
        tabIds[2],
        tabIds[3],
      ]);
      expect(
        (await world.groupsOf(windowId))
          .filter(({ id }) => id >= 0)
          .map(({ id }) => id),
      ).toEqual([2]);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J13 in Chromium, which has native groups and cannot hide tabs', () => {
    it('uses native groups, with no choice to make or to be asked, and hides nothing', async () => {
      const world = createWorld({ hasTabHide: false });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);

      await world.start();

      expect(world.options.stored).toEqual({});
      expect((await world.options.load()).useNativeGroups).toBe(true);
      expect(world.model.groups.size).toBe(1);
      expect(world.model.tabsOf(windowId).some(({ hidden }) => hidden)).toBe(
        false,
      );
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J14 in a Firefox older than 139, which has no native groups', () => {
    it('uses the groups of the add-on alone, and never touches native groups', async () => {
      const world = createWorld({ hasTabGroups: false });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);

      await world.start();

      expect(world.model.groups.size).toBe(0);
      expect((await world.options.load()).useNativeGroups).toBe(false);
      expect(world.options.stored).toEqual({});
      expect(world.model.tabsOf(windowId)).toHaveLength(4);
      expect(world.logs.error).toEqual([]);
    });

    it('does no harm when it is asked to migrate, though the options page does not offer it', async () => {
      const world = createWorld({ hasTabGroups: false });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);
      await world.start();

      await world.message({ action: 'migrateToHybridGroups' });

      expect(world.model.groups.size).toBe(0);
      expect(world.model.tabsOf(windowId)).toHaveLength(4);
      expect(
        await Promise.all(tabIds.map((id) => world.groupState.getTabGroup(id))),
      ).toEqual([1, 1, 2, 2]);
      // The browser has no native groups to be asked for, and the add-on says what failed
      expect(world.logs.warn.join(' ')).toContain(
        'browser.tabs.group is undefined',
      );
    });
  });

  describe('J15 a window whose only tab is in a group', () => {
    it('is not given a native group, which the browser might close the window over, and the window stays', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['solo']);
      await arrangeGroups(world, windowId, tabIds, [1], 1);

      await world.start();

      expect(world.model.groups.size).toBe(0);
      expect(world.model.windows.has(windowId)).toBe(true);
      expect(world.model.tabsOf(windowId)).toHaveLength(1);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J16 a tab in another window than the one in front becomes the one in front of its window', () => {
    // The browser says which window an event is about; the window the user is in may be another, and a
    // group id means a group only in its own window, where every window has a group 1 and a group 2
    it('shows the group of that tab in its window, and leaves the tabs of the window the user is in as they are', async () => {
      const world = createWorld({ stored: { useNativeGroups: false } });
      const other = world.seedWindow(['a1', 'a2', 'a3']);
      const mine = world.seedWindow(['b1', 'b2', 'b3']);
      await arrangeGroups(world, other.windowId, other.tabIds, [1, 2, 1], 1);
      await arrangeGroups(world, mine.windowId, mine.tabIds, [1, 2, 1], 1);
      await world.start();
      // The user is in the second window
      expect(world.model.focused()).toBe(mine.windowId);
      const hiddenBefore = world.model
        .tabsOf(mine.windowId)
        .map(({ hidden }) => hidden);

      // A tab of group 2 comes to the front of the first window, which has not the focus
      await world.activateTab(other.tabIds[1] ?? 0);

      expect(await world.groupState.getActiveGroup(other.windowId)).toBe(2);
      expect(
        world.model.tabsOf(other.windowId).map(({ hidden }) => hidden),
      ).toEqual([true, false, true]);
      expect(
        world.model.tabsOf(mine.windowId).map(({ hidden }) => hidden),
      ).toEqual(hiddenBefore);
      expect(await world.groupState.getActiveGroup(mine.windowId)).toBe(1);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('in every journey', () => {
    it('no tab goes to another window when a window other than the first has the focus and has tabs to group', async () => {
      // The report: the browser makes a group in the window that has the focus and moves the tabs there
      const world = createWorld({ stored: { useNativeGroups: true } });
      const first = world.seedWindow(['a1', 'a2', 'a3', 'a4']);
      world.seedWindow(['b1', 'b2']);
      await arrangeGroups(world, first.windowId, first.tabIds, [1, 1, 2, 2], 1);
      const before = await windowOfEachTab(world);

      await world.start();

      expect(await tabsThatMoved(world, before)).toEqual([]);
      expect(world.model.windows.has(first.windowId)).toBe(true);
    });
  });
});
