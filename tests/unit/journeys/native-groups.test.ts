import { describe, expect, it } from 'vitest';
import {
  arrangeGroups,
  nativeGroupsOf,
  referencesOf,
  tabsInGroup,
  tabsThatMoved,
  windowOfEachTab,
} from '../../support/world/scenarios.js';
import { DATA_VERSION } from '../../../src/js/app/migrations.js';
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
      // The only tab of a window is put in a native group like any other (J15)
      expect(world.model.groups.size).toBe(1);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J2 first run in Firefox 139 or later, windows with many tabs, none hidden', () => {
    it('makes one group of the tabs of each window, in a native group, and turns native groups on, as no tab is hidden', async () => {
      const world = createWorld();
      const first = world.seedWindow(['a', 'b', 'c']);
      const second = world.seedWindow(['d', 'e']);
      const before = await windowOfEachTab(world);

      await world.start();

      expect(world.options.stored.useNativeGroups).toBe(true);
      const windows = await world.windows();
      expect(windows.map(({ id }) => id)).toEqual([
        first.windowId,
        second.windowId,
      ]);
      windows.forEach((window) => {
        expect(tabsInGroup(window, 0)).toHaveLength(window.tabs.length);
        expect(nativeGroupsOf(window.tabs)).toHaveLength(1);
      });
      expect(world.notifications.shown.size).toBe(0);
      expect(await tabsThatMoved(world, before)).toEqual([]);
      expect(world.logs.error).toEqual([]);
    });

    it('decides once: native groups stay on at the next start', async () => {
      const world = createWorld();
      world.seedWindow(['a', 'b', 'c']);
      await world.start();

      await world.restart();

      expect(world.options.stored.useNativeGroups).toBe(true);
    });
  });

  describe('J3 an update from an earlier version of the add-on, with groups stored', () => {
    it('keeps the groups and leaves native groups off, for the group not shown has its tabs hidden', async () => {
      const world = createWorld();
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);
      // As the earlier version left them
      world.model.hide([tabIds[2] ?? 0, tabIds[3] ?? 0]);

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
      expect(world.model.groups.size).toBe(0);
      expect(world.model.tabs.get(tabIds[2] ?? 0)?.hidden).toBe(true);
      expect(world.logs.error).toEqual([]);
    });

    it('keeps what the user chose', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);

      await world.start();

      expect(world.options.stored.useNativeGroups).toBe(true);
      // A native group for each group that has tabs, the one not shown collapsed
      expect(
        [...world.model.groups.values()].map(({ title, collapsed }) => [
          title,
          collapsed,
        ]),
      ).toEqual([
        ['G1', false],
        ['G2', true],
      ]);
    });
  });

  describe('J4 first run next to another add-on that has groups the add-on cannot read', () => {
    // What this add-on sees is windows of tabs, some of them hidden by the other add-on
    it('leaves native groups off, which would show the hidden tabs, and nothing is lost', async () => {
      const world = createWorld();
      const { tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      world.model.hide([tabIds[2] ?? 0, tabIds[3] ?? 0]);
      const before = await windowOfEachTab(world);

      await world.start();

      expect(world.options.stored.useNativeGroups).toBe(false);
      expect(await tabsThatMoved(world, before)).toEqual([]);
    });

    // The groups of the other add-on cannot be read (each extension has its own session values), so the way in
    // is its export file, which the options page imports (core/backup.ts reads that format)
    it("tells the user once that the tabs were left as they are, and the notice leads to the options, where the switch and the import of the other add-on's backup are", async () => {
      const world = createWorld();
      const { tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      world.model.hide([tabIds[3] ?? 0]);

      await world.start();
      await world.restart();

      expect([...world.notifications.shown.keys()]).toEqual([
        'first-run-native-groups-off',
      ]);
      expect(
        world.notifications.shown.get('first-run-native-groups-off'),
      ).toMatchObject({
        message: 'firstRunNativeGroupsOff',
      });

      await world.clickNotification('first-run-native-groups-off');

      expect(world.extension.optionsOpened).toBe(1);
      expect(world.notifications.shown.size).toBe(0);
      expect(world.logs.error).toEqual([]);
    });
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

    it('makes a native group for every group, named like it, with its tabs, collapsed where it is not shown, and hides no tab; the tabs stay in their window', async () => {
      const { world, windowId } = await threeGroups();
      const before = await windowOfEachTab(world);
      // The groups not shown had their tabs hidden
      await world.activateTab(world.model.tabsOf(windowId)[2]?.id ?? 0);
      expect(
        world.model.tabsOf(windowId).filter(({ hidden }) => hidden),
      ).toHaveLength(4);

      await world.setNativeGroups(true);

      const [window] = await world.windows();
      const natives = [...world.model.groups.values()];
      expect(
        natives.map(({ title, collapsed, windowId: id }) => [
          title,
          collapsed,
          id,
        ]),
      ).toEqual([
        ['G1', true, windowId],
        ['G2', false, windowId],
        ['G3', true, windowId],
      ]);
      [1, 2, 3].forEach((group, at) => {
        expect(
          nativeGroupsOf(tabsInGroup(window ?? { id: 0, tabs: [] }, group)),
        ).toEqual([natives[at]?.id]);
      });
      expect(window?.tabs.filter(({ hidden }) => hidden)).toEqual([]);
      expect(await referencesOf(world, windowId)).toEqual(
        natives.map(({ id }) => id),
      );
      expect(await tabsThatMoved(world, before)).toEqual([]);
      expect(world.logs.error).toEqual([]);
    });

    it('does nothing more when it is asked again', async () => {
      const { world } = await threeGroups();
      await world.setNativeGroups(true);
      const made = [...world.model.groups.keys()];
      expect(made).toHaveLength(3);

      await world.message({ action: 'migrateToHybridGroups' });

      expect([...world.model.groups.keys()]).toEqual(made);
    });
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
      expect(world.model.groups.size).toBe(2);

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

    it('takes a window out of its native groups that is restored after, and its groups are as they were', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      world.seedWindow(['keep']);
      const closing = world.seedWindow(['a1', 'a2', 'a3', 'a4']);
      await arrangeGroups(
        world,
        closing.windowId,
        closing.tabIds,
        [1, 1, 2, 2],
        1,
      );
      await world.start();
      await world.closeWindow(closing.windowId);
      await world.setNativeGroups(false);

      const restored = await world.restoreWindow();

      expect(world.model.groups.size).toBe(0);
      expect(
        await Promise.all(
          (restored?.tabIds ?? []).map((id) =>
            world.groupState.getTabGroup(id),
          ),
        ),
      ).toEqual([1, 1, 2, 2]);
      expect(
        (await world.groupsOf(restored?.windowId ?? 0))
          .filter(({ id }) => id >= 0)
          .map(({ id }) => id),
      ).toEqual([1, 2]);
      expect(world.logs.error).toEqual([]);
    });

    it('forgets every native group of a window closed while they were on, when it is restored after', async () => {
      // Found by the property test: the browser reports both groups gone at once
      const world = createWorld({ stored: { useNativeGroups: true } });
      world.seedWindow(['keep']);
      const closing = world.seedWindow(['a1', 'a2', 'a3', 'a4']);
      await arrangeGroups(
        world,
        closing.windowId,
        closing.tabIds,
        [1, 1, 2, 2],
        1,
      );
      await world.start();
      await world.closeWindow(closing.windowId);
      await world.setNativeGroups(false);

      const restored = await world.restoreWindow();

      expect(world.model.groups.size).toBe(0);
      expect(await referencesOf(world, restored?.windowId ?? 0)).toEqual([
        undefined,
        undefined,
      ]);
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

      expect(world.model.groups.size).toBe(2);
      expect(await referencesOf(world, windowId)).toEqual(
        [...world.model.groups.keys()].sort(),
      );
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

      // A native group for each group of each window, in its window; the windows are done at once
      const groups = [...world.model.groups.values()];
      expect(
        groups.map(({ windowId, title }) => [windowId, title]).sort(),
      ).toEqual([
        [first.windowId, 'G1'],
        [first.windowId, 'G2'],
        [second.windowId, 'G1'],
        [second.windowId, 'G2'],
      ]);
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
      expect(world.model.groups.size).toBe(2);
      expect(await referencesOf(world, window?.id ?? 0)).toEqual([
        ...world.model.groups.keys(),
      ]);
      expect(world.logs.error).toEqual([]);
    });

    it('does the same each time the browser is started', async () => {
      const { world } = await withNativeGroup();

      await world.restart();
      await world.restart();

      const [window] = await world.windows();
      expect(world.model.groups.size).toBe(2);
      expect(await referencesOf(world, window?.id ?? 0)).toEqual([
        ...world.model.groups.keys(),
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

  describe('J10 the user takes a native group apart, or drags a tab out of it', () => {
    async function twoGroupsOfTabs() {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2], 1);
      await world.start();
      const [native, other] = [...world.model.groups.keys()];
      return { world, windowId, tabIds, native, other };
    }

    it('keeps the group of the add-on, with its link forgotten and its tabs in no group, as they are in no native group', async () => {
      const { world, windowId, tabIds, native, other } =
        await twoGroupsOfTabs();

      await world.ungroupGroup(native ?? 0);

      // The other group keeps its own
      expect([...world.model.groups.keys()]).toEqual([other]);
      expect(await referencesOf(world, windowId)).toEqual([undefined, other]);
      expect(
        (await world.groupsOf(windowId))
          .filter(({ id }) => id >= 0)
          .map(({ id }) => id),
      ).toEqual([1, 2]);
      expect(
        await Promise.all(tabIds.map((id) => world.groupState.getTabGroup(id))),
      ).toEqual([-2, -2, 2]);
      expect(world.model.tabsOf(windowId)).toHaveLength(3);
      expect(world.logs.error).toEqual([]);
    });

    it('takes a tab that is dragged out of its native group out of its group, and leaves the others', async () => {
      const { world, tabIds } = await twoGroupsOfTabs();

      world.model.ungroup([tabIds[0] ?? 0]);
      await world.settle();

      expect(
        await Promise.all(tabIds.map((id) => world.groupState.getTabGroup(id))),
      ).toEqual([-2, 1, 2]);
      expect(world.logs.error).toEqual([]);
    });

    it('puts a tab that is dragged into another native group in the group that goes with it', async () => {
      const { world, tabIds, other } = await twoGroupsOfTabs();

      world.model.group([tabIds[0] ?? 0], { groupId: other ?? 0 });
      await world.settle();

      expect(await world.groupState.getTabGroup(tabIds[0] ?? 0)).toBe(2);
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

    it('switches the window to the group it goes to when it was the last tab of the shown group, and keeps it in a native group', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c']);
      await arrangeGroups(world, windowId, tabIds, [1, 2, 2], 1);
      await world.start();

      await world.sendTabToGroup(tabIds[0] ?? 0, 2);

      expect(await world.groupState.getActiveGroup(windowId)).toBe(2);
      expect(world.model.tabsOf(windowId).map(({ hidden }) => hidden)).toEqual([
        false,
        false,
        false,
      ]);
      const natives = new Set(
        world.model.tabsOf(windowId).map(({ groupId }) => groupId),
      );
      expect(natives.size).toBe(1);
      expect(natives.has(-1)).toBe(false);
      expect(world.logs.error).toEqual([]);
    });

    it('puts it in the collapsed native group of a group that is not shown, and hides it not', async () => {
      const { world, tabIds } = await twoGroups();
      const [, other] = [...world.model.groups.values()];

      await world.sendTabToGroup(tabIds[0] ?? 0, 2);

      const tab = world.model.tabs.get(tabIds[0] ?? 0);
      expect(await world.groupState.getTabGroup(tabIds[0] ?? 0)).toBe(2);
      expect(other).toMatchObject({ title: 'G2', collapsed: true });
      expect(tab?.groupId).toBe(other?.id);
      expect(tab?.hidden).toBe(false);
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
      // The other group keeps its own
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

    it('leaves the window showing the group it showed when another group, with tabs, is deleted', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 2, 2, 3], 3);
      await world.start();

      await world.deleteGroup(windowId, 2);

      expect(await world.groupState.getActiveGroup(windowId)).toBe(3);
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
      expect(world.model.groups.size).toBe(2);
      expect(world.model.tabsOf(windowId).some(({ hidden }) => hidden)).toBe(
        false,
      );
      expect(world.logs.error).toEqual([]);
    });

    it('uses native groups even where the stored option says no, as nothing else can group tabs there', async () => {
      const world = createWorld({
        hasTabHide: false,
        stored: { useNativeGroups: false },
      });
      const { windowId, tabIds } = world.seedWindow(['a', 'b']);
      await arrangeGroups(world, windowId, tabIds, [1, 2], 1);

      await world.start();
      await world.activateTab(tabIds[1] ?? 0);

      expect(
        [...world.model.groups.values()].map(({ title, collapsed }) => [
          title,
          collapsed,
        ]),
      ).toEqual([
        ['G1', true],
        ['G2', false],
      ]);
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

    it('shows on the toolbar button the number of groups of the window, not counting the group for ungrouped tabs', async () => {
      const world = createWorld({ hasTabGroups: false });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);
      await world.start();

      await world.activateTab(tabIds[2] ?? 0);

      expect(world.toolbar.titles.get(windowId)).toBe('Active Group: G2');
      expect(world.toolbar.badgeTexts.get(windowId)).toBe('2');
      expect(world.logs.error).toEqual([]);
    });

    it('does no harm when it is asked to migrate, though the options page does not offer it, and answers that it failed', async () => {
      const world = createWorld({ hasTabGroups: false });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);
      await world.start();

      const answer = await world.message({ action: 'migrateToHybridGroups' });

      expect(world.model.groups.size).toBe(0);
      expect(world.model.tabsOf(windowId)).toHaveLength(4);
      expect(
        await Promise.all(tabIds.map((id) => world.groupState.getTabGroup(id))),
      ).toEqual([1, 1, 2, 2]);
      // The browser has no native groups to be asked for, and the add-on says what failed
      expect(world.logs.warn.join(' ')).toContain(
        'browser.tabs.group is undefined',
      );
      // and it does not say that the migration was done, which it was not
      expect(answer).toEqual({ success: false, message: 'Migration failed' });
      expect(await world.migrationFlag.isComplete()).toBe(false);
    });
  });

  describe('J15 a window whose only tab is in a group', () => {
    // Firefox makes the group and keeps the window (firefox-facts.spec.ts), so there is nothing to refuse
    it('is given a native group, and the window stays', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['solo']);
      await arrangeGroups(world, windowId, tabIds, [1], 1);

      await world.start();

      expect(world.model.groups.size).toBe(1);
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

  describe('J17 a hidden tab is moved to another window, native groups off', () => {
    it('joins the group the window shows, and is shown with it', async () => {
      const world = createWorld({ stored: { useNativeGroups: false } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c']);
      await arrangeGroups(world, windowId, tabIds, [1, 2, 1], 1);
      await world.start();
      const [, hidden = 0, third = 0] = tabIds;
      // A switch to the group hides the tabs of the others
      await world.activateTab(third);
      const other = await world.openWindow(['d']);
      expect(world.model.tabs.get(hidden)?.hidden).toBe(true);

      // By another add-on, or the browser's own "Move to window" of a tab the person sees elsewhere
      await world.moveTab(hidden, other.windowId);

      const shown = await world.groupState.getActiveGroup(other.windowId);
      expect(await world.groupState.getTabGroup(hidden)).toBe(shown);
      expect(world.model.tabs.get(hidden)?.hidden).toBe(false);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J18 automatic backups', () => {
    const QUIET = 5000;
    const HOUR = 60 * 60 * 1000;
    const FIRST = 'panorama-tab-groups-backups/backup-1.json';

    it('writes one a few seconds after start-up has put the groups together, from then on once an hour', async () => {
      const world = createWorld();
      const { windowId, tabIds } = world.seedWindow(['a', 'b']);
      await arrangeGroups(world, windowId, tabIds, [1, 2], 1);

      await world.start();
      await world.wait(QUIET);

      expect(world.backupFiles.written).toEqual([FIRST]);
      const saved: unknown = JSON.parse(
        world.backupFiles.files.get(FIRST) ?? '',
      );
      expect(saved).toMatchObject({
        file: { type: 'tgvView', version: 1 },
        windows: [
          {
            groups: [{ id: 1, name: 'G1' }, { id: 2, name: 'G2' }, { id: -2 }],
            tabs: [
              expect.objectContaining({ url: 'a', groupId: 1 }),
              expect.objectContaining({ url: 'b', groupId: 2 }),
            ],
            activeGroup: 1,
          },
        ],
      });

      // Within the hour, a change is not backed up
      await world.sendTabToGroup(tabIds[1] ?? 0, 1);
      await world.wait(QUIET);
      expect(world.backupFiles.written).toEqual([FIRST]);

      // After it, the next one is, as it is then
      await world.wait(HOUR);
      await world.sendTabToGroup(tabIds[0] ?? 0, 2);
      await world.wait(QUIET);
      const second = 'panorama-tab-groups-backups/backup-2.json';
      expect(world.backupFiles.written).toEqual([FIRST, second]);
      expect(
        JSON.parse(world.backupFiles.files.get(second) ?? ''),
      ).toMatchObject({
        // A tab moved to a group goes to the end of the window
        windows: [
          {
            tabs: [
              expect.objectContaining({ url: 'b', groupId: 1 }),
              expect.objectContaining({ url: 'a', groupId: 2 }),
            ],
          },
        ],
      });
      expect(world.logs.error).toEqual([]);
    });

    it('writes one at once when an update is waiting, and applies it once the view is closed', async () => {
      const world = createWorld();
      const { windowId } = world.seedWindow(['a']);
      await world.start();
      const view = await world.openTab(
        windowId,
        world.extension.urlOf('view.html'),
        true,
      );

      await world.updateAvailable();

      expect(world.backupFiles.written).toEqual([FIRST]);
      expect(world.extension.reloads).toBe(0);

      await world.closeTab(view);
      await world.wait(0);

      expect(world.extension.reloads).toBe(1);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J19 an update from a version that stored no version', () => {
    it('backs up the groups as they were, then brings each window to the current version', async () => {
      const world = createWorld({ migrated: true });
      const { windowId, tabIds } = world.seedWindow(['a', 'b']);
      // As versions before 2 stored them, with a container
      await arrangeGroups(world, windowId, tabIds, [1, 2], 1);
      expect(await world.groupsOf(windowId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ containerId: 'firefox-default' }),
        ]),
      );

      await world.start();

      const [backup = ''] = world.backupFiles.written;
      expect(backup).toBe('panorama-tab-groups-backups/backup-1.json');
      expect(
        JSON.parse(world.backupFiles.files.get(backup) ?? ''),
      ).toMatchObject({
        windows: [
          {
            groups: [{ id: 1 }, { id: 2 }, { id: -2 }],
            tabs: [{ groupId: 1 }, { groupId: 2 }],
          },
        ],
      });
      const groups = await world.groupsOf(windowId);
      expect(groups.map(({ id }) => id)).toEqual([1, 2, -2]);
      groups.forEach((group) => {
        expect(group).not.toHaveProperty('containerId');
      });
      expect(await world.groupState.getSchemaVersion(windowId)).toBe(
        DATA_VERSION,
      );
      expect(await world.dataVersion.read()).toBe(DATA_VERSION);
      expect(world.logs.error).toEqual([]);
    });

    it('brings a window restored from before the update to the current version when it comes back', async () => {
      const world = createWorld({ migrated: true });
      world.seedWindow(['a', 'b']);
      await world.start();
      const closing = await world.openWindow(['c', 'd']);
      // Closed with groups as an earlier version stored them
      await world.groupState.setGroups(closing.windowId, [
        {
          id: 0,
          name: 'Old',
          containerId: 'firefox-default',
          rect: { x: 0, y: 0, w: 1, h: 1 },
        },
      ]);
      await world.groupState.setSchemaVersion(closing.windowId, 1);
      await world.closeWindow(closing.windowId);

      const restored = await world.restoreWindow();

      const groups = await world.groupsOf(restored?.windowId ?? 0);
      expect(groups.map(({ id }) => id)).toEqual([0, -2]);
      groups.forEach((group) => {
        expect(group).not.toHaveProperty('containerId');
      });
      expect(
        await world.groupState.getSchemaVersion(restored?.windowId ?? 0),
      ).toBe(DATA_VERSION);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J20 an update of a Firefox profile in native mode, which hid the tabs of the groups not shown', () => {
    it('shows every tab, in the native group of its group, collapsed where the group is not shown', async () => {
      // Native groups on, migrated once already, by a version that gave the shown group alone a
      // native group and hid the rest
      const world = createWorld({
        stored: { useNativeGroups: true },
        migrated: true,
      });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);
      await world.dataVersion.write(2);
      world.model.hide([tabIds[2] ?? 0, tabIds[3] ?? 0]);

      await world.start();

      const [window] = await world.windows();
      expect(window?.tabs.filter(({ hidden }) => hidden)).toEqual([]);
      const natives = [...world.model.groups.values()];
      expect(natives.map(({ title, collapsed }) => [title, collapsed])).toEqual(
        [
          ['G1', false],
          ['G2', true],
        ],
      );
      expect(
        nativeGroupsOf(tabsInGroup(window ?? { id: 0, tabs: [] }, 2)),
      ).toEqual([natives[1]?.id]);
      expect(await world.dataVersion.read()).toBe(DATA_VERSION);
      expect(world.logs.error).toEqual([]);
    });

    it('hides no tab when the person switches to another group', async () => {
      const world = createWorld({ stored: { useNativeGroups: true } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);
      await world.start();

      await world.activateTab(tabIds[2] ?? 0);

      expect(world.model.tabsOf(windowId).some(({ hidden }) => hidden)).toBe(
        false,
      );
      expect(
        [...world.model.groups.values()].map(({ collapsed }) => collapsed),
      ).toEqual([true, false]);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J21 pinned tabs, which are in no group and are never passed to the browser’s grouping', () => {
    async function withPinned(native: boolean, hasTabHide = true) {
      const world = createWorld({
        stored: { useNativeGroups: native },
        hasTabHide,
      });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(world, windowId, tabIds, [1, 1, 2, 2], 1);
      await world.start();
      return { world, windowId, tabIds };
    }

    it('takes the group of a tab that is pinned, and leaves the tab pinned when its group gets a native group', async () => {
      const { world, windowId, tabIds } = await withPinned(true);
      const [first = 0, second = 0, third = 0, fourth = 0] = tabIds;

      await world.setPinned(first, true);
      // The group of the tab gets a native group again: it is made of the tabs that are in it
      await world.setNativeGroups(false);
      await world.setNativeGroups(true);

      expect(world.model.tabs.get(first)).toMatchObject({
        pinned: true,
        groupId: -1,
      });
      expect(await world.groupState.getTabGroup(first)).toBeUndefined();
      expect(world.model.unpinnedByGrouping).toEqual([]);
      expect(await world.groupState.getTabGroup(second)).toBe(1);
      expect(world.model.tabs.get(second)?.groupId).not.toBe(-1);
      expect(
        [third, fourth].map((id) => world.model.tabs.get(id)?.groupId),
      ).not.toContain(-1);
      expect(world.model.tabsOf(windowId)).toHaveLength(4);
      expect(world.logs.error).toEqual([]);
    });

    it('gives a tab that is unpinned no group in native mode, and puts it in no native group', async () => {
      const { world, tabIds } = await withPinned(true);
      const [first = 0] = tabIds;
      await world.setPinned(first, true);

      await world.setPinned(first, false);

      expect(await world.groupState.getTabGroup(first)).toBe(-2);
      expect(world.model.tabs.get(first)).toMatchObject({
        pinned: false,
        groupId: -1,
        hidden: false,
      });
      expect(world.logs.error).toEqual([]);
    });

    it('puts a tab that is unpinned in the group the window shows, with tabs hidden, and shows it', async () => {
      const { world, tabIds } = await withPinned(false);
      const [first = 0, , third = 0] = tabIds;
      await world.activateTab(third);
      expect(world.model.tabs.get(first)?.hidden).toBe(true);
      await world.setPinned(first, true);

      await world.setPinned(first, false);

      expect(await world.groupState.getTabGroup(first)).toBe(2);
      expect(world.model.tabs.get(first)?.hidden).toBe(false);
      expect(world.logs.error).toEqual([]);
    });

    it('unpins a pinned tab sent to a group from the menu, then moves it there, and keeps it there', async () => {
      const { world, tabIds } = await withPinned(true);
      const [first = 0] = tabIds;
      await world.setPinned(first, true);

      await world.sendTabToGroup(first, 2);

      expect(await world.groupState.getTabGroup(first)).toBe(2);
      const tab = world.model.tabs.get(first);
      expect(tab?.pinned).toBe(false);
      const natives = [...world.model.groups.values()];
      expect(natives.find(({ id }) => id === tab?.groupId)).toMatchObject({
        title: 'G2',
      });
      expect(world.model.unpinnedByGrouping).toEqual([]);
      expect(world.logs.error).toEqual([]);
    });

    it('does the same in a browser that can hide tabs, with native groups off', async () => {
      const { world, tabIds } = await withPinned(false);
      const [first = 0] = tabIds;
      await world.setPinned(first, true);

      await world.sendTabToGroup(first, 2);

      expect(await world.groupState.getTabGroup(first)).toBe(2);
      expect(world.model.tabs.get(first)?.pinned).toBe(false);
      expect(world.logs.error).toEqual([]);
    });

    it('gives a pinned tab opened by the user no group, and no native group', async () => {
      const { world, windowId } = await withPinned(true);

      const opened = await world.openTab(windowId, 'https://p/', false, true);

      expect(await world.groupState.getTabGroup(opened)).toBeUndefined();
      expect(world.model.tabs.get(opened)).toMatchObject({
        pinned: true,
        groupId: -1,
      });
      expect(world.logs.error).toEqual([]);
    });

    it('gives a pinned tab dragged to another window no group there', async () => {
      const { world, tabIds } = await withPinned(true);
      const [first = 0] = tabIds;
      await world.setPinned(first, true);
      const other = await world.openWindow(['x']);

      await world.moveTab(first, other.windowId);

      expect(await world.groupState.getTabGroup(first)).toBeUndefined();
      expect(world.model.tabs.get(first)?.pinned).toBe(true);
      expect(world.model.unpinnedByGrouping).toEqual([]);
      expect(world.logs.error).toEqual([]);
    });

    it('keeps a pinned tab pinned and in no group when the browser is started again', async () => {
      const { world, tabIds } = await withPinned(true);
      const [first = 0] = tabIds;
      await world.setPinned(first, true);

      await world.restart();

      const [window] = await world.windows();
      const pinned = window?.tabs.find(
        ({ id }) => world.model.tabs.get(id)?.pinned,
      );
      expect(pinned).toMatchObject({ group: undefined, nativeGroupId: -1 });
      expect(world.model.unpinnedByGrouping).toEqual([]);
      expect(world.logs.error).toEqual([]);
    });

    it('takes the group of a pinned tab that an earlier version gave it, at the update', async () => {
      const world = createWorld({
        stored: { useNativeGroups: true },
        migrated: true,
      });
      const { windowId, tabIds } = world.seedWindow(['a', 'b']);
      await arrangeGroups(world, windowId, tabIds, [1, 1], 1);
      world.model.setPinned(tabIds[0] ?? 0, true);
      await world.dataVersion.write(4);
      await world.groupState.setSchemaVersion(windowId, 4);

      await world.start();

      expect(
        await world.groupState.getTabGroup(tabIds[0] ?? 0),
      ).toBeUndefined();
      expect(await world.groupState.getTabGroup(tabIds[1] ?? 0)).toBe(1);
      expect(world.model.tabs.get(tabIds[0] ?? 0)?.pinned).toBe(true);
      expect(world.logs.error).toEqual([]);
    });
  });

  describe('J22 found by the property test', () => {
    it('shows every tab of a window closed with tabs hidden, and restored after native groups were switched on', async () => {
      const world = createWorld({ stored: { useNativeGroups: false } });
      world.seedWindow(['keep']);
      const closing = world.seedWindow(['a', 'b', 'c', 'd']);
      await arrangeGroups(
        world,
        closing.windowId,
        closing.tabIds,
        [1, 1, 2, 2],
        1,
      );
      await world.start();
      await world.activateTab(closing.tabIds[2] ?? 0);
      await world.closeWindow(closing.windowId);
      await world.setNativeGroups(true);

      const restored = await world.restoreWindow();

      expect(
        world.model
          .tabsOf(restored?.windowId ?? 0)
          .some(({ hidden }) => hidden),
      ).toBe(false);
      expect(world.logs.error).toEqual([]);
    });

    it('shows the tabs of the group the window goes to when the group it showed is deleted, with tabs hidden', async () => {
      const world = createWorld({ stored: { useNativeGroups: false } });
      const { windowId, tabIds } = world.seedWindow(['a', 'b', 'c']);
      await arrangeGroups(world, windowId, tabIds, [1, 2, 1], 1);
      await world.start();
      await world.setPinned(tabIds[0] ?? 0, true);
      await world.sendTabToGroup(tabIds[0] ?? 0, 2);

      await world.deleteGroup(windowId, 1);

      expect(await world.groupState.getActiveGroup(windowId)).toBe(2);
      expect(world.model.tabsOf(windowId).some(({ hidden }) => hidden)).toBe(
        false,
      );
      expect(world.logs.error).toEqual([]);
    });

    it('keeps the context menu for the focused window when two windows create, rename and delete groups with the same numbers', async () => {
      const world = createWorld();
      const first = world.seedWindow(['a1', 'a2']);
      const second = world.seedWindow(['b1', 'b2']);
      await arrangeGroups(world, first.windowId, first.tabIds, [0, 1], 0);
      await arrangeGroups(world, second.windowId, second.tabIds, [0, 1], 0);
      await world.start();

      expect(world.model.focused()).toBe(second.windowId);
      expect(world.menus.items.map(({ id }) => id)).toEqual([
        'send-tab',
        `${String(second.windowId)}:0`,
        `${String(second.windowId)}:1`,
        `${String(second.windowId)}:-2`,
        'refresh-spacer',
        'refresh-groups',
      ]);

      // Creating and renaming a group in the unfocused window does not touch or break the menu
      const createdInFirst = await world.createGroup(first.windowId);
      await world.renameGroup(first.windowId, createdInFirst, 'First Extra');
      const createdInSecond = await world.createGroup(second.windowId);
      await world.renameGroup(second.windowId, createdInSecond, 'Second Extra');
      expect(createdInFirst).toBe(createdInSecond);
      expect(
        world.menus.items.find(
          ({ id }) =>
            id === `${String(second.windowId)}:${String(createdInSecond)}`,
        )?.title,
      ).toBe(`${String(createdInSecond)}: Second Extra`);

      // Focusing the first window rebuilds the menu with the first window's groups
      await world.focusWindow(first.windowId);
      expect(
        world.menus.items.find(
          ({ id }) =>
            id === `${String(first.windowId)}:${String(createdInFirst)}`,
        )?.title,
      ).toBe(`${String(createdInFirst)}: First Extra`);

      // Sending a tab in the first window via its context menu item moves it in the first window
      await world.sendTabToGroup(first.tabIds[0] ?? 0, createdInFirst);
      expect(await world.groupState.getTabGroup(first.tabIds[0] ?? 0)).toBe(
        createdInFirst,
      );
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
