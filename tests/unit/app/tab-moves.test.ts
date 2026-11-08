import { describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMenus } from '../../../src/js/adapters/memory/menus.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createNativeGroupAssignment } from '../../../src/js/app/native-group-assignment.js';
import { createOwnMoves } from '../../../src/js/app/own-moves.js';
import { createTabMoves } from '../../../src/js/app/tab-moves.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';
import { englishMessage } from '../../support/messages.js';
import { storeGroups } from '../../support/stored-groups.js';

const WINDOW = 1;

const group = (id: number, nativeGroupId?: number): Group => ({
  id,
  name: `G${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
  ...(nativeGroupId === undefined ? {} : { nativeGroupId }),
});

const tab = (id: number, overrides: Partial<TabDetails> = {}): TabDetails => ({
  id,
  windowId: WINDOW,
  active: false,
  pinned: false,
  url: undefined,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId: undefined,
  ...overrides,
});

interface Options {
  groups?: Group[];
  activeGroup?: number | undefined;
  tabs?: TabDetails[];
  nativeGroupIds?: number[];
  useNative?: boolean;
  currentWindow?: number;
  highlighted?: number[];
  // The group of each tab, by tab
  tabGroups?: Record<number, number>;
}

async function setUp(options: Options = {}) {
  const {
    groups = [group(1, 50), group(2, 60), group(3)],
    tabs: tabList = [tab(10, { active: true }), tab(11), tab(12), tab(13)],
    nativeGroupIds = [50, 60],
    useNative = true,
    currentWindow = WINDOW,
    highlighted = [],
    tabGroups = {},
  } = options;
  const activeGroup = 'activeGroup' in options ? options.activeGroup : 1;
  const tabs = createMemoryTabs();
  tabs.setDetails(tabList);
  tabs.setHighlighted(highlighted);
  const groupState = createMemoryGroupState();
  await storeGroups(groupState, WINDOW, groups);
  if (activeGroup !== undefined) {
    await groupState.setActiveGroup(WINDOW, activeGroup);
  }
  await Promise.all(
    Object.entries(tabGroups).map(([tabId, groupId]) =>
      groupState.setTabGroup(Number(tabId), groupId),
    ),
  );
  const nativeGroups = createMemoryNativeGroups(nativeGroupIds, WINDOW);
  const menus = createMemoryMenus();
  const order: string[] = [];
  const createMenuList = vi.fn(() => {
    order.push('createMenuList');
    return Promise.resolve();
  });
  const toggleVisibleTabs = vi.fn(() => {
    order.push('toggle');
    return Promise.resolve();
  });
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ownMoves = createOwnMoves();
  const windows = createMemoryWindows(currentWindow);
  const moves = createTabMoves({
    tabs,
    windows,
    groupState,
    nativeGroups,
    assignment: createNativeGroupAssignment({
      tabs,
      windows,
      groupState,
      nativeGroups,
      i18n: { getMessage: englishMessage },
      logger,
    }),
    menus,
    createMenuList,
    toggleVisibleTabs,
    useNativeGroups: () => Promise.resolve(useNative),
    ownMoves,
    logger,
  });
  return {
    ownMoves,
    moves,
    tabs,
    groupState,
    nativeGroups,
    menus,
    createMenuList,
    toggleVisibleTabs,
    logger,
    order,
  };
}

describe('app/tab-moves.ts', () => {
  describe('moveTab', () => {
    it('puts the tab in the group, at the end of the window, and shows the active group', async () => {
      const env = await setUp({ useNative: false });

      await env.moves.moveTab(11, 2);

      expect(await env.groupState.getTabGroup(11)).toBe(2);
      expect(env.tabs.calls).toEqual(['move 11']);
      expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1, WINDOW);
    });

    it('moves the tab before showing the active group', async () => {
      const env = await setUp({ useNative: false });
      const move = env.tabs.moveToEnd.bind(env.tabs);
      env.tabs.moveToEnd = (tabId) => {
        env.order.push('move');
        return move(tabId);
      };

      await env.moves.moveTab(11, 2);

      expect(env.order).toEqual(['move', 'toggle']);
    });

    it('moves the tab before putting it in a native group, which Chromium takes it out of when it is moved past', async () => {
      const env = await setUp({ activeGroup: 2 });
      const move = env.tabs.moveToEnd.bind(env.tabs);
      env.tabs.moveToEnd = (tabId) => {
        env.order.push('move');
        return move(tabId);
      };
      const add = env.nativeGroups.addTabs.bind(env.nativeGroups);
      env.nativeGroups.addTabs = (tabIds, nativeGroupId) => {
        env.order.push('add');
        return add(tabIds, nativeGroupId);
      };

      await env.moves.moveTab(11, 2);

      expect(env.order).toEqual(['move', 'add', 'toggle']);
    });

    it('uses the window of the tab when it is told, and not the window the code is running in', async () => {
      const env = await setUp({ useNative: false, currentWindow: 4 });
      await env.groupState.setGroups(WINDOW, [group(1)]);

      await env.moves.menuClicked({ menuItemId: '1:2' }, tab(11));

      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1, WINDOW);
    });

    it('shows the group the window has even when it has none', async () => {
      const env = await setUp({ useNative: false, activeGroup: undefined });

      await env.moves.moveTab(11, 2);

      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(undefined, WINDOW);
    });

    it('uses the window the code is running in', async () => {
      const env = await setUp({ useNative: false, currentWindow: 4 });
      await env.groupState.setGroups(4, [group(7)]);
      await env.groupState.setActiveGroup(4, 7);

      await env.moves.moveTab(11, 2);

      // The group is that of the window it is running in, and so is the window the tabs are switched in
      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(7, 4);
    });

    it('counts the tab as one the add-on is moving while it is moved, and not after', async () => {
      const env = await setUp({ activeGroup: 2 });
      const seen: boolean[] = [];
      const addTabs = env.nativeGroups.addTabs.bind(env.nativeGroups);
      env.nativeGroups.addTabs = (tabIds, nativeGroupId) => {
        seen.push(env.ownMoves.includes(11));
        return addTabs(tabIds, nativeGroupId);
      };

      await env.moves.moveTab(11, 2);

      expect(seen).toEqual([true]);
      expect(env.ownMoves.includes(11)).toBe(false);
    });

    describe('a pinned tab', () => {
      const pinnedTab = [tab(10, { active: true }), tab(11, { pinned: true })];

      it('is given its group first, then unpinned, then moved, so that unpinning is not taken for a tab without a group', async () => {
        const env = await setUp({
          tabs: pinnedTab,
          tabGroups: { 10: 1 },
          useNative: false,
        });
        const order: string[] = [];
        const setTabGroup = env.groupState.setTabGroup.bind(env.groupState);
        env.groupState.setTabGroup = (id, groupOfTab) => {
          order.push(`group ${String(id)} ${String(groupOfTab)}`);
          return setTabGroup(id, groupOfTab);
        };

        await env.moves.moveTab(11, 2);

        expect(order).toEqual(['group 11 2']);
        expect(env.tabs.calls).toEqual(['unpin 11', 'move 11']);
        expect(await env.groupState.getTabGroup(11)).toBe(2);
      });

      it('is put in the native group of the group, as any tab', async () => {
        const env = await setUp({ tabs: pinnedTab, tabGroups: { 10: 1 } });

        await env.moves.moveTab(11, 2);

        expect(env.nativeGroups.calls).toEqual(['add 11 to 60']);
      });

      it('does not unpin a tab that is not pinned', async () => {
        const env = await setUp({ tabs: pinnedTab, tabGroups: { 10: 1 } });

        await env.moves.moveTab(10, 2);

        expect(env.tabs.calls).not.toContain('unpin 10');
      });

      it('switches the window to the group it goes to when it was all the window showed', async () => {
        // The only tab of the window, with no group: nothing is left to show of the group on show
        const env = await setUp({
          tabs: [tab(11, { pinned: true })],
          useNative: false,
        });

        await env.moves.moveTab(11, 2);

        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(2);
      });

      it('does not write the group on show when the tab goes to the group already shown', async () => {
        const env = await setUp({
          tabs: [tab(11, { pinned: true })],
          useNative: false,
        });
        const setActive = vi.spyOn(env.groupState, 'setActiveGroup');

        await env.moves.moveTab(11, 1);

        expect(setActive).not.toHaveBeenCalled();
      });

      it('does not switch the window when other tabs of the group on show are left', async () => {
        const env = await setUp({
          tabs: pinnedTab,
          tabGroups: { 10: 1 },
          useNative: false,
        });

        await env.moves.moveTab(11, 2);

        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(1);
      });
    });

    it('puts the tab in the native group of the group when that is the active one', async () => {
      const env = await setUp({ activeGroup: 2 });

      await env.moves.moveTab(11, 2);

      expect(env.nativeGroups.calls).toEqual(['add 11 to 60']);
      expect(await env.nativeGroups.tabIdsIn(60)).toEqual([11]);
    });

    it('puts the tab in the native group of the group when that is not the active one too', async () => {
      const env = await setUp({ activeGroup: 1 });

      await env.moves.moveTab(11, 2);

      expect(env.nativeGroups.calls).toEqual(['add 11 to 60']);
      expect(await env.nativeGroups.tabIdsIn(60)).toEqual([11]);
    });

    it('makes a native group for a group that has none, of the tabs in it', async () => {
      const env = await setUp({ activeGroup: 3, tabGroups: { 12: 3 } });

      await env.moves.moveTab(11, 3);

      // The tab is at the end of the window by then
      expect(env.nativeGroups.calls).toEqual([
        'create 12,11',
        'appearance 1000 G3',
      ]);
      expect(
        (await env.groupState.getGroups(WINDOW))?.find(({ id }) => id === 3)
          ?.nativeGroupId,
      ).toBe(1000);
    });

    it('makes it collapsed when the group is not the one shown', async () => {
      const env = await setUp({ activeGroup: 1 });

      await env.moves.moveTab(11, 3);

      expect(env.nativeGroups.calls).toEqual([
        'create 11',
        'appearance 1000 G3',
        'collapse 1000',
      ]);
    });

    it('takes the tab out of its native group when it is sent to the group for ungrouped tabs, which has none', async () => {
      const env = await setUp({
        groups: [group(1, 50), { ...group(-2), nativeGroupId: null }],
        activeGroup: 1,
      });
      env.nativeGroups.seed(50, WINDOW, [11]);

      await env.moves.moveTab(11, -2);

      expect(env.nativeGroups.calls).toEqual(['remove 11']);
      expect(await env.groupState.getTabGroup(11)).toBe(-2);
    });

    it('takes the tab out of its native group for a group that is not known, which has no native group', async () => {
      const env = await setUp({ activeGroup: 9 });

      await env.moves.moveTab(11, 9);

      expect(env.nativeGroups.calls).toEqual(['remove 11']);
    });

    it('treats a native group with the id 0 as none, and makes one', async () => {
      const env = await setUp({ groups: [group(1, 0)], activeGroup: 1 });

      await env.moves.moveTab(11, 1);

      expect(env.nativeGroups.calls[0]).toBe('create 11');
    });

    it('takes the tab out of its native group when the window has no groups stored', async () => {
      const env = await setUp({ activeGroup: 1 });
      await env.groupState.setGroups(WINDOW, []);

      await env.moves.moveTab(11, 1);

      expect(env.nativeGroups.calls).toEqual(['remove 11']);
    });

    it('leaves native groups alone when they are switched off', async () => {
      const env = await setUp({ useNative: false, activeGroup: 2 });

      await env.moves.moveTab(11, 2);

      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('carries on when the native group cannot be used', async () => {
      const env = await setUp({ activeGroup: 2 });
      const failure = new Error('gone');
      env.nativeGroups.addTabs = () => Promise.reject(failure);

      await env.moves.moveTab(11, 2);

      expect(env.logger.warn).toHaveBeenCalledWith(
        'Could not assign tab to native group:',
        failure,
      );
      expect(env.tabs.calls).toEqual(['move 11']);
      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2, WINDOW);
    });

    describe('when the tab was the last the window showed', () => {
      // Group 1 is shown, and tab 10 is the only tab in it
      const onlyShown = {
        tabs: [tab(10, { active: true }), tab(11), tab(12)],
        tabGroups: { 10: 1, 11: 2, 12: 2 },
      };

      it('switches the window to the group the tab went to', async () => {
        const env = await setUp({ ...onlyShown, useNative: false });

        await env.moves.moveTab(10, 2);

        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(2);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2, WINDOW);
      });

      it('puts the tab in the native group of the group it went to', async () => {
        const env = await setUp(onlyShown);
        env.nativeGroups.seed(50, WINDOW, [10]);
        env.nativeGroups.seed(60, WINDOW, [11, 12]);

        await env.moves.moveTab(10, 2);

        expect(env.nativeGroups.calls).toEqual(['add 10 to 60']);
        expect(await env.nativeGroups.tabIdsIn(60)).toEqual([11, 12, 10]);
      });

      it('makes a native group of the group it went to when that has none', async () => {
        const env = await setUp({
          ...onlyShown,
          groups: [group(1, 50), group(2)],
        });
        env.nativeGroups.seed(50, WINDOW, [10]);

        await env.moves.moveTab(10, 2);

        expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([11, 12, 10]);
        expect(env.logger.debug).toHaveBeenCalledWith(
          expect.stringMatching(/^\[TabMoved\] Created native group 1000 /u),
        );
        expect(
          (await env.groupState.getGroups(WINDOW))?.map(
            ({ nativeGroupId }) => nativeGroupId,
          ),
        ).toEqual([50, 1000]);
      });

      it('takes the tab out of its native group if none could be made for the group it went to', async () => {
        const env = await setUp({
          ...onlyShown,
          groups: [group(1, 50), group(2)],
        });
        env.nativeGroups.seed(50, WINDOW, [10]);
        env.nativeGroups.createFromTabs = () => Promise.reject(new Error('no'));

        await env.moves.moveTab(10, 2);

        expect(env.logger.warn).toHaveBeenCalledWith(
          'Could not assign tab to native group:',
          new Error('no'),
        );
        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(2);
      });

      it('takes the tab out of its native group when the group it went to is not known', async () => {
        const env = await setUp({ ...onlyShown, groups: [group(1, 50)] });
        env.nativeGroups.seed(50, WINDOW, [10]);

        await env.moves.moveTab(10, 2);

        expect(env.nativeGroups.calls).toEqual(['remove 10']);
        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(2);
      });

      it('takes the tab out of its native group when the window has no groups stored any more', async () => {
        const env = await setUp({ ...onlyShown });
        env.groupState.getGroups = () => Promise.resolve(undefined);

        await env.moves.moveTab(10, 2);

        expect(env.nativeGroups.calls).toEqual(['remove 10']);
      });

      it('does not switch while another tab of the group is left', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10, { active: true }), tab(11), tab(12)],
          tabGroups: { 10: 1, 11: 1, 12: 2 },
        });

        await env.moves.moveTab(10, 2);

        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(1);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1, WINDOW);
      });

      it('does not count pinned tabs, which every group shows, as tabs left', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10, { active: true }), tab(11, { pinned: true })],
          tabGroups: { 10: 1, 11: 1 },
        });

        await env.moves.moveTab(10, 2);

        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(2);
      });

      it('does not switch for a tab that was not in the shown group', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10, { active: true }), tab(11)],
          tabGroups: { 10: 1, 11: 3 },
        });

        await env.moves.moveTab(11, 2);

        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(1);
      });

      it('does not switch when the window has no shown group', async () => {
        const env = await setUp({
          ...onlyShown,
          useNative: false,
          activeGroup: undefined,
        });

        await env.moves.moveTab(10, 2);

        expect(await env.groupState.getActiveGroup(WINDOW)).toBeUndefined();
      });

      it('does not treat a tab that stays in the shown group as one that switched it', async () => {
        const env = await setUp({
          ...onlyShown,
          groups: [group(1), group(2, 60)],
        });

        await env.moves.moveTab(10, 1);

        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(1);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1, WINDOW);
      });

      it('does not switch when the window has no shown group, whatever the tabs are in', async () => {
        const env = await setUp({
          useNative: false,
          activeGroup: undefined,
          tabs: [tab(10, { active: true }), tab(11)],
          tabGroups: { 11: 2 },
        });

        await env.moves.moveTab(10, 2);

        expect(await env.groupState.getActiveGroup(WINDOW)).toBeUndefined();
      });

      it('does not switch when the tab stays in the group it is in', async () => {
        const env = await setUp({ ...onlyShown, useNative: false });

        await env.moves.moveTab(10, 1);

        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(1);
      });
    });
  });

  describe('placeTab, for a tab the view dropped', () => {
    it('sends a tab dropped on another group there, as moveTab does', async () => {
      const env = await setUp({ tabGroups: { 10: 1, 11: 1 } });

      await env.moves.placeTab(11, 2, WINDOW);

      expect(await env.groupState.getTabGroup(11)).toBe(2);
      expect(env.tabs.calls).toEqual(['move 11']);
      expect(env.nativeGroups.calls).toEqual(['add 11 to 60']);
      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1, WINDOW);
    });

    it('puts a tab dropped on its own group at the end of the window, in its native group', async () => {
      const env = await setUp({ tabGroups: { 10: 2, 11: 2 } });

      await env.moves.placeTab(10, 2, WINDOW);

      expect(env.tabs.calls).toEqual(['move 10']);
      expect(env.nativeGroups.calls).toEqual(['add 10 to 60']);
    });

    it('then puts it next to the tab it was dropped by', async () => {
      const env = await setUp({
        tabGroups: { 11: 1, 12: 2 },
        tabs: [tab(10), tab(11), tab(12, { browserGroupId: 60 })],
      });

      await env.moves.placeTab(11, 2, WINDOW, { tabId: 12, before: true });

      expect(env.tabs.calls).toEqual(['move 11', 'move 11 before 12']);
    });

    it('only puts it next to that tab when it is in the group already', async () => {
      const env = await setUp({
        tabGroups: { 11: 2, 12: 2 },
        tabs: [
          tab(11, { browserGroupId: 60 }),
          tab(12, { browserGroupId: 60 }),
        ],
      });

      await env.moves.placeTab(11, 2, WINDOW, { tabId: 12, before: false });

      expect(env.tabs.calls).toEqual(['move 11 after 12']);
      expect(env.nativeGroups.calls).toEqual([]);
      expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
    });

    it('puts it back in the native group of its group when the move took it out, as Chromium does at the edge of a group', async () => {
      const env = await setUp({
        tabGroups: { 11: 2, 12: 2 },
        tabs: [tab(11), tab(12, { browserGroupId: 60 })],
      });

      await env.moves.placeTab(11, 2, WINDOW, { tabId: 12, before: false });

      expect(env.nativeGroups.calls).toEqual(['add 11 to 60']);
    });

    it('leaves native groups alone when they are switched off', async () => {
      const env = await setUp({
        useNative: false,
        tabGroups: { 11: 2, 12: 2 },
        tabs: [tab(11), tab(12)],
      });

      await env.moves.placeTab(11, 2, WINDOW, { tabId: 12, before: false });

      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('puts it in no native group when its group has none', async () => {
      const env = await setUp({
        tabGroups: { 11: 3, 12: 3 },
        tabs: [tab(11), tab(12)],
      });

      await env.moves.placeTab(11, 3, WINDOW, { tabId: 12, before: false });

      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('counts the tab as one the add-on is moving while it is put there', async () => {
      const env = await setUp({
        tabGroups: { 11: 2, 12: 2 },
        tabs: [tab(11), tab(12, { browserGroupId: 60 })],
      });
      const seen: boolean[] = [];
      const moveBeside = env.tabs.moveBeside.bind(env.tabs);
      vi.spyOn(env.tabs, 'moveBeside').mockImplementation(async (...args) => {
        seen.push(env.ownMoves.includes(11));
        await moveBeside(...args);
      });

      await env.moves.placeTab(11, 2, WINDOW, { tabId: 12, before: false });

      expect(seen).toEqual([true]);
      expect(env.ownMoves.includes(11)).toBe(false);
    });

    it('says so, and goes on, when the tab cannot be put back in its native group', async () => {
      const env = await setUp({
        tabGroups: { 11: 2, 12: 2 },
        tabs: [tab(11), tab(12, { browserGroupId: 60 })],
      });
      const failure = new Error('No tab with id: 11');
      vi.spyOn(env.nativeGroups, 'addTabs').mockRejectedValue(failure);

      await expect(
        env.moves.placeTab(11, 2, WINDOW, { tabId: 12, before: false }),
      ).resolves.toBeUndefined();

      expect(env.logger.warn).toHaveBeenCalledWith(
        'Could not assign tab to native group:',
        failure,
      );
    });
  });

  describe('menuClicked', () => {
    it('makes the menu again when asked to refresh the groups', async () => {
      const env = await setUp();
      env.menus.create({ id: 'x', contexts: ['all'] });

      await env.moves.menuClicked({ menuItemId: 'refresh-groups' }, undefined);

      expect(env.menus.items).toEqual([]);
      expect(env.createMenuList).toHaveBeenCalledTimes(1);
    });

    it('removes the old menu before making the new one', async () => {
      const env = await setUp();
      const removeAll = env.menus.removeAll.bind(env.menus);
      env.menus.removeAll = () => {
        env.order.push('removeAll');
        return removeAll();
      };

      await env.moves.menuClicked({ menuItemId: 'refresh-groups' }, undefined);

      expect(env.order).toEqual(['removeAll', 'createMenuList']);
    });

    it.each([['send-tab'], [''], ['2'], [3]])(
      'ignores a click on the item %j, which is no group',
      async (menuItemId) => {
        const env = await setUp();

        await env.moves.menuClicked({ menuItemId }, tab(11));

        expect(env.tabs.calls).toEqual([]);
        expect(env.createMenuList).not.toHaveBeenCalled();
        expect(env.logger.debug).toHaveBeenCalledWith(
          `Ignored a click on the menu item ${String(menuItemId)}`,
        );
      },
    );

    it('ignores a click that is not on a tab', async () => {
      const env = await setUp();

      await env.moves.menuClicked({ menuItemId: '1:2' }, undefined);

      expect(env.tabs.calls).toEqual([]);
      expect(await env.groupState.getTabGroup(11)).toBeUndefined();
    });

    it('ignores a tab that has no id or no window', async () => {
      const env = await setUp();

      await env.moves.menuClicked({ menuItemId: '1:2' }, { windowId: WINDOW });
      await env.moves.menuClicked({ menuItemId: '1:2' }, { id: 11 });

      expect(env.tabs.calls).toEqual([]);
    });

    it('ignores a click on a menu item from another window', async () => {
      const env = await setUp();

      await env.moves.menuClicked({ menuItemId: '9:2' }, tab(11));

      expect(env.tabs.calls).toEqual([]);
      expect(await env.groupState.getTabGroup(11)).toBeUndefined();
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Ignored a click on the menu item 9:2',
      );
    });

    it('sends the tab that was clicked to the group', async () => {
      const env = await setUp({ useNative: false });

      await env.moves.menuClicked({ menuItemId: '1:2' }, tab(11));

      expect(await env.groupState.getTabGroup(11)).toBe(2);
      expect(env.tabs.calls).toEqual(['move 11']);
    });

    it('sends the tab with the id 0 as well', async () => {
      const env = await setUp({
        useNative: false,
        tabs: [tab(10, { active: true }), tab(0)],
      });

      await env.moves.menuClicked({ menuItemId: '1:2' }, tab(0));

      expect(await env.groupState.getTabGroup(0)).toBe(2);
    });

    describe('for the active tab', () => {
      it('shows the tab before it first, then sends it away', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10), tab(11, { active: true }), tab(12)],
        });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(11));

        expect(env.tabs.calls).toEqual(['activate 10', 'move 11']);
        expect(await env.groupState.getTabGroup(11)).toBe(2);
      });

      it('shows the tab after it when it is the first', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10, { active: true }), tab(11)],
        });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(10));

        expect(env.tabs.calls).toEqual(['activate 11', 'move 10']);
      });

      it('does not hand over to a tab of another group, which a browser that cannot hide tabs counts as visible', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10), tab(11, { active: true }), tab(12)],
          tabGroups: { 10: 3, 11: 1, 12: 1 },
        });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(11));

        expect(env.tabs.calls).toEqual(['activate 12', 'move 11']);
      });

      it('stays on the tab when no other tab of its group is there', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10), tab(11, { active: true })],
          tabGroups: { 10: 3, 11: 1 },
        });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(11));

        expect(env.tabs.calls).toEqual(['activate 11', 'move 11']);
      });

      it('hands a pinned tab over to a tab of the group the window shows, as a pinned tab is in none', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(9, { active: true, pinned: true }), tab(10), tab(11)],
          tabGroups: { 10: 1, 11: 1 },
        });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(9));

        expect(env.tabs.calls).toEqual(['activate 10', 'unpin 9', 'move 9']);
        expect(await env.groupState.getTabGroup(9)).toBe(2);
      });

      it('hands a pinned tab over to another pinned tab where the window shows no group', async () => {
        const env = await setUp({
          useNative: false,
          activeGroup: undefined,
          tabs: [
            tab(8, { pinned: true }),
            tab(9, { active: true, pinned: true }),
            tab(10),
          ],
          tabGroups: { 10: 1 },
        });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(9));

        expect(env.tabs.calls[0]).toBe('activate 8');
      });

      it('skips the tabs that are hidden', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(9), tab(10), tab(11, { active: true })],
        });
        await env.tabs.hide([10]);
        env.tabs.calls.length = 0;

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(11));

        expect(env.tabs.calls).toEqual(['activate 9', 'move 11']);
      });

      it('looks only at the tabs of its own window', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [
            tab(9, { windowId: 5 }),
            tab(10, { active: true }),
            tab(11),
            tab(12, { windowId: 5, active: true }),
          ],
        });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(10));

        expect(env.tabs.calls).toEqual(['activate 11', 'move 10']);
      });
    });

    describe('for a tab that is not the active one', () => {
      it('does not change which tab is active', async () => {
        const env = await setUp({ useNative: false });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(12));

        expect(env.tabs.calls).toEqual(['move 12']);
      });
    });

    describe('for several tabs that are selected', () => {
      it('sends all but the active tab, in order', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10, { active: true }), tab(11), tab(12), tab(13)],
          highlighted: [11, 12],
        });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(11));

        expect(env.tabs.calls).toEqual(['move 11', 'move 12']);
        expect(await env.groupState.getTabGroup(10)).toBeUndefined();
        expect(await env.groupState.getTabGroup(11)).toBe(2);
        expect(await env.groupState.getTabGroup(12)).toBe(2);
        expect(await env.groupState.getTabGroup(13)).toBeUndefined();
      });

      it('shows the active group after each tab, once the tab has moved', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10, { active: true }), tab(11), tab(12)],
          highlighted: [11, 12],
        });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(11));

        expect(env.order).toEqual(['toggle', 'toggle']);
      });

      it('does not take the selected tabs of other windows along', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [
            tab(10, { active: true }),
            tab(11),
            tab(20, { windowId: 5, active: true }),
          ],
        });

        await env.moves.menuClicked({ menuItemId: '1:2' }, tab(11));

        expect(env.tabs.calls).toEqual(['move 11']);
        expect(await env.groupState.getTabGroup(20)).toBeUndefined();
      });

      it('stops when moving a tab fails', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10, { active: true }), tab(11), tab(12)],
          highlighted: [11, 12],
        });
        const failure = new Error('gone');
        env.tabs.moveToEnd = () => Promise.reject(failure);

        await expect(
          env.moves.menuClicked({ menuItemId: '1:2' }, tab(11)),
        ).rejects.toBe(failure);

        expect(await env.groupState.getTabGroup(12)).toBeUndefined();
      });
    });
  });
});
