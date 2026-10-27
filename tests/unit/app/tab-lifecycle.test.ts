import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createNativeGroupAssignment } from '../../../src/js/app/native-group-assignment.js';
import {
  createTabLifecycle,
  type CreatedTab,
} from '../../../src/js/app/tab-lifecycle.js';
import type { OpeningView } from '../../../src/js/core/tab-assignment.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';

const WINDOW = 1;
const VIEW = 'moz-extension://id/view.html';

const group = (id: number, nativeGroupId?: number): Group => ({
  id,
  name: `G${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
  ...(nativeGroupId === undefined ? {} : { nativeGroupId }),
});

const details = (
  id: number,
  overrides: Partial<TabDetails> = {},
): TabDetails => ({
  id,
  windowId: WINDOW,
  active: false,
  pinned: false,
  url: `https://site${String(id)}/`,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId: undefined,
  ...overrides,
});

interface Options {
  groups?: Group[] | undefined;
  activeGroup?: number | undefined;
  tabs?: { tab: TabDetails; group?: number }[];
  nativeGroupIds?: number[];
  useNative?: boolean;
  openingBackup?: boolean;
  opening?: OpeningView | null;
  wait?: () => Promise<void>;
  nowMs?: number;
}

async function setUp(options: Options = {}) {
  // Given as undefined, groups and the active group mean there are none
  const groups = 'groups' in options ? options.groups : [group(1), group(2)];
  const activeGroup = 'activeGroup' in options ? options.activeGroup : 1;
  const {
    tabs: tabList = [],
    nativeGroupIds = [],
    useNative = true,
    openingBackup = false,
    opening = null,
    wait = () => Promise.resolve(),
    nowMs = 1000,
  } = options;
  const tabs = createMemoryTabs();
  tabs.setDetails(tabList.map((entry) => entry.tab));
  const groupState = createMemoryGroupState();
  if (groups !== undefined) {
    await groupState.setGroups(WINDOW, groups);
  }
  if (activeGroup !== undefined) {
    await groupState.setActiveGroup(WINDOW, activeGroup);
  }
  await Promise.all(
    tabList.flatMap(({ tab, group: groupId }) =>
      groupId === undefined ? [] : [groupState.setTabGroup(tab.id, groupId)],
    ),
  );
  const nativeGroups = createMemoryNativeGroups(nativeGroupIds, WINDOW);
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const windows = createMemoryWindows(WINDOW);
  const assignment = createNativeGroupAssignment({
    tabs,
    windows,
    groupState,
    nativeGroups,
    viewUrl: VIEW,
    logger,
  });
  const toggleVisibleTabs = vi.fn().mockResolvedValue(undefined);
  const finishOpeningView = vi.fn();
  const waitForInitialization = vi.fn(wait);
  const clock = createMemoryClock(nowMs);
  const lifecycle = createTabLifecycle({
    groupState,
    tabs,
    nativeGroups,
    assignment,
    toggleVisibleTabs,
    useNativeGroups: () => Promise.resolve(useNative),
    waitForInitialization,
    isOpeningBackup: () => openingBackup,
    openingView: () => opening,
    finishOpeningView,
    clock,
    viewUrl: VIEW,
    logger,
  });
  return {
    lifecycle,
    tabs,
    groupState,
    nativeGroups,
    logger,
    toggleVisibleTabs,
    finishOpeningView,
    waitForInitialization,
    clock,
  };
}

const created = (
  id: number,
  overrides: Partial<CreatedTab> = {},
): CreatedTab => ({
  id,
  windowId: WINDOW,
  active: false,
  url: `https://site${String(id)}/`,
  ...overrides,
});

describe('app/tab-lifecycle.ts', () => {
  describe('tabCreated', () => {
    it('does nothing while a backup is being opened', async () => {
      const env = await setUp({ openingBackup: true });

      await env.lifecycle.tabCreated(created(5, { active: true }));

      expect(env.waitForInitialization).not.toHaveBeenCalled();
      expect(await env.groupState.getTabGroup(5)).toBeUndefined();
      expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
    });

    it('waits for the extension to start up first', async () => {
      const order: string[] = [];
      const env = await setUp({
        wait: () => {
          order.push('waited');
          return Promise.resolve();
        },
      });
      const setTabGroup = env.groupState.setTabGroup.bind(env.groupState);
      env.groupState.setTabGroup = (tabId, groupId) => {
        order.push('assigned');
        return setTabGroup(tabId, groupId);
      };

      await env.lifecycle.tabCreated(created(5));

      expect(order).toEqual(['waited', 'assigned']);
    });

    describe('the view tab', () => {
      it.each([
        ['has its address', created(5, { url: VIEW })],
        [
          'is about to have its address',
          created(5, { url: undefined, pendingUrl: VIEW }),
        ],
      ])('is told by a tab that %s', async (_name, tab) => {
        const env = await setUp({ nativeGroupIds: [] });

        await env.lifecycle.tabCreated({ ...tab, active: true });

        expect(await env.groupState.getTabGroup(5)).toBe(-1);
        expect(env.finishOpeningView).toHaveBeenCalledTimes(1);
        expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.logger.debug).toHaveBeenCalledWith(
          'Created viewer tab 5, assigned groupId -1',
        );
      });

      it('is told by being the tab that was asked for', async () => {
        const env = await setUp({
          opening: { tabId: 5, windowId: 9, creationTimestamp: 0 },
        });

        await env.lifecycle.tabCreated(created(5, { active: true }));

        expect(await env.groupState.getTabGroup(5)).toBe(-1);
        expect(env.finishOpeningView).toHaveBeenCalledTimes(1);
      });

      it('is told by appearing in the window just after it was asked for', async () => {
        const env = await setUp({
          nowMs: 1000,
          opening: { tabId: 7, windowId: WINDOW, creationTimestamp: 950 },
        });

        await env.lifecycle.tabCreated(created(5));

        expect(await env.groupState.getTabGroup(5)).toBe(-1);
      });

      it('is judged by the time the tab appeared, not the time the wait ended', async () => {
        const env = await setUp({
          nowMs: 1000,
          opening: { tabId: 7, windowId: WINDOW, creationTimestamp: 950 },
          wait: () => {
            env.clock.advance(5000);
            return Promise.resolve();
          },
        });

        await env.lifecycle.tabCreated(created(5));

        expect(await env.groupState.getTabGroup(5)).toBe(-1);
      });

      it('is not told by an ordinary tab', async () => {
        const env = await setUp();

        await env.lifecycle.tabCreated(created(5));

        expect(await env.groupState.getTabGroup(5)).toBe(1);
        expect(env.finishOpeningView).not.toHaveBeenCalled();
      });
    });

    describe('which group a new tab is in', () => {
      it('is the active group of the window', async () => {
        const env = await setUp({ activeGroup: 2, useNative: false });

        await env.lifecycle.tabCreated(created(5));

        expect(await env.groupState.getTabGroup(5)).toBe(2);
        expect(env.logger.debug).toHaveBeenCalledWith(
          '[TabCreated] Tab 5 created in window 1, assigned to group 2',
        );
      });

      it('stays the one it came with', async () => {
        const env = await setUp({
          activeGroup: 1,
          useNative: false,
          tabs: [{ tab: details(5), group: 2 }],
        });

        await env.lifecycle.tabCreated(created(5));

        expect(await env.groupState.getTabGroup(5)).toBe(2);
        expect(env.logger.debug).toHaveBeenCalledWith(
          '[TabCreated] Tab 5 created in window 1, already has group 2',
        );
      });

      it('is the lowest numbered group when the window has no active group', async () => {
        const env = await setUp({
          activeGroup: undefined,
          groups: [group(4), group(3)],
          useNative: false,
        });

        await env.lifecycle.tabCreated(created(5));

        expect(await env.groupState.getTabGroup(5)).toBe(3);
        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(3);
        expect(env.logger.debug).toHaveBeenCalledWith(
          '[TabCreated] activeGroup is undefined for window 1, using fallback',
        );
      });

      it('is the first group when the window has no groups yet either', async () => {
        const env = await setUp({
          activeGroup: undefined,
          groups: undefined,
          useNative: false,
        });

        await env.lifecycle.tabCreated(created(5));

        expect(await env.groupState.getTabGroup(5)).toBe(0);
        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(0);
      });

      it('is the group 0 that is active, not the fallback', async () => {
        const env = await setUp({
          activeGroup: 0,
          groups: [group(0), group(3)],
          useNative: false,
        });

        await env.lifecycle.tabCreated(created(5));

        expect(await env.groupState.getTabGroup(5)).toBe(0);
        expect(env.logger.debug).not.toHaveBeenCalledWith(
          '[TabCreated] activeGroup is undefined for window 1, using fallback',
        );
      });
    });

    describe('without native groups', () => {
      it('does not make a native group for a group with tabs', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [
            { tab: details(5), group: 1 },
            { tab: details(6), group: 1 },
          ],
        });

        await env.lifecycle.tabCreated(created(5));

        expect(env.nativeGroups.calls).toEqual([]);
      });

      it('shows the group of a new tab that is active', async () => {
        const env = await setUp({ useNative: false, activeGroup: 2 });

        await env.lifecycle.tabCreated(created(5, { active: true }));

        expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
        expect(env.nativeGroups.calls).toEqual([]);
      });

      it('leaves the visibility alone for a tab in the background', async () => {
        const env = await setUp({ useNative: false });

        await env.lifecycle.tabCreated(created(5));

        expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
      });

      it('does not treat a missing active flag as active', async () => {
        const env = await setUp({ useNative: false });

        await env.lifecycle.tabCreated({ id: 5, windowId: WINDOW });

        expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
      });

      it('does not touch the visibility for a tab that is the view', async () => {
        const env = await setUp({
          useNative: false,
          tabs: [{ tab: details(5), group: -1 }],
        });

        await env.lifecycle.tabCreated(created(5, { active: true }));

        expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
      });
    });

    describe('with native groups, for a group that has none yet', () => {
      const twoTabs = [
        { tab: details(5), group: 1 },
        { tab: details(6), group: 1 },
      ];

      it('makes one from the tabs of the group and shows it for an active tab', async () => {
        const env = await setUp({ tabs: twoTabs });

        await env.lifecycle.tabCreated(created(5, { active: true }));

        expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([5, 6]);
        expect(
          (await env.groupState.getGroups(WINDOW))?.[0]?.nativeGroupId,
        ).toBe(1000);
        expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1);
      });

      it('shows it for a tab in the background when the group is the active one', async () => {
        const env = await setUp({ tabs: twoTabs, activeGroup: 1 });

        await env.lifecycle.tabCreated(created(5));

        expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1);
      });

      it('does not show it for a tab in the background of another group', async () => {
        const env = await setUp({ tabs: twoTabs, activeGroup: 2 });

        await env.lifecycle.tabCreated(created(5));

        expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([5, 6]);
        expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
      });

      it('shows the group once, not once more at the end', async () => {
        const env = await setUp({ tabs: twoTabs, activeGroup: 2 });

        await env.lifecycle.tabCreated(created(5, { active: true }));

        expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
      });

      it('shows the group of an active tab that is the only one there is', async () => {
        const env = await setUp({ tabs: [] });

        await env.lifecycle.tabCreated(created(5, { active: true }));

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1);
      });

      it('still shows the group of an active tab when grouping is not safe', async () => {
        const env = await setUp({ tabs: [{ tab: details(5), group: 1 }] });

        await env.lifecycle.tabCreated(created(5, { active: true }));

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1);
        expect(env.logger.debug).toHaveBeenCalledWith(
          '[TabCreated] Skipping native group creation: Would group only tab in window (window closure risk)',
        );
      });

      it('leaves the visibility alone for a tab in the background when grouping is not safe', async () => {
        const env = await setUp({ tabs: [{ tab: details(5), group: 1 }] });

        await env.lifecycle.tabCreated(created(5));

        expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
      });

      it('shows the group of an active tab although making the native group failed', async () => {
        const env = await setUp({ tabs: twoTabs });
        const failure = new Error('refused');
        env.nativeGroups.createFromTabs = () => Promise.reject(failure);

        await env.lifecycle.tabCreated(created(5, { active: true }));

        expect(env.logger.warn).toHaveBeenCalledWith(
          'Could not assign new tab to native group:',
          failure,
        );
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1);
      });

      it('does not show the group for a tab in the background when none of its tabs is there to group', async () => {
        const env = await setUp({ tabs: [], activeGroup: 1 });
        await env.groupState.setTabGroup(5, 1);

        await env.lifecycle.tabCreated(created(5));

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
      });

      it('does nothing for a group that is not known', async () => {
        const env = await setUp({ tabs: twoTabs, groups: [group(2)] });

        await env.lifecycle.tabCreated(created(5));

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.logger.debug).toHaveBeenCalledWith(
          'Skipped native group assignment for tab 5: group inactive (will be grouped when activated)',
        );
      });

      it('does nothing for a window whose groups were never stored', async () => {
        const env = await setUp({ tabs: twoTabs, groups: undefined });

        await env.lifecycle.tabCreated(created(5));

        expect(env.nativeGroups.calls).toEqual([]);
      });
    });

    describe('with native groups, for a group that has one', () => {
      const setUpWithNative = (extra: Options = {}) =>
        setUp({
          groups: [group(1, 50), group(2, 60)],
          nativeGroupIds: [50, 60],
          tabs: [{ tab: details(5), group: 1 }],
          activeGroup: 1,
          ...extra,
        });

      it('puts the tab in it when the group is the active one', async () => {
        const env = await setUpWithNative();

        await env.lifecycle.tabCreated(created(5));

        expect(await env.nativeGroups.tabIdsIn(50)).toEqual([5]);
        expect(env.nativeGroups.calls).toEqual(['add 5 to 50']);
        expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
        expect(env.logger.debug).toHaveBeenCalledWith(
          'Assigned tab 5 to native group 50 (group 1)',
        );
      });

      it('shows the group when that tab is active', async () => {
        const env = await setUpWithNative();

        await env.lifecycle.tabCreated(created(5, { active: true }));

        expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1);
      });

      it('leaves the tab out of it when the group is not the active one', async () => {
        const env = await setUpWithNative({ activeGroup: 2 });

        await env.lifecycle.tabCreated(created(5));

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
      });

      it('still shows the group of an active tab when it is not the active one', async () => {
        const env = await setUpWithNative({ activeGroup: 2 });

        await env.lifecycle.tabCreated(created(5, { active: true }));

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(1);
      });

      it('does not take a native group with the id 0 for one', async () => {
        const env = await setUp({
          groups: [group(1, 0)],
          tabs: [
            { tab: details(5), group: 1 },
            { tab: details(6), group: 1 },
          ],
        });

        await env.lifecycle.tabCreated(created(5));

        expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([5, 6]);
      });
    });
  });

  describe('tabAttached', () => {
    it('puts the tab in the group the new window is showing, then treats it as created', async () => {
      const env = await setUp({
        activeGroup: 2,
        useNative: false,
        tabs: [{ tab: details(5, { active: true }), group: 1 }],
      });

      await env.lifecycle.tabAttached(5, { newWindowId: WINDOW });

      expect(await env.groupState.getTabGroup(5)).toBe(2);
      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
    });

    it('waits for the extension to start up first', async () => {
      const env = await setUp({
        useNative: false,
        tabs: [{ tab: details(5) }],
      });

      await env.lifecycle.tabAttached(5, { newWindowId: WINDOW });

      expect(env.waitForInitialization).toHaveBeenCalledTimes(2);
    });

    it('leaves the group alone when the new window has no active group', async () => {
      const env = await setUp({
        activeGroup: undefined,
        useNative: false,
        tabs: [{ tab: details(5), group: 2 }],
      });

      await env.lifecycle.tabAttached(5, { newWindowId: WINDOW });

      expect(await env.groupState.getTabGroup(5)).toBe(2);
    });

    it('fails when the tab is gone', async () => {
      const env = await setUp({ useNative: false });

      await expect(
        env.lifecycle.tabAttached(5, { newWindowId: WINDOW }),
      ).rejects.toThrow('Invalid tab ID: 5');
    });
  });

  describe('tabDetached', () => {
    it('forgets the group of the tab', async () => {
      const env = await setUp({ tabs: [{ tab: details(5), group: 1 }] });

      await env.lifecycle.tabDetached(5);

      expect(await env.groupState.getTabGroup(5)).toBeUndefined();
    });

    it('leaves other tabs alone', async () => {
      const env = await setUp({
        tabs: [
          { tab: details(5), group: 1 },
          { tab: details(6), group: 1 },
        ],
      });

      await env.lifecycle.tabDetached(5);

      expect(await env.groupState.getTabGroup(6)).toBe(1);
    });
  });

  describe('tabActivated', () => {
    it('waits for the extension to start up first', async () => {
      const env = await setUp({ tabs: [{ tab: details(5), group: 1 }] });

      await env.lifecycle.tabActivated({ tabId: 5 });

      expect(env.waitForInitialization).toHaveBeenCalledTimes(1);
    });

    it('leaves a pinned tab alone', async () => {
      const env = await setUp({
        tabs: [{ tab: details(5, { pinned: true }), group: 2 }],
      });

      await env.lifecycle.tabActivated({ tabId: 5 });

      expect(await env.groupState.getActiveGroup(WINDOW)).toBe(1);
      expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
    });

    it('leaves a tab that has no group yet to tabCreated, and notes it without a warning', async () => {
      const env = await setUp({ tabs: [{ tab: details(5) }] });

      await env.lifecycle.tabActivated({ tabId: 5 });

      expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[TabActivated] Tab 5 has no group yet; tabCreated will show its group',
      );
      expect(env.logger.warn).not.toHaveBeenCalled();
      expect(env.logger.error).not.toHaveBeenCalled();
    });

    it('shows the group of a new tab that is activated before it has one, once tabCreated has given it one', async () => {
      const env = await setUp({
        tabs: [{ tab: details(5, { active: true }) }],
      });

      await env.lifecycle.tabActivated({ tabId: 5 });
      await env.lifecycle.tabCreated(details(5, { active: true }));

      expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
    });

    it('only shows the groups of the view tab, without changing the active group', async () => {
      const env = await setUp({
        tabs: [{ tab: details(5, { url: VIEW }), group: -1 }],
      });

      await env.lifecycle.tabActivated({ tabId: 5 });

      expect(await env.groupState.getActiveGroup(WINDOW)).toBe(1);
      expect(env.nativeGroups.calls).toEqual([]);
      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(-1);
    });

    it('makes the group of the tab the active group of its window and shows it', async () => {
      const env = await setUp({
        useNative: false,
        tabs: [{ tab: details(5), group: 2 }],
      });

      await env.lifecycle.tabActivated({ tabId: 5 });

      expect(await env.groupState.getActiveGroup(WINDOW)).toBe(2);
      expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
    });

    it('carries on when the active group cannot be stored', async () => {
      const env = await setUp({
        useNative: false,
        tabs: [{ tab: details(5), group: 2 }],
      });
      const failure = new Error('storage full');
      env.groupState.setActiveGroup = () => Promise.reject(failure);

      await env.lifecycle.tabActivated({ tabId: 5 });

      expect(env.logger.error).toHaveBeenCalledWith(
        '[TabActivated] ERROR in setActiveGroup(1, 2):',
        failure,
      );
      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
    });

    describe('with native groups', () => {
      const twoTabs = [
        { tab: details(5), group: 2 },
        { tab: details(6), group: 2 },
      ];

      it('does not look for or make native groups when they are switched off', async () => {
        const env = await setUp({ tabs: twoTabs, useNative: false });

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
      });

      it('makes a native group for a group that has none', async () => {
        const env = await setUp({ tabs: twoTabs });

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([5, 6]);
        expect(
          (await env.groupState.getGroups(WINDOW))?.[1]?.nativeGroupId,
        ).toBe(1000);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
      });

      it('links the native group the tab is already in instead', async () => {
        const env = await setUp({ tabs: twoTabs, nativeGroupIds: [70, 71] });
        env.nativeGroups.seed(71, WINDOW, [5]);

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(env.nativeGroups.calls).toEqual([]);
        expect(
          (await env.groupState.getGroups(WINDOW))?.map((g) => g.nativeGroupId),
        ).toEqual([undefined, 71]);
        expect(env.logger.debug).toHaveBeenCalledWith(
          'Linked existing native group 71 to group 2',
        );
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
      });

      it('does not link a native group that another group already has', async () => {
        const env = await setUp({
          groups: [group(1, 71), group(2)],
          tabs: twoTabs,
          nativeGroupIds: [71],
        });
        env.nativeGroups.seed(71, WINDOW, [5]);

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(
          (await env.groupState.getGroups(WINDOW))?.map((g) => g.nativeGroupId),
        ).toEqual([71, 1000]);
        expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([5, 6]);
        expect(await env.nativeGroups.tabIdsIn(71)).toEqual([]);
      });

      it('links an unclaimed native group even when another is claimed', async () => {
        const env = await setUp({
          groups: [group(1, 71), group(2)],
          tabs: twoTabs,
          nativeGroupIds: [71, 72],
        });
        env.nativeGroups.seed(72, WINDOW, [5]);

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(
          (await env.groupState.getGroups(WINDOW))?.map((g) => g.nativeGroupId),
        ).toEqual([71, 72]);
      });

      it('finds the tab in the native groups of its own window only', async () => {
        const env = await setUp({ tabs: twoTabs });
        env.nativeGroups.seed(71, 9, [5]);

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([5, 6]);
      });

      it('does not look for native groups when the group has one', async () => {
        const env = await setUp({
          groups: [group(1), group(2, 60)],
          nativeGroupIds: [60],
          tabs: twoTabs,
        });

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
      });

      it('treats a native group with the id 0 as none', async () => {
        const env = await setUp({
          groups: [group(1), group(2, 0)],
          tabs: twoTabs,
        });

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([5, 6]);
      });

      it('shows the group even when it is not known', async () => {
        const env = await setUp({ groups: [group(1)], tabs: twoTabs });

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
      });

      it('shows the group even when the window has no groups stored', async () => {
        const env = await setUp({ groups: undefined, tabs: twoTabs });

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
      });

      it('still shows the group when grouping is not safe', async () => {
        const env = await setUp({ tabs: [{ tab: details(5), group: 2 }] });

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(env.nativeGroups.calls).toEqual([]);
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
        expect(await env.groupState.getActiveGroup(WINDOW)).toBe(2);
        expect(env.logger.debug).toHaveBeenCalledWith(
          '[TabActivated] Skipping native group creation: Would group only tab in window (window closure risk)',
        );
      });

      it('shows the group when no tab of it is there to group', async () => {
        const env = await setUp({ tabs: [{ tab: details(5), group: 2 }] });
        env.tabs.setDetails([]);

        await env.lifecycle.tabActivated({ tabId: 5 }).catch(() => undefined);

        expect(env.nativeGroups.calls).toEqual([]);
      });

      it('carries on when the native group cannot be made', async () => {
        const env = await setUp({ tabs: twoTabs });
        const failure = new Error('refused');
        env.nativeGroups.createFromTabs = () => Promise.reject(failure);

        await env.lifecycle.tabActivated({ tabId: 5 });

        expect(env.logger.warn).toHaveBeenCalledWith(
          '[TabActivated] Could not create native tab group in window 1:',
          failure,
        );
        expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2);
      });
    });
  });
});
