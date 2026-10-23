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

const VIEW = 'moz-extension://id/view.html';

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
}: {
  windowIds?: number[];
  existingNativeGroups?: number[];
  complete?: boolean;
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
    viewUrl: VIEW,
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
  describe('migrate', () => {
    it('does nothing when it was done before', async () => {
      const env = setUp({ complete: true });
      await env.groupState.setGroups(1, [group(1)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await expect(env.sync.migrate()).resolves.toBe(true);

      expect(env.nativeGroups.calls).toEqual([]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Migration already complete, skipping',
      );
    });

    it('makes a native group for the active group, and marks the migration as done', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1), group(2)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1), tab(12, 1)]);
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(11, 1);
      await env.groupState.setTabGroup(12, 2);

      await expect(env.sync.migrate()).resolves.toBe(true);

      expect(await nativeIds(env)).toEqual([1000, undefined]);
      expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([10, 11]);
      expect(await env.migrationFlag.isComplete()).toBe(true);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Migration] Created native group 1000 for panorama group 1 with 2 tabs in window 1',
      );
    });

    it('leaves the groups that are not active to get theirs when they become active', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1), group(2)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1), tab(12, 1)]);
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(11, 2);
      await env.groupState.setTabGroup(12, 2);

      await env.sync.migrate();

      expect(env.nativeGroups.calls).toEqual([
        'create 10',
        'appearance 1000 G1',
      ]);
      expect(await nativeIds(env)).toEqual([1000, undefined]);
    });

    it('drops a reference to a native group that has gone', async () => {
      const env = setUp({ existingNativeGroups: [50] });
      await env.groupState.setGroups(1, [group(1, 99), group(2, 50)]);
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
      await env.groupState.setGroups(1, [group(1, 50)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await env.sync.migrate();

      expect(env.nativeGroups.calls).toEqual([]);
      expect(await nativeIds(env)).toEqual([50]);
    });

    it('makes a new native group for the active group whose reference was stale', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 99)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await env.sync.migrate();

      expect(await nativeIds(env)).toEqual([1000]);
    });

    it('leaves the reference null of a group that never has a native group', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1), group(-2, null)]);

      await env.sync.migrate();

      expect(await nativeIds(env)).toEqual([undefined, null]);
    });

    it('treats a native group with the id 0 as stale', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 0)]);

      await env.sync.migrate();

      expect(await nativeIds(env)).toEqual([undefined]);
    });

    it('saves the groups as they are when the active group has no tabs', async () => {
      const env = setUp({ existingNativeGroups: [50] });
      await env.groupState.setGroups(1, [group(1), group(2, 50)]);
      await env.groupState.setActiveGroup(1, 1);

      await env.sync.migrate();

      expect(await nativeIds(env)).toEqual([undefined, 50]);
      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('saves the groups cleaned when grouping is not safe', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1), group(2, 99)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await env.sync.migrate();

      expect(await nativeIds(env)).toEqual([undefined, undefined]);
      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('carries on when making the native group fails', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1), group(2, 99)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);
      const failure = new Error('refused');
      env.nativeGroups.createFromTabs = () => Promise.reject(failure);

      await expect(env.sync.migrate()).resolves.toBe(true);

      expect(env.logger.warn).toHaveBeenCalledWith(
        'Failed to create native group for group 1:',
        failure,
      );
      expect(await nativeIds(env)).toEqual([undefined, undefined]);
      expect(await env.migrationFlag.isComplete()).toBe(true);
    });

    it('does not make a native group when no group is active', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1)]);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await env.sync.migrate();

      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('skips a window that has no groups, or an empty list of them', async () => {
      const env = setUp({ windowIds: [1, 2] });
      await env.groupState.setGroups(2, []);

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
      await env.groupState.setGroups(1, [group(1)]);
      await env.groupState.setActiveGroup(1, 1);
      await env.groupState.setGroups(2, [group(5, 77)]);
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
      await env.groupState.setGroups(1, [group(1, 50), group(2)]);
      await env.groupState.setGroups(2, [group(3, 60)]);
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

    it('takes out the tabs of every native group, not only the ones we know', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 50)]);
      env.tabs.setDetails([tab(10, 1, 50), tab(11, 1, 77)]);

      await env.sync.cleanup();

      expect(env.nativeGroups.calls).toEqual(['remove 10,11']);
    });

    it('does not ungroup when no tab is in a native group', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1)]);
      env.tabs.setDetails([tab(10, 1, -1), tab(11, 1, 0), tab(12, 1)]);

      await env.sync.cleanup();

      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('keeps the reference null of a group that never has a native group', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 50), group(-2, null)]);

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
      await env.groupState.setGroups(1, [group(1, 50)]);
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
      await env.groupState.setGroups(1, [group(1, 50)]);
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
      await env.groupState.setGroups(1, [group(1, 50)]);
      const original = env.windows.listIds.bind(env.windows);
      env.windows.listIds = () => Promise.reject(new Error('no windows'));
      await env.sync.cleanup().catch(() => undefined);
      env.windows.listIds = original;

      await env.sync.onRemoved({ id: 50, windowId: 1 });

      expect(await nativeIds(env)).toEqual([undefined]);
    });
  });

  describe('onRemoved', () => {
    it('forgets the native group of our group, and keeps the group', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 50), group(2, 60), group(3)]);

      await env.sync.onRemoved({ id: 50, windowId: 1 });

      expect(await nativeIds(env)).toEqual([undefined, 60, undefined]);
      expect((await env.groupState.getGroups(1))?.map((g) => g.name)).toEqual([
        'G1',
        'G2',
        'G3',
      ]);
    });

    it('does not write the groups when none of them has the native group', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 60)]);
      const setGroups = vi.spyOn(env.groupState, 'setGroups');

      await env.sync.onRemoved({ id: 50, windowId: 1 });

      expect(setGroups).not.toHaveBeenCalled();
    });

    it('leaves the groups of other windows', async () => {
      const env = setUp({ windowIds: [1, 2] });
      await env.groupState.setGroups(1, [group(1, 50)]);
      await env.groupState.setGroups(2, [group(2, 50)]);

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
    it('gives our group the name of its native group', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 50), group(2, 60)]);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'Renamed' });

      expect((await env.groupState.getGroups(1))?.map((g) => g.name)).toEqual([
        'Renamed',
        'G2',
      ]);
    });

    it('keeps the name when the native group has no title', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 50)]);

      await env.sync.onUpdated({ id: 50, windowId: 1 });

      expect((await env.groupState.getGroups(1))?.[0]?.name).toBe('G1');
    });

    it('gives the empty title as the name', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 50)]);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: '' });

      expect((await env.groupState.getGroups(1))?.[0]?.name).toBe('');
    });

    it('does not write the groups when none of them has the native group', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 60)]);
      const setGroups = vi.spyOn(env.groupState, 'setGroups');

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'x' });

      expect(setGroups).not.toHaveBeenCalled();
    });

    it('keeps the native group', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1, 50)]);

      await env.sync.onUpdated({ id: 50, windowId: 1, title: 'x' });

      expect(await nativeIds(env)).toEqual([50]);
    });

    it('says so when it cannot', async () => {
      const env = setUp();
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
