import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMenus } from '../../../src/js/adapters/memory/menus.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createGroupDeletion } from '../../../src/js/app/delete-group.js';
import { createOwnMoves } from '../../../src/js/app/own-moves.js';
import { createToolbarService } from '../../../src/js/app/toolbar-service.js';
import { createWindowGroups } from '../../../src/js/app/window-groups.js';
import { createMemoryToolbar } from '../../../src/js/adapters/memory/toolbar.js';
import type { GroupDeletionRequest } from '../../../src/js/core/messages.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';

const WINDOW = 1;

const group = (id: number): Group => ({
  id,
  name: `G${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

const tab = (id: number, browserGroupId?: number): TabDetails => ({
  id,
  windowId: WINDOW,
  active: false,
  pinned: false,
  url: undefined,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId,
});

async function setUp({ hasTabGroups = true }: { hasTabGroups?: boolean } = {}) {
  const clock = createMemoryClock(5);
  const groupState = createMemoryGroupState();
  await groupState.setGroups(WINDOW, [group(1), group(2)]);
  const tabs = createMemoryTabs();
  tabs.setDetails([tab(10, 50), tab(11, 50), tab(12, 60), tab(13)]);
  const nativeGroups = createMemoryNativeGroups([50, 60], WINDOW);
  nativeGroups.seed(50, WINDOW, [10, 11]);
  const menus = createMemoryMenus();
  menus.create({ id: '1', title: 'G1', contexts: ['tab'] });
  menus.create({ id: '2', title: 'G2', contexts: ['tab'] });
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const windowGroups = createWindowGroups({
    groupState,
    windows: createMemoryWindows(WINDOW),
    i18n: { getMessage: () => 'Group ' },
    clock,
    toolbar: createToolbarService({
      groupState,
      toolbar: createMemoryToolbar(),
      logger,
    }),
    waitForInitialization: () => Promise.resolve(),
    isOpeningBackup: () => false,
    rebuildWindow: () => Promise.resolve(false),
    logger,
  });
  const toggleVisibleTabs = vi.fn().mockResolvedValue(undefined);
  const ownMoves = createOwnMoves();
  return {
    deleteGroup: createGroupDeletion({
      tabs,
      nativeGroups,
      groupState,
      windowGroups,
      menus,
      hasTabGroups,
      toggleVisibleTabs,
      ownMoves,
      logger,
    }),
    ownMoves,
    toggleVisibleTabs,
    groupState,
    tabs,
    nativeGroups,
    menus,
    logger,
  };
}

type Env = Awaited<ReturnType<typeof setUp>>;

const request = (
  overrides: Partial<GroupDeletionRequest> = {},
): GroupDeletionRequest => ({
  groupId: 1,
  windowId: WINDOW,
  nativeGroupId: 50,
  tabIds: [10, 11],
  ...overrides,
});

const remainingIds = async (env: Env) =>
  (await env.tabs.listInWindow(WINDOW)).map(({ id }) => id);

describe('app/delete-group.ts', () => {
  it('takes the tabs out of the native group, closes them, forgets the group and removes its menu item', async () => {
    const env = await setUp();

    await expect(env.deleteGroup(request())).resolves.toEqual({
      success: true,
    });

    expect(env.nativeGroups.calls).toEqual(['remove 10,11']);
    expect(await remainingIds(env)).toEqual([12, 13]);
    expect((await env.groupState.getGroups(WINDOW))?.map((g) => g.id)).toEqual([
      2,
    ]);
    expect(env.menus.items.map((item) => item.id)).toEqual(['2']);
  });

  it('takes out only the tabs that are still in the native group', async () => {
    const env = await setUp();

    await env.deleteGroup(request({ tabIds: [10, 12, 13, 99] }));

    expect(env.nativeGroups.calls).toEqual(['remove 10']);
  });

  it('counts the tabs it takes out of the native group as tabs the add-on is moving', async () => {
    const env = await setUp();
    const seen: boolean[][] = [];
    const removeTabs = env.nativeGroups.removeTabs.bind(env.nativeGroups);
    env.nativeGroups.removeTabs = (ids) => {
      seen.push([10, 11, 12].map((id) => env.ownMoves.includes(id)));
      return removeTabs(ids);
    };

    await env.deleteGroup(request({ tabIds: [10, 11, 12] }));

    expect(seen).toEqual([[true, true, false]]);
    expect(env.ownMoves.includes(10)).toBe(false);
    expect(env.ownMoves.includes(11)).toBe(false);
  });

  it('does not ungroup when no tab is in the native group any more', async () => {
    const env = await setUp();

    await env.deleteGroup(request({ tabIds: [13, 99] }));

    expect(env.nativeGroups.calls).toEqual([]);
  });

  it.each([[null], [undefined]])(
    'does not ungroup a group that has the native group %s',
    async (nativeGroupId) => {
      const env = await setUp();

      await env.deleteGroup(request({ nativeGroupId, tabIds: [10, 11, 13] }));

      expect(env.nativeGroups.calls).toEqual([]);
      expect(await remainingIds(env)).toEqual([12]);
    },
  );

  it('does not ungroup in a browser that has no native groups', async () => {
    const env = await setUp({ hasTabGroups: false });

    await env.deleteGroup(request());

    expect(env.nativeGroups.calls).toEqual([]);
    expect(await remainingIds(env)).toEqual([12, 13]);
  });

  it('ungroups for the native group with the id 0, as it is a number', async () => {
    const env = await setUp();
    env.tabs.setDetails([tab(10, 0)]);

    await env.deleteGroup(request({ nativeGroupId: 0, tabIds: [10] }));

    expect(env.nativeGroups.calls).toEqual(['remove 10']);
  });

  it('carries on when the tabs cannot be taken out', async () => {
    const env = await setUp();
    env.nativeGroups.removeTabs = () => Promise.reject(new Error('gone'));

    await expect(env.deleteGroup(request())).resolves.toEqual({
      success: true,
    });

    expect(env.logger.debug).toHaveBeenCalledWith(
      'Could not ungroup tabs (group may already be removed): gone',
    );
    expect(await remainingIds(env)).toEqual([12, 13]);
  });

  it('carries on when a tab is already closed', async () => {
    const env = await setUp();
    await env.tabs.close(10);

    await expect(env.deleteGroup(request())).resolves.toEqual({
      success: true,
    });

    expect(env.logger.debug).toHaveBeenCalledWith(
      'Could not remove tab 10: Invalid tab ID: 10',
    );
    expect(await remainingIds(env)).toEqual([12, 13]);
  });

  it('closes no tabs for a group that has none', async () => {
    const env = await setUp();

    await env.deleteGroup(request({ tabIds: [] }));

    expect(env.tabs.calls).toEqual([]);
  });

  it('carries on when the menu item does not exist', async () => {
    const env = await setUp();
    await env.menus.remove('1');

    await expect(env.deleteGroup(request())).resolves.toEqual({
      success: true,
    });

    expect(env.logger.debug).toHaveBeenCalledWith(
      'Could not remove menu item: Cannot find menu item with id 1',
    );
  });

  it('does not touch the groups of a window that has none stored', async () => {
    const env = await setUp();

    await env.deleteGroup(request({ windowId: 9, tabIds: [] }));

    expect(await env.groupState.getGroups(9)).toBeUndefined();
  });

  it('makes a new first group when the last group was deleted', async () => {
    const env = await setUp();
    const raw = createMemoryGroupState();
    await raw.setGroups(WINDOW, [group(1)]);
    env.groupState.getGroups = (windowId) => raw.getGroups(windowId);
    env.groupState.setGroups = (windowId, groups) =>
      raw.setGroups(windowId, groups);

    await env.deleteGroup(request({ tabIds: [] }));

    expect((await raw.getGroups(WINDOW))?.map((g) => g.name)).toEqual([
      'Group 0',
    ]);
    expect(env.logger.debug).toHaveBeenCalledWith(
      'Last group deleted, creating new initial group...',
    );
  });

  it('makes a new first group when the last group of the user’s was deleted, though the group for ungrouped tabs is left', async () => {
    // Found by the property test: a window kept open by a pinned tab has no tab in a group
    const env = await setUp();
    const raw = createMemoryGroupState();
    await raw.setGroups(WINDOW, [
      group(1),
      { ...group(-2), name: 'Ungrouped Tabs', isSystemGroup: true },
    ]);
    env.groupState.getGroups = (windowId) => raw.getGroups(windowId);
    env.groupState.setGroups = (windowId, groups) =>
      raw.setGroups(windowId, groups);

    await env.deleteGroup(request({ tabIds: [] }));

    expect((await raw.getGroups(WINDOW))?.map((g) => g.name)).toEqual([
      'Group 0',
    ]);
  });

  describe('the group the window shows', () => {
    it('goes to the first group that is left, when the group deleted was the one shown', async () => {
      const env = await setUp();
      await env.groupState.setGroups(WINDOW, [group(4), group(2), group(3)]);
      await env.groupState.setActiveGroup(WINDOW, 4);

      await env.deleteGroup(request({ groupId: 4, tabIds: [] }));

      // The lowest, as a window with none shown gets
      expect(await env.groupState.getActiveGroup(WINDOW)).toBe(2);
    });

    it('shows the tabs of the group it goes to, which may have been hidden', async () => {
      const env = await setUp();
      await env.groupState.setActiveGroup(WINDOW, 1);

      await env.deleteGroup(request({ groupId: 1 }));

      expect(env.toggleVisibleTabs).toHaveBeenCalledTimes(1);
      expect(env.toggleVisibleTabs).toHaveBeenCalledWith(2, WINDOW);
    });

    it('is not a failed deletion when the tabs of that group cannot be shown', async () => {
      const env = await setUp();
      await env.groupState.setActiveGroup(WINDOW, 1);
      const failure = new Error('cannot show');
      env.toggleVisibleTabs.mockRejectedValue(failure);

      await expect(env.deleteGroup(request({ groupId: 1 }))).resolves.toEqual({
        success: true,
      });

      expect(env.logger.warn).toHaveBeenCalledWith(
        'Could not show group 2:',
        failure,
      );
    });

    it('is not a failed deletion when the window cannot be given the next group to show, as the group is gone', async () => {
      const env = await setUp();
      await env.groupState.setActiveGroup(WINDOW, 1);
      const failure = new Error('storage is full');
      vi.spyOn(env.groupState, 'setActiveGroup').mockRejectedValue(failure);

      await expect(env.deleteGroup(request({ groupId: 1 }))).resolves.toEqual({
        success: true,
      });

      expect(
        (await env.groupState.getGroups(WINDOW))?.map(({ id }) => id),
      ).toEqual([2]);
      expect(env.menus.items.some(({ id }) => id === '1')).toBe(false);
      expect(env.logger.warn).toHaveBeenCalledWith(
        `Group 1 is deleted, but window ${String(WINDOW)} could not be put right after it:`,
        failure,
      );
    });

    it('shows nothing when the group deleted was not the one shown', async () => {
      const env = await setUp();
      await env.groupState.setActiveGroup(WINDOW, 2);

      await env.deleteGroup(request({ groupId: 1 }));

      expect(env.toggleVisibleTabs).not.toHaveBeenCalled();
    });

    it('stays as it is when the group deleted was not the one shown', async () => {
      const env = await setUp();
      await env.groupState.setActiveGroup(WINDOW, 2);

      await env.deleteGroup(request({ groupId: 1 }));

      expect(await env.groupState.getActiveGroup(WINDOW)).toBe(2);
    });

    it('stays unset when the window showed none', async () => {
      const env = await setUp();

      await env.deleteGroup(request({ groupId: 1 }));

      expect(await env.groupState.getActiveGroup(WINDOW)).toBeUndefined();
    });
  });

  it('is not a failed deletion when the new first group cannot be made, as the group is gone', async () => {
    const env = await setUp();
    await env.groupState.setGroups(WINDOW, [group(1)]);
    const failure = new Error('storage is full');
    vi.spyOn(env.groupState, 'setActiveGroup').mockRejectedValue(failure);

    await expect(env.deleteGroup(request({ groupId: 1 }))).resolves.toEqual({
      success: true,
    });

    expect(env.menus.items.some(({ id }) => id === '1')).toBe(false);
    expect(env.logger.warn).toHaveBeenCalledWith(
      `Group 1 is deleted, but window ${String(WINDOW)} could not be put right after it:`,
      failure,
    );
  });

  it('does not make a new group while others are left', async () => {
    const env = await setUp();

    await env.deleteGroup(request());

    expect(env.logger.debug).not.toHaveBeenCalledWith(
      'Last group deleted, creating new initial group...',
    );
  });

  it('says what it is deleting', async () => {
    const env = await setUp();

    await env.deleteGroup(request());

    expect(env.logger.debug).toHaveBeenCalledWith(
      'Deleting group 1 with 2 tabs, nativeGroupId: 50',
    );
    expect(env.logger.debug).toHaveBeenCalledWith(
      'Ungrouped 2 tabs from native group 50',
    );
  });

  it('gives the reason when it fails', async () => {
    const env = await setUp();
    const failure = new Error('storage is full');
    env.groupState.setGroups = () => Promise.reject(failure);

    await expect(env.deleteGroup(request())).resolves.toEqual({
      success: false,
      error: 'storage is full',
    });

    expect(env.logger.error).toHaveBeenCalledWith(
      'Group deletion failed for group 1:',
      failure,
    );
  });

  it('gives a failure that is not an error as text', async () => {
    const env = await setUp();
    env.groupState.getGroups = vi.fn().mockRejectedValue('broken');

    await expect(env.deleteGroup(request())).resolves.toEqual({
      success: false,
      error: 'broken',
    });
  });
});
