import { describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import {
  createVisibilityService,
  type VisibilityDeps,
} from '../../../src/js/app/visibility-service.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { TabSummary } from '../../../src/js/ports/tabs.js';

const WINDOW = 3;
const FOCUSED = 8;

const tab = (id: number, extra: Partial<TabSummary> = {}): TabSummary => ({
  id,
  pinned: false,
  lastAccessed: 0,
  ...extra,
});

const group = (id: number, nativeGroupId?: number): Group => ({
  id,
  name: `Group ${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
  ...(nativeGroupId === undefined ? {} : { nativeGroupId }),
});

interface Options {
  tabs?: TabSummary[];
  tabGroups?: Record<number, number>;
  groups?: Group[];
  nativeIds?: number[];
  canHideTabs?: boolean;
  useNativeGroups?: boolean;
}

async function setUp({
  tabs: windowTabs = [],
  tabGroups = {},
  groups = [group(1, 101), group(2, 102)],
  nativeIds = [101, 102],
  canHideTabs = true,
  useNativeGroups = true,
}: Options = {}) {
  const groupState = createMemoryGroupState();
  await groupState.setGroups(WINDOW, groups);
  await Promise.all(
    Object.entries(tabGroups).map(([id, groupId]) =>
      groupState.setTabGroup(Number(id), groupId),
    ),
  );
  const tabs = createMemoryTabs(windowTabs);
  const nativeGroups = createMemoryNativeGroups(nativeIds);
  const logger = { warn: vi.fn(), error: vi.fn() };
  const updateActionTitle = vi.fn().mockResolvedValue(undefined);
  const useNative = vi.fn().mockResolvedValue(useNativeGroups);

  // One list of what happened, to check the order across the different parts
  const order: string[] = [];
  let listings = 0;
  // The windows whose tabs were asked for by their id
  const windowsListed: number[] = [];
  const deps: VisibilityDeps = {
    tabs: {
      listInCurrentWindow: () => {
        listings += 1;
        return tabs.listInCurrentWindow();
      },
      // The fake knows the tabs of one window, which are the ones to hide and show here
      listSummariesInWindow: (windowId) => {
        windowsListed.push(windowId);
        return tabs.listInCurrentWindow();
      },
      activate: async (tabId) => {
        order.push(`activate ${String(tabId)}`);
        await tabs.activate(tabId);
      },
      hide: async (tabIds) => {
        order.push(`hide ${tabIds.join(',')}`);
        await tabs.hide(tabIds);
      },
      show: async (tabIds) => {
        order.push(`show ${tabIds.join(',')}`);
        await tabs.show(tabIds);
      },
    },
    windows: createMemoryWindows(WINDOW, FOCUSED),
    groupState,
    nativeGroups: {
      ...nativeGroups,
      setCollapsed: async (nativeGroupId, collapsed) => {
        order.push(`collapsed ${String(nativeGroupId)},${String(collapsed)}`);
        await nativeGroups.setCollapsed(nativeGroupId, collapsed);
      },
    },
    toolbar: { updateActionTitle },
    canHideTabs,
    useNativeGroups: useNative,
    logger,
  };

  return {
    service: createVisibilityService(deps),
    deps,
    tabs,
    nativeGroups,
    logger,
    updateActionTitle,
    useNative,
    order,
    listings: () => listings,
    windowsListed,
    getTabGroup: vi.spyOn(groupState, 'getTabGroup'),
    getGroups: vi.spyOn(groupState, 'getGroups'),
    groupState,
  };
}

describe('app/visibility-service.ts', () => {
  describe('an active group that cannot be switched to', () => {
    it('does nothing at all when there is none', async () => {
      const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: 1 } });

      await ctx.service.toggleVisibleTabs(undefined);

      expect(ctx.listings()).toBe(0);
      expect(ctx.order).toEqual([]);
      expect(ctx.updateActionTitle).not.toHaveBeenCalled();
      expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        '[ToggleVisibleTabs] activeGroup is undefined, so no tab is hidden or shown',
      );
    });

    it.each(['invalid', -2, 1.5, NaN, null])(
      'does nothing, and says why, for %j',
      async (value) => {
        const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: 1 } });

        await ctx.service.toggleVisibleTabs(value);

        expect(ctx.listings()).toBe(0);
        expect(ctx.order).toEqual([]);
        expect(ctx.logger.error).toHaveBeenCalledTimes(1);
        expect(ctx.logger.error).toHaveBeenCalledWith(
          `[ToggleVisibleTabs] Invalid activeGroup: ${String(value)} - must be -1 or positive integer`,
        );
      },
    );
  });

  describe('switching to a group', () => {
    it('hides the tabs of the other groups and shows the tabs of the group', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2), tab(3), tab(4, { pinned: true })],
        tabGroups: { 1: 1, 2: 2, 3: 1, 4: 2 },
      });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.tabs.calls).toEqual(['hide 2', 'show 1,3']);
    });

    it('collapses the other native groups, and expands the one of the group', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.nativeGroups.collapsed.get(102)).toBe(true);
      expect(ctx.nativeGroups.collapsed.get(101)).toBe(false);
    });

    it('collapses before it hides, and shows before it expands', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });
      await ctx.nativeGroups.setCollapsed(101, true);
      ctx.nativeGroups.calls.length = 0;

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.order).toEqual([
        'collapsed 102,true',
        'hide 2',
        'show 1',
        'collapsed 101,false',
      ]);
    });

    it('looks at the tabs and groups of the current window', async () => {
      const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: 1 } });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.getGroups).toHaveBeenCalledWith(WINDOW);
    });

    it('does not look up the group of a pinned tab', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2, { pinned: true })],
        tabGroups: { 1: 1, 2: 1 },
      });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.getTabGroup.mock.calls).toEqual([[1]]);
    });

    it('treats the view tab as part of the view group', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: -1, 2: 1 },
      });

      await ctx.service.toggleVisibleTabs(-1);
      expect(ctx.tabs.calls).toEqual(['hide 2', 'show 1']);
    });

    it('hides the view tab when a group is active', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: -1, 2: 1 },
      });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.tabs.calls).toEqual(['hide 1', 'show 2']);
    });

    it('hides a tab that has no group', async () => {
      const ctx = await setUp({ tabs: [tab(1), tab(2)], tabGroups: { 2: 1 } });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.tabs.calls).toEqual(['hide 1', 'show 2']);
    });

    it('skips a tab whose group cannot be read, as it has probably been closed', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2), tab(3)],
        tabGroups: { 1: 1, 2: 2, 3: 1 },
      });
      ctx.getTabGroup.mockImplementation(async (tabId) => {
        if (tabId === 3) {
          throw new Error('No tab with id: 3');
        }
        return Promise.resolve(tabId === 2 ? 2 : 1);
      });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.tabs.calls).toEqual(['hide 2', 'show 1']);
    });
  });

  describe('when no tab would be left', () => {
    it('changes nothing, and says so, instead of hiding every tab', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 1 },
      });

      await ctx.service.toggleVisibleTabs(2, true);

      expect(ctx.order).toEqual([]);
      expect(ctx.updateActionTitle).not.toHaveBeenCalled();
      expect(ctx.logger.error).toHaveBeenCalledTimes(1);
      expect(ctx.logger.error).toHaveBeenCalledWith(
        '[ToggleVisibleTabs] ERROR: No tabs will be shown! All 2 tabs would be hidden (activeGroup=2), so nothing is changed',
      );
    });
  });

  describe('no tab selected', () => {
    it('activates the shown tab used most recently, before anything else', async () => {
      const ctx = await setUp({
        tabs: [
          tab(1, { lastAccessed: 100 }),
          tab(2, { lastAccessed: 200 }),
          tab(3, { lastAccessed: 300 }),
          tab(4, { pinned: true }),
        ],
        tabGroups: { 1: 1, 2: 2, 3: 1, 4: 2 },
      });

      await ctx.service.toggleVisibleTabs(1, true);

      expect(ctx.order[0]).toBe('activate 3');
      expect(ctx.tabs.calls).toEqual(['activate 3', 'hide 2', 'show 1,3']);
    });

    it('activates nothing when the window has nothing to show, instead of failing', async () => {
      const ctx = await setUp({ tabs: [], tabGroups: {} });

      await expect(
        ctx.service.toggleVisibleTabs(1, true),
      ).resolves.toBeUndefined();

      expect(ctx.tabs.calls).toEqual([]);
      expect(ctx.logger.error).not.toHaveBeenCalled();
    });

    it('activates nothing when only pinned tabs are in the window', async () => {
      const ctx = await setUp({ tabs: [tab(1, { pinned: true })] });

      await ctx.service.toggleVisibleTabs(1, true);

      expect(ctx.tabs.calls).toEqual([]);
    });

    it('does not activate a tab when a tab is selected', async () => {
      const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: 1 } });

      await ctx.service.toggleVisibleTabs(1);
      await ctx.service.toggleVisibleTabs(1, false);

      expect(ctx.tabs.calls.some((call) => call.startsWith('activate'))).toBe(
        false,
      );
    });
  });

  describe('a browser that cannot hide tabs', () => {
    it('does not hide or show tabs, but still collapses and expands native groups', async () => {
      const ctx = await setUp({
        canHideTabs: false,
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.tabs.calls).toEqual([]);
      expect(ctx.nativeGroups.collapsed.get(102)).toBe(true);
    });
  });

  describe('when native groups are not in use', () => {
    it('does not read the groups or touch native groups', async () => {
      const ctx = await setUp({
        useNativeGroups: false,
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.getGroups).not.toHaveBeenCalled();
      expect(ctx.nativeGroups.calls).toEqual([]);
      expect(ctx.tabs.calls).toEqual(['hide 2', 'show 1']);
    });

    it('treats a window whose groups were never stored as having no native groups', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });
      ctx.getGroups.mockResolvedValue(undefined);

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.nativeGroups.calls).toEqual([]);
      expect(ctx.tabs.calls).toEqual(['hide 2', 'show 1']);
    });

    it('asks once whether they are in use', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.useNative).toHaveBeenCalledTimes(1);
    });
  });

  describe('native groups that cannot be changed', () => {
    it('carries on when a group to collapse no longer exists', async () => {
      const ctx = await setUp({
        nativeIds: [101],
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });

      await expect(ctx.service.toggleVisibleTabs(1)).resolves.toBeUndefined();

      expect(ctx.tabs.calls).toEqual(['hide 2', 'show 1']);
    });

    it('carries on when the group to expand no longer exists', async () => {
      const ctx = await setUp({
        nativeIds: [102],
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.updateActionTitle).toHaveBeenCalledTimes(1);
    });

    it('still collapses the others when one cannot be collapsed', async () => {
      const ctx = await setUp({
        groups: [group(1, 101), group(2, 102), group(3, 103)],
        nativeIds: [101, 103],
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.nativeGroups.collapsed.get(103)).toBe(true);
    });
  });

  describe('failures that are not ignored', () => {
    it('passes on a failure to hide the tabs', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });
      const failure = new Error('cannot hide');
      const service = createVisibilityService({
        ...ctx.deps,
        tabs: { ...ctx.deps.tabs, hide: () => Promise.reject(failure) },
      });

      await expect(service.toggleVisibleTabs(1)).rejects.toBe(failure);
    });

    it('passes on a failure to show the tabs', async () => {
      const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: 1 } });
      const failure = new Error('cannot show');
      const service = createVisibilityService({
        ...ctx.deps,
        tabs: { ...ctx.deps.tabs, show: () => Promise.reject(failure) },
      });

      await expect(service.toggleVisibleTabs(1)).rejects.toBe(failure);
    });

    it('passes on a failure to activate a tab', async () => {
      const ctx = await setUp({
        tabs: [tab(1, { lastAccessed: 5 })],
        tabGroups: { 1: 1 },
      });
      const failure = new Error('no such tab');
      const service = createVisibilityService({
        ...ctx.deps,
        tabs: { ...ctx.deps.tabs, activate: () => Promise.reject(failure) },
      });

      await expect(service.toggleVisibleTabs(1, true)).rejects.toBe(failure);
    });
  });

  describe('a window that is said', () => {
    // The browser's events say which window they are about; the window the user is in may be another
    it('works on the tabs of that window, not of the one the user is in', async () => {
      const ctx = await setUp({
        tabs: [tab(1), tab(2)],
        tabGroups: { 1: 1, 2: 2 },
      });

      await ctx.service.toggleVisibleTabs(1, false, 5);

      expect(ctx.windowsListed).toEqual([5]);
      expect(ctx.listings()).toBe(0);
      expect(ctx.order).toContain('hide 2');
    });

    it('reads the groups of that window, for the native groups to follow', async () => {
      const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: 1 } });

      await ctx.service.toggleVisibleTabs(1, false, 5);

      expect(ctx.getGroups).toHaveBeenCalledWith(5);
      expect(ctx.getGroups).not.toHaveBeenCalledWith(WINDOW);
    });

    it('works on the window the user is in when none is said', async () => {
      const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: 1 } });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.windowsListed).toEqual([]);
      expect(ctx.listings()).toBe(1);
      expect(ctx.getGroups).toHaveBeenCalledWith(WINDOW);
    });

    it('shows the group in the toolbar of that window, not of the window used last', async () => {
      const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: 2 } });

      await ctx.service.toggleVisibleTabs(2, false, 5);

      expect(ctx.updateActionTitle).toHaveBeenCalledTimes(1);
      expect(ctx.updateActionTitle).toHaveBeenCalledWith(5, 2);
    });
  });

  describe('the toolbar', () => {
    it('shows the group in the window used last, once the tabs are switched', async () => {
      const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: 2 } });

      await ctx.service.toggleVisibleTabs(2);

      expect(ctx.updateActionTitle).toHaveBeenCalledTimes(1);
      expect(ctx.updateActionTitle).toHaveBeenCalledWith(FOCUSED, 2);
      expect(ctx.order).toEqual(['show 1', 'collapsed 102,false']);
    });

    it('shows group 0', async () => {
      const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: 0 } });

      await ctx.service.toggleVisibleTabs(0);

      expect(ctx.updateActionTitle).toHaveBeenCalledWith(FOCUSED, 0);
    });

    it('is left alone while the view is active', async () => {
      const ctx = await setUp({ tabs: [tab(1)], tabGroups: { 1: -1 } });

      await ctx.service.toggleVisibleTabs(-1);

      expect(ctx.updateActionTitle).not.toHaveBeenCalled();
    });

    it('is updated even when there are no tabs to switch', async () => {
      const ctx = await setUp({ tabs: [] });

      await ctx.service.toggleVisibleTabs(1);

      expect(ctx.updateActionTitle).toHaveBeenCalledWith(FOCUSED, 1);
    });
  });
});
