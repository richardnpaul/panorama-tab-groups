import { describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMigrationFlag } from '../../../src/js/adapters/memory/migration-flag.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createNativeGroupAssignment } from '../../../src/js/app/native-group-assignment.js';
import { createNativeGroupsSync } from '../../../src/js/app/native-groups-sync.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';
import { englishMessage } from '../../support/messages.js';
import { storeGroups } from '../../support/stored-groups.js';

const group = (id: number, nativeGroupId?: number | null): Group => ({
  id,
  name: `G${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
  ...(nativeGroupId === undefined ? {} : { nativeGroupId }),
});

const tab = (
  id: number,
  windowId: number,
  browserGroupId?: number,
): TabDetails => ({
  id,
  windowId,
  active: false,
  pinned: false,
  url: `https://site${String(id)}/`,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId,
});

function setUp({
  windowIds = [1],
  existingNativeGroups = [],
  complete = false,
  canHideTabs = true,
}: {
  windowIds?: number[];
  existingNativeGroups?: number[];
  complete?: boolean;
  canHideTabs?: boolean;
} = {}) {
  const groupState = createMemoryGroupState();
  const tabs = createMemoryTabs();
  const windows = createMemoryWindows(windowIds[0] ?? 1);
  windowIds.slice(1).forEach((id) => {
    windows.open(id);
  });
  const nativeGroups = createMemoryNativeGroups(
    existingNativeGroups,
    windowIds[0] ?? 1,
  );
  const migrationFlag = createMemoryMigrationFlag(complete);
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const assignment = createNativeGroupAssignment({
    tabs,
    windows,
    groupState,
    nativeGroups,
    i18n: { getMessage: englishMessage },
    logger,
  });
  return {
    sync: createNativeGroupsSync({
      groupState,
      tabs,
      windows,
      nativeGroups,
      assignment,
      migrationFlag,
      canHideTabs,
      logger,
    }),
    groupState,
    tabs,
    windows,
    nativeGroups,
    migrationFlag,
    logger,
  };
}

type Env = ReturnType<typeof setUp>;

const nativeIds = async (env: Env, windowId = 1) =>
  (await env.groupState.getGroups(windowId))?.map((g) => g.nativeGroupId);

describe('app/native-groups-sync.ts', () => {
  describe('relink', () => {
    /** Groups of window 1 with the native group each refers to, and the tabs in them as the browser has them */
    async function afterRestart(
      groups: Group[],
      tabs: { id: number; group: number; native?: number }[],
    ) {
      const env = setUp({ windowIds: [1, 2] });
      await storeGroups(env.groupState, 1, groups);
      env.tabs.setDetails(tabs.map(({ id, native }) => tab(id, 1, native)));
      await Promise.all(
        tabs.map(({ id, group: groupId }) =>
          env.groupState.setTabGroup(id, groupId),
        ),
      );
      return env;
    }

    it('keeps the reference of a group whose tabs are in the native group it refers to', async () => {
      const env = await afterRestart(
        [group(1, 50)],
        [
          { id: 10, group: 1, native: 50 },
          { id: 11, group: 1, native: 50 },
        ],
      );

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([50]);
    });

    it('links a group to the new native group its tabs are in, where the id it had is gone', async () => {
      const env = await afterRestart(
        [group(1, 50)],
        [
          { id: 10, group: 1, native: 77 },
          { id: 11, group: 1, native: 77 },
        ],
      );

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([77]);
    });

    it('links a group to the native group of the tabs it has in one, though some are in none', async () => {
      const env = await afterRestart(
        [group(1, 50)],
        [
          { id: 10, group: 1, native: 77 },
          { id: 11, group: 1 },
          { id: 12, group: 1, native: -1 },
        ],
      );

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([77]);
    });

    it('forgets the reference of a group whose tabs are in no native group', async () => {
      const env = await afterRestart(
        [group(1, 50)],
        [
          { id: 10, group: 1 },
          { id: 11, group: 1, native: -1 },
        ],
      );

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([undefined]);
      expect((await env.groupState.getGroups(1))?.[0]).not.toHaveProperty(
        'nativeGroupId',
      );
    });

    it('forgets the reference of a group whose tabs are in several native groups, which it cannot choose between', async () => {
      const env = await afterRestart(
        [group(1, 50)],
        [
          { id: 10, group: 1, native: 77 },
          { id: 11, group: 1, native: 78 },
        ],
      );

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([undefined]);
    });

    it('does not take a native group with the id 0 for one, as the clean-up does not', async () => {
      const env = await afterRestart(
        [group(1, 50)],
        [{ id: 10, group: 1, native: 0 }],
      );

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([undefined]);
    });

    it('forgets the reference of a group that has no tabs', async () => {
      const env = await afterRestart([group(1, 50)], []);

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([undefined]);
    });

    it('links each group to the native group its own tabs are in, not to one the tabs of another are in', async () => {
      const env = await afterRestart(
        [group(1, 50), group(2)],
        [
          { id: 10, group: 2, native: 50 },
          { id: 11, group: 1 },
        ],
      );

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([undefined, 50]);
    });

    it('links a group that has no link, as when the browser has started and the links are gone; one that never had a native group keeps none', async () => {
      const env = await afterRestart(
        [group(1), group(2, null)],
        [{ id: 10, group: 1, native: 77 }],
      );

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([77, null]);
    });

    it('links neither of two groups whose tabs are in one native group, even when one also has tabs in another', async () => {
      const env = await afterRestart(
        [group(1), group(2), group(3), group(4), group(5)],
        [
          { id: 10, group: 1, native: 77 },
          { id: 11, group: 2, native: 77 },
          { id: 12, group: 3, native: 88 },
          { id: 13, group: 4, native: 88 },
          { id: 14, group: 4, native: 99 },
          { id: 15, group: 5, native: 66 },
        ],
      );

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        66,
      ]);
    });

    it('links no group for ungrouped tabs, whatever its tabs are in', async () => {
      const env = await afterRestart(
        [group(1), group(-2, null)],
        [
          { id: 10, group: 1, native: 77 },
          { id: 11, group: -2, native: 88 },
        ],
      );

      await env.sync.relink();

      expect(await nativeIds(env)).toEqual([77, null]);
    });

    it('writes nothing when nothing changed', async () => {
      const env = await afterRestart(
        [group(1, 50), group(2)],
        [{ id: 10, group: 1, native: 50 }],
      );
      const setGroups = vi.spyOn(env.groupState, 'setGroups');
      const setLink = vi.spyOn(env.groupState, 'setNativeGroupLink');

      await env.sync.relink();

      expect(setGroups).not.toHaveBeenCalled();
      expect(setLink).not.toHaveBeenCalled();
    });

    it('does nothing for a window that has no groups stored', async () => {
      const env = setUp({ windowIds: [1, 2] });

      await expect(env.sync.relink()).resolves.toBeUndefined();

      expect(env.logger.warn).not.toHaveBeenCalled();
    });

    it('does every window, each by its own tabs', async () => {
      const env = setUp({ windowIds: [1, 2] });
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      await storeGroups(env.groupState, 2, [group(1, 50)]);
      env.tabs.setDetails([tab(10, 1, 70), tab(20, 2, 80)]);
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(20, 1);

      await env.sync.relink();

      expect(
        [
          await env.groupState.getGroups(1),
          await env.groupState.getGroups(2),
        ].map((groups) => groups?.[0]?.nativeGroupId),
      ).toEqual([70, 80]);
    });

    it('reports what went wrong and goes on, as the start-up must', async () => {
      const env = setUp();
      const failure = new Error('no storage');
      env.windows.listIds = () => Promise.reject(failure);

      await expect(env.sync.relink()).resolves.toBeUndefined();

      expect(env.logger.warn).toHaveBeenCalledWith(
        'Linking the groups to the native groups failed:',
        failure,
      );
    });
  });

  describe('migrate', () => {
    it('does nothing when it was done before', async () => {
      const env = setUp({ complete: true });
      await storeGroups(env.groupState, 1, [group(1)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await expect(env.sync.migrate()).resolves.toBe(true);

      expect(env.nativeGroups.calls).toEqual([]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Migration already complete, skipping',
      );
    });

    it('makes a native group for every group that has tabs, and marks the migration as done', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1), group(2)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1), tab(12, 1)]);
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(11, 1);
      await env.groupState.setTabGroup(12, 2);

      await expect(env.sync.migrate()).resolves.toBe(true);

      expect(await nativeIds(env)).toEqual([1000, 1001]);
      expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([10, 11]);
      expect(await env.nativeGroups.tabIdsIn(1001)).toEqual([12]);
      expect(await env.migrationFlag.isComplete()).toBe(true);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Migration] Created native group 1000 for group 1 with 2 tabs in window 1',
      );
    });

    it('makes the native groups of the groups not shown collapsed, then shows the tabs they had hidden', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1), group(2)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1), tab(12, 1)]);
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(11, 2);
      await env.groupState.setTabGroup(12, 2);
      await env.tabs.hide([11, 12]);
      const order: string[] = [];
      const create = env.nativeGroups.createFromTabs.bind(env.nativeGroups);
      vi.spyOn(env.nativeGroups, 'createFromTabs').mockImplementation(
        (tabIds, windowId) => {
          order.push(`group ${tabIds.join(',')}`);
          return create(tabIds, windowId);
        },
      );
      const show = env.tabs.show.bind(env.tabs);
      vi.spyOn(env.tabs, 'show').mockImplementation((tabIds) => {
        order.push(`show ${tabIds.join(',')}`);
        return show(tabIds);
      });

      await env.sync.migrate();

      expect(order).toEqual(['group 10', 'group 11,12', 'show 10,11,12']);
      expect(env.nativeGroups.collapsed.get(1000)).toBe(false);
      expect(env.nativeGroups.collapsed.get(1001)).toBe(true);
      expect(env.tabs.hiddenIds.size).toBe(0);
    });

    it('shows nothing of a window that has no tabs', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1)]);
      await env.groupState.setActiveGroup(1, 1);
      const show = vi.spyOn(env.tabs, 'show');

      await env.sync.migrate();

      expect(show).not.toHaveBeenCalled();
    });

    it('shows no tab in a browser that cannot hide them', async () => {
      const env = setUp({ canHideTabs: false });
      await storeGroups(env.groupState, 1, [group(1)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await env.sync.migrate();

      expect(env.tabs.calls).toEqual([]);
      expect(await nativeIds(env)).toEqual([1000]);
    });

    it('makes no native group for the group for ungrouped tabs', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [
        group(1),
        { ...group(-2), nativeGroupId: null },
      ]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(11, -2);

      await env.sync.migrate();

      expect(env.nativeGroups.calls).toEqual([
        'create 10',
        'appearance 1000 G1',
      ]);
    });

    it('drops a reference to a native group that has gone', async () => {
      const env = setUp({ existingNativeGroups: [50] });
      await storeGroups(env.groupState, 1, [group(1, 99), group(2, 50)]);
      await env.groupState.setActiveGroup(1, 2);

      await env.sync.migrate();

      expect(await nativeIds(env)).toEqual([undefined, 50]);
      expect(env.logger.warn).toHaveBeenCalledWith(
        'Group 1 has stale nativeGroupId 99, will recreate',
        new Error('No group with id: 99'),
      );
    });

    it('does not make a native group for the active group that has a valid one', async () => {
      const env = setUp({ existingNativeGroups: [50] });
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await env.sync.migrate();

      expect(env.nativeGroups.calls).toEqual([]);
      expect(await nativeIds(env)).toEqual([50]);
    });

    it('makes a new native group for the active group whose reference was stale', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1, 99)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await env.sync.migrate();

      expect(await nativeIds(env)).toEqual([1000]);
    });

    it('leaves the reference null of a group that never has a native group', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1), group(-2, null)]);

      await env.sync.migrate();

      expect(await nativeIds(env)).toEqual([undefined, null]);
    });

    it('treats a native group with the id 0 as stale', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1, 0)]);

      await env.sync.migrate();

      expect(await nativeIds(env)).toEqual([undefined]);
    });

    it('saves the groups as they are when the active group has no tabs', async () => {
      const env = setUp({ existingNativeGroups: [50] });
      await storeGroups(env.groupState, 1, [group(1), group(2, 50)]);
      await env.groupState.setActiveGroup(1, 1);

      await expect(env.sync.migrate()).resolves.toBe(true);

      expect(await nativeIds(env)).toEqual([undefined, 50]);
      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('does not write the groups when none has anything to be cleaned', async () => {
      const env = setUp({ existingNativeGroups: [50] });
      await storeGroups(env.groupState, 1, [group(1), group(2, 50)]);
      const write = vi.spyOn(env.groupState, 'setGroups');

      await env.sync.migrate();

      expect(write).not.toHaveBeenCalled();
    });

    it('groups the only tab of a window, and drops the reference of a group that has gone', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1), group(2, 99)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await expect(env.sync.migrate()).resolves.toBe(true);

      expect(await nativeIds(env)).toEqual([1000, undefined]);
    });

    it('says it failed, and is not done, when no native group could be made', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1), group(2, 99)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);
      const failure = new Error('refused');
      env.nativeGroups.createFromTabs = () => Promise.reject(failure);

      await expect(env.sync.migrate()).resolves.toBe(false);

      expect(env.logger.warn).toHaveBeenCalledWith(
        'Failed to create native group for group 1:',
        failure,
      );
      expect(env.logger.error).toHaveBeenCalledWith(
        'Migration to hybrid groups failed: no window could be given a native tab group',
      );
      // What was found out on the way is kept
      expect(await nativeIds(env)).toEqual([undefined, undefined]);
      expect(await env.migrationFlag.isComplete()).toBe(false);
    });

    it('says it failed when the browser made the group in another window', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);
      env.nativeGroups.moveNextGroupToWindow(9);

      await expect(env.sync.migrate()).resolves.toBe(false);

      expect(await env.migrationFlag.isComplete()).toBe(false);
    });

    it('is done when one window got a native group and another did not', async () => {
      const env = setUp({ windowIds: [1, 2] });
      const createFromTabs = env.nativeGroups.createFromTabs.bind(
        env.nativeGroups,
      );
      env.nativeGroups.createFromTabs = (tabIds, windowId) =>
        windowId === 2
          ? Promise.reject(new Error('refused'))
          : createFromTabs(tabIds, windowId);
      await Promise.all(
        [1, 2].map(async (windowId) => {
          await storeGroups(env.groupState, windowId, [group(1)]);
          await env.groupState.setActiveGroup(windowId, 1);
          await env.groupState.setTabGroup(windowId * 10, 1);
        }),
      );
      env.tabs.setDetails([tab(10, 1), tab(20, 2)]);

      await expect(env.sync.migrate()).resolves.toBe(true);

      expect(await nativeIds(env, 1)).toEqual([1000]);
      expect(await nativeIds(env, 2)).toEqual([undefined]);
      expect(await env.migrationFlag.isComplete()).toBe(true);
    });

    it('makes every native group collapsed when no group is active', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1)]);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await env.sync.migrate();

      expect(env.nativeGroups.calls).toEqual([
        'create 10',
        'appearance 1000 G1',
        'collapse 1000',
      ]);
    });

    it('skips a window that has no groups, or an empty list of them', async () => {
      const env = setUp({ windowIds: [1, 2] });
      await storeGroups(env.groupState, 2, []);

      await expect(env.sync.migrate()).resolves.toBe(true);

      expect(await env.groupState.getGroups(1)).toBeUndefined();
      expect(await env.groupState.getGroups(2)).toEqual([]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'No groups to migrate for window 1',
      );
      expect(env.logger.debug).toHaveBeenCalledWith(
        'No groups to migrate for window 2',
      );
    });

    it('migrates every window by itself', async () => {
      const env = setUp({ windowIds: [1, 2] });
      await storeGroups(env.groupState, 1, [group(1)]);
      await env.groupState.setActiveGroup(1, 1);
      await storeGroups(env.groupState, 2, [group(5, 77)]);
      await env.groupState.setActiveGroup(2, 5);

      await env.sync.migrate();

      expect(await nativeIds(env, 1)).toEqual([undefined]);
      expect(await nativeIds(env, 2)).toEqual([undefined]);
    });

    it('gives false and tries again next time when it fails', async () => {
      const env = setUp();
      const failure = new Error('no windows');
      env.windows.listIds = () => Promise.reject(failure);

      await expect(env.sync.migrate()).resolves.toBe(false);

      expect(env.logger.error).toHaveBeenCalledWith(
        'Migration to hybrid groups failed:',
        failure,
      );
      expect(await env.migrationFlag.isComplete()).toBe(false);
    });

    it('gives false when the flag cannot be read', async () => {
      const env = setUp();
      env.migrationFlag.failWith(new Error('storage'));

      await expect(env.sync.migrate()).resolves.toBe(false);
    });
  });

  describe('cleanup', () => {
    it('takes the tabs out of native groups and forgets the groups', async () => {
      const env = setUp({ windowIds: [1, 2] });
      await storeGroups(env.groupState, 1, [group(1, 50), group(2)]);
      await storeGroups(env.groupState, 2, [group(3, 60)]);
      env.tabs.setDetails([
        tab(10, 1, 50),
        tab(11, 1, -1),
        tab(12, 1),
        tab(13, 2, 60),
      ]);
      await env.migrationFlag.setComplete(true);

      await env.sync.cleanup();

      expect(env.nativeGroups.calls).toEqual(['remove 10', 'remove 13']);
      expect(await nativeIds(env, 1)).toEqual([undefined, undefined]);
      expect(await nativeIds(env, 2)).toEqual([undefined]);
      expect(await env.migrationFlag.isComplete()).toBe(false);
    });

    describe('the tabs in no group of the user’s, which tabs hidden would hide for good', () => {
      async function withUngrouped(active: number | undefined) {
        const env = setUp();
        await storeGroups(env.groupState, 1, [
          group(1),
          group(2),
          group(-2, null),
        ]);
        if (active !== undefined) {
          await env.groupState.setActiveGroup(1, active);
        }
        env.tabs.setDetails([
          tab(10, 1),
          { ...tab(11, 1), pinned: true },
          tab(12, 1),
          tab(13, 1),
        ]);
        await env.groupState.setTabGroup(10, -2);
        await env.groupState.setTabGroup(12, 1);
        await env.groupState.setTabGroup(13, -2);
        return env;
      }

      it('join the group the window shows', async () => {
        const env = await withUngrouped(2);

        await env.sync.cleanup();

        expect(
          await Promise.all(
            [10, 12, 13].map((id) => env.groupState.getTabGroup(id)),
          ),
        ).toEqual([2, 1, 2]);
      });

      it('join the lowest group when the window shows none, or one that is gone', async () => {
        const none = await withUngrouped(undefined);
        const gone = await withUngrouped(9);

        await none.sync.cleanup();
        await gone.sync.cleanup();

        expect(await none.groupState.getTabGroup(10)).toBe(1);
        expect(await gone.groupState.getTabGroup(10)).toBe(1);
      });

      it('are not given a group when they are pinned, which have none', async () => {
        const env = await withUngrouped(2);
        await env.groupState.setTabGroup(11, -2);

        await env.sync.cleanup();

        expect(await env.groupState.getTabGroup(11)).toBe(-2);
      });
    });

    it('forgets the link of the groups that have one, and touches no other', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [
        group(1, 50),
        group(2),
        group(3, null),
      ]);
      const setLink = vi.spyOn(env.groupState, 'setNativeGroupLink');

      await env.sync.cleanup();

      expect(setLink.mock.calls).toEqual([[1, 1, undefined]]);
    });

    it('takes out the tabs of every native group, not only the ones we know', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      env.tabs.setDetails([tab(10, 1, 50), tab(11, 1, 77)]);

      await env.sync.cleanup();

      expect(env.nativeGroups.calls).toEqual(['remove 10,11']);
    });

    it('does not ungroup when no tab is in a native group', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1)]);
      env.tabs.setDetails([tab(10, 1, -1), tab(11, 1, 0), tab(12, 1)]);

      await env.sync.cleanup();

      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('keeps the reference null of a group that never has a native group', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1, 50), group(-2, null)]);

      await env.sync.cleanup();

      expect(await nativeIds(env)).toEqual([undefined, null]);
    });

    it('skips a window that has no groups stored', async () => {
      const env = setUp();
      env.tabs.setDetails([tab(10, 1, 50)]);

      await env.sync.cleanup();

      expect(env.nativeGroups.calls).toEqual([]);
      expect(await env.groupState.getGroups(1)).toBeUndefined();
    });

    it('forgets the groups even when the tabs cannot be taken out', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      env.tabs.setDetails([tab(10, 1, 50)]);
      const failure = new Error('cannot ungroup');
      env.nativeGroups.removeTabs = () => Promise.reject(failure);

      await env.sync.cleanup();

      expect(env.logger.warn).toHaveBeenCalledWith(
        'Failed to ungroup tabs in window 1:',
        failure,
      );
      expect(await nativeIds(env)).toEqual([undefined]);
    });

    it('rejects when it fails, and leaves the migration flag', async () => {
      const env = setUp();
      await env.migrationFlag.setComplete(true);
      const failure = new Error('no windows');
      env.windows.listIds = () => Promise.reject(failure);

      await expect(env.sync.cleanup()).rejects.toBe(failure);

      expect(env.logger.error).toHaveBeenCalledWith(
        'Native groups cleanup failed:',
        failure,
      );
      expect(await env.migrationFlag.isComplete()).toBe(true);
    });

    it('ignores groups the browser reports gone while it runs, and not after', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      let release: () => void = () => undefined;
      env.windows.listIds = () =>
        new Promise<number[]>((resolve) => {
          release = () => {
            resolve([]);
          };
        });

      const cleaning = env.sync.cleanup();
      await env.sync.onRemoved({ id: 50, windowId: 1 });
      expect(await nativeIds(env)).toEqual([50]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Native tab group removed (ignored during cleanup): 50',
      );
      release();
      await cleaning;

      await env.sync.onRemoved({ id: 50, windowId: 1 });
      expect(await nativeIds(env)).toEqual([undefined]);
    });

    it('stops ignoring groups the browser reports gone even when it failed', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      const original = env.windows.listIds.bind(env.windows);
      env.windows.listIds = () => Promise.reject(new Error('no windows'));
      await env.sync.cleanup().catch(() => undefined);
      env.windows.listIds = original;

      await env.sync.onRemoved({ id: 50, windowId: 1 });

      expect(await nativeIds(env)).toEqual([undefined]);
    });

    it('runs once when asked twice at once, as when the option change and the message arrive together', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      env.tabs.setDetails([tab(10, 1, 50)]);
      const listIds = vi.spyOn(env.windows, 'listIds');

      await Promise.all([env.sync.cleanup(), env.sync.cleanup()]);

      expect(listIds).toHaveBeenCalledTimes(1);
      expect(env.nativeGroups.calls).toEqual(['remove 10']);
    });
  });

  describe('onRemoved', () => {
    it('forgets the native group of our group, and keeps the group', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [
        group(1, 50),
        group(2, 60),
        group(3),
      ]);

      await env.sync.onRemoved({ id: 50, windowId: 1 });

      expect(await nativeIds(env)).toEqual([undefined, 60, undefined]);
      expect((await env.groupState.getGroups(1))?.map((g) => g.name)).toEqual([
        'G1',
        'G2',
        'G3',
      ]);
    });

    it('does nothing for a window whose groups were never stored', async () => {
      const env = setUp({ existingNativeGroups: [50] });
      const setGroups = vi.spyOn(env.groupState, 'setGroups');

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'x' });

      expect(setGroups).not.toHaveBeenCalled();
      expect(env.logger.warn).not.toHaveBeenCalled();
    });

    it('does not write the groups when none of them has the native group', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1, 60)]);
      const setGroups = vi.spyOn(env.groupState, 'setGroups');

      await env.sync.onRemoved({ id: 50, windowId: 1 });

      expect(setGroups).not.toHaveBeenCalled();
    });

    it('leaves the groups of other windows', async () => {
      const env = setUp({ windowIds: [1, 2] });
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      await storeGroups(env.groupState, 2, [group(2, 50)]);

      await env.sync.onRemoved({ id: 50, windowId: 2 });

      expect(await nativeIds(env, 1)).toEqual([50]);
      expect(await nativeIds(env, 2)).toEqual([undefined]);
    });

    it('does nothing for a window with no groups', async () => {
      const env = setUp();

      await env.sync.onRemoved({ id: 50, windowId: 1 });

      expect(await env.groupState.getGroups(1)).toBeUndefined();
      expect(env.logger.warn).not.toHaveBeenCalled();
    });

    it('says so when it cannot', async () => {
      const env = setUp();
      const failure = new Error('storage');
      env.groupState.getGroups = () => Promise.reject(failure);

      await env.sync.onRemoved({ id: 50, windowId: 1 });

      expect(env.logger.warn).toHaveBeenCalledWith(
        'Error syncing removed native group:',
        failure,
      );
    });
  });

  describe('onUpdated', () => {
    const titled = async (title: string | undefined, existing = [50]) => {
      const env = setUp({ existingNativeGroups: existing });
      if (title !== undefined) {
        await env.nativeGroups.setAppearance(50, { title, color: undefined });
      }
      return env;
    };

    it('gives our group the name of its native group', async () => {
      const env = await titled('Renamed');
      await storeGroups(env.groupState, 1, [group(1, 50), group(2, 60)]);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'Renamed' });

      expect((await env.groupState.getGroups(1))?.map((g) => g.name)).toEqual([
        'Renamed',
        'G2',
      ]);
    });

    it('takes the title the native group has now, not the one the report says', async () => {
      // Chromium reports a group as it was made, with no title, after the title was set
      const env = await titled('Work');
      await storeGroups(env.groupState, 1, [group(1, 50)]);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: '' });

      expect((await env.groupState.getGroups(1))?.[0]?.name).toBe('Work');
    });

    it('keeps the name when the native group has no title', async () => {
      const env = await titled(undefined);
      await storeGroups(env.groupState, 1, [group(1, 50)]);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'x' });

      expect((await env.groupState.getGroups(1))?.[0]?.name).toBe('G1');
    });

    it('gives the empty title as the name, when it is the title the native group has', async () => {
      const env = await titled('');
      await storeGroups(env.groupState, 1, [group(1, 50)]);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'old' });

      expect((await env.groupState.getGroups(1))?.[0]?.name).toBe('');
    });

    it('says so, and keeps the name, when the native group is gone', async () => {
      const env = setUp();
      await storeGroups(env.groupState, 1, [group(1, 50)]);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'x' });

      expect((await env.groupState.getGroups(1))?.[0]?.name).toBe('G1');
      expect(env.logger.warn).toHaveBeenCalledWith(
        'Error syncing updated native group:',
        new Error('No group with id: 50'),
      );
    });

    it('does not write the groups when none of them has the native group, though it exists', async () => {
      const env = await titled('x', [50, 60]);
      await storeGroups(env.groupState, 1, [group(1, 60)]);
      const setGroups = vi.spyOn(env.groupState, 'setGroups');

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'x' });

      expect(setGroups).not.toHaveBeenCalled();
      expect(env.logger.warn).not.toHaveBeenCalled();
    });

    it('renames only the group linked to the native group', async () => {
      const env = await titled('Renamed', [50, 60]);
      await storeGroups(env.groupState, 1, [group(1, 60), group(2, 50)]);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'Renamed' });

      expect((await env.groupState.getGroups(1))?.map((g) => g.name)).toEqual([
        'G1',
        'Renamed',
      ]);
    });

    it('keeps the native group', async () => {
      const env = await titled('x');
      await storeGroups(env.groupState, 1, [group(1, 50)]);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'x' });

      expect(await nativeIds(env)).toEqual([50]);
    });

    it('leaves alone a report of a native group being made, whose link comes once its title is set', async () => {
      // Chromium reports the group with no title, and the add-on links it once it has set the title
      const env = await titled('');
      await storeGroups(env.groupState, 1, [group(1)]);
      const get = env.nativeGroups.get.bind(env.nativeGroups);
      vi.spyOn(env.nativeGroups, 'get').mockImplementation(async (id) => {
        const found = await get(id);
        await storeGroups(env.groupState, 1, [group(1, 50)]);
        return found;
      });

      await env.sync.onUpdated({ id: 50, windowId: 1, title: '' });

      expect((await env.groupState.getGroups(1))?.[0]?.name).toBe('G1');
    });

    it('stores nothing when the groups are gone while the title is asked for', async () => {
      const env = await titled('Renamed');
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      const read = env.groupState.getGroups.bind(env.groupState);
      vi.spyOn(env.groupState, 'getGroups')
        .mockImplementationOnce(read)
        .mockResolvedValueOnce(undefined);
      const setGroups = vi.spyOn(env.groupState, 'setGroups');

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'Renamed' });

      expect(setGroups).not.toHaveBeenCalled();
    });

    it('does nothing for a window with no groups stored', async () => {
      const env = await titled('x');
      const setGroups = vi.spyOn(env.groupState, 'setGroups');

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'x' });

      expect(setGroups).not.toHaveBeenCalled();
      expect(env.logger.warn).not.toHaveBeenCalled();
    });

    it('does not write the groups when the name is the title already, as when a group is collapsed', async () => {
      const env = await titled('G1');
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      const setGroups = vi.spyOn(env.groupState, 'setGroups');

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'G1' });

      expect(setGroups).not.toHaveBeenCalled();
    });

    it('does not write the groups for the name of another group, which is not linked to the native group', async () => {
      const env = await titled('G1', [50, 60]);
      await storeGroups(env.groupState, 1, [group(1, 50), group(2, 60)]);
      const setGroups = vi.spyOn(env.groupState, 'setGroups');

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'G1' });

      expect(setGroups).not.toHaveBeenCalled();
    });

    it('reads the groups once it has the title, so groups a page stored while it asked are kept', async () => {
      const env = await titled('Renamed');
      await storeGroups(env.groupState, 1, [group(1, 50)]);
      const get = env.nativeGroups.get.bind(env.nativeGroups);
      vi.spyOn(env.nativeGroups, 'get').mockImplementation(async (id) => {
        const found = await get(id);
        // A page stores the groups meanwhile
        await storeGroups(env.groupState, 1, [group(1, 50), group(2)]);
        return found;
      });

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'Renamed' });

      expect((await env.groupState.getGroups(1))?.map((g) => g.name)).toEqual([
        'Renamed',
        'G2',
      ]);
    });

    it('says so when it cannot', async () => {
      const env = await titled('x');
      const failure = new Error('storage');
      env.groupState.getGroups = () => Promise.reject(failure);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'x' });

      expect(env.logger.warn).toHaveBeenCalledWith(
        'Error syncing updated native group:',
        failure,
      );
    });
  });
});
