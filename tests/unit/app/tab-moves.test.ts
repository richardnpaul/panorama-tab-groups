import { describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMenus } from '../../../src/js/adapters/memory/menus.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createNativeGroupAssignment } from '../../../src/js/app/native-group-assignment.js';
import { createTabMoves } from '../../../src/js/app/tab-moves.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';
import { englishMessage } from '../../support/messages.js';

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
  await groupState.setGroups(WINDOW, groups);
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
    logger,
  });
  return {
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

      await env.moves.menuClicked({ menuItemId: '2' }, tab(11));

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

    it('puts the tab in the native group of the group when that is the active one', async () => {
      const env = await setUp({ activeGroup: 2 });

      await env.moves.moveTab(11, 2);

      expect(env.nativeGroups.calls).toEqual(['add 11 to 60']);
      expect(await env.nativeGroups.tabIdsIn(60)).toEqual([11]);
    });

    it('takes the tab out of native groups when the group is not the active one', async () => {
      const env = await setUp({ activeGroup: 1 });
      env.nativeGroups.seed(60, WINDOW, [11]);

      await env.moves.moveTab(11, 2);

      expect(env.nativeGroups.calls).toEqual(['remove 11']);
      expect(await env.nativeGroups.tabIdsIn(60)).toEqual([]);
    });

    it('takes the tab out of the native group it was in when the group it goes to has none, so it is not in a group of another', async () => {
      const env = await setUp({ activeGroup: 3 });

      await env.moves.moveTab(11, 3);

      expect(env.nativeGroups.calls).toEqual(['remove 11']);
    });

    it('takes the tab out of its native group for a group that is not known, which has no native group', async () => {
      const env = await setUp({ activeGroup: 9 });

      await env.moves.moveTab(11, 9);

      expect(env.nativeGroups.calls).toEqual(['remove 11']);
    });

    it('treats a native group with the id 0 as none', async () => {
      const env = await setUp({ groups: [group(1, 0)], activeGroup: 1 });

      await env.moves.moveTab(11, 1);

      expect(env.nativeGroups.calls).toEqual(['remove 11']);
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

      it('does not treat a tab that stays in the shown group as one that switched it, and so makes no native group', async () => {
        const env = await setUp({
          ...onlyShown,
          groups: [group(1), group(2, 60)],
        });

        await env.moves.moveTab(10, 1);

        expect(env.nativeGroups.calls).toEqual(['remove 10']);
        expect(env.logger.debug).not.toHaveBeenCalled();
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

    it.each([['send-tab'], ['']])(
      'ignores a click on the item %j, which is no group',
      async (menuItemId) => {
        const env = await setUp();

        await env.moves.menuClicked({ menuItemId }, tab(11));

        expect(env.tabs.calls).toEqual([]);
        expect(env.createMenuList).not.toHaveBeenCalled();
        expect(env.logger.debug).toHaveBeenCalledWith(
          `Ignored a click on the menu item ${menuItemId}`,
        );
      },
    );

    it('ignores a click that is not on a tab', async () => {
      const env = await setUp();

      await env.moves.menuClicked({ menuItemId: '2' }, undefined);

      expect(env.tabs.calls).toEqual([]);
      expect(await env.groupState.getTabGroup(11)).toBeUndefined();
    });

    it('ignores a tab that has no id or no window', async () => {
      const env = await setUp();

      await env.moves.menuClicked({ menuItemId: '2' }, { windowId: WINDOW });
      await env.moves.menuClicked({ menuItemId: '2' }, { id: 11 });

      expect(env.tabs.calls).toEqual([]);
    });

    it('sends the tab that was clicked to the group', async () => {
      const env = await setUp({ useNative: false });

      await env.moves.menuClicked({ menuItemId: '2' }, tab(11));

      expect(await env.groupState.getTabGroup(11)).toBe(2);
      expect(env.tabs.calls).toEqual(['move 11']);
    });

    it('sends the tab with the id 0 as well', async () => {
      const env = await setUp({
        useNative: false,
        tabs: [tab(10, { active: true }), tab(0)],
      });

      await env.moves.menuClicked({ menuItemId: '2' }, tab(0));

      expect(await env.groupState.getTabGroup(0)).toBe(2);
    });

    it('sends the group by its number, whether it is a number or text', async () => {
      const env = await setUp({ useNative: false });

      await env.moves.menuClicked({ menuItemId: 3 }, tab(11));

      expect(await env.groupState.getTabGroup(11)).toBe(3);
    });

    describe('for the active tab', () => {
      it('shows the tab before it first, then sends it away', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10), tab(11, { active: true }), tab(12)],
        });

        await env.moves.menuClicked({ menuItemId: '2' }, tab(11));

        expect(env.tabs.calls).toEqual(['activate 10', 'move 11']);
        expect(await env.groupState.getTabGroup(11)).toBe(2);
      });

      it('shows the tab after it when it is the first', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10, { active: true }), tab(11)],
        });

        await env.moves.menuClicked({ menuItemId: '2' }, tab(10));

        expect(env.tabs.calls).toEqual(['activate 11', 'move 10']);
      });

      it('does not hand over to a tab of another group, which a browser that cannot hide tabs counts as visible', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10), tab(11, { active: true }), tab(12)],
          tabGroups: { 10: 3, 11: 1, 12: 1 },
        });

        await env.moves.menuClicked({ menuItemId: '2' }, tab(11));

        expect(env.tabs.calls).toEqual(['activate 12', 'move 11']);
      });

      it('stays on the tab when no other tab of its group is there', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(10), tab(11, { active: true })],
          tabGroups: { 10: 3, 11: 1 },
        });

        await env.moves.menuClicked({ menuItemId: '2' }, tab(11));

        expect(env.tabs.calls).toEqual(['activate 11', 'move 11']);
      });

      it('skips the tabs that are hidden', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [tab(9), tab(10), tab(11, { active: true })],
        });
        await env.tabs.hide([10]);
        env.tabs.calls.length = 0;

        await env.moves.menuClicked({ menuItemId: '2' }, tab(11));

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

        await env.moves.menuClicked({ menuItemId: '2' }, tab(10));

        expect(env.tabs.calls).toEqual(['activate 11', 'move 10']);
      });
    });

    describe('for a tab that is not the active one', () => {
      it('does not change which tab is active', async () => {
        const env = await setUp({ useNative: false });

        await env.moves.menuClicked({ menuItemId: '2' }, tab(12));

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

        await env.moves.menuClicked({ menuItemId: '2' }, tab(11));

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

        await env.moves.menuClicked({ menuItemId: '2' }, tab(11));

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

        await env.moves.menuClicked({ menuItemId: '2' }, tab(11));

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
          env.moves.menuClicked({ menuItemId: '2' }, tab(11)),
        ).rejects.toBe(failure);

        expect(await env.groupState.getTabGroup(12)).toBeUndefined();
      });
    });
  });
});
