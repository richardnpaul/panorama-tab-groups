import { beforeEach, describe, expect, it } from 'vitest';
import type { Group, GroupState } from '../../src/js/ports/group-state.js';

const group = (id: number, name = `Group ${String(id)}`): Group => ({
  id,
  name,
  containerId: 'firefox-default',
  rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
  lastMoved: 1_700_000_000_000,
  nativeGroupId: null,
});

/**
 * What every GroupState must do, whatever it stores the state in. It runs
 * against the real browser adapter and against the in-memory fake, so the
 * fake cannot drift from the real thing.
 */
export function describeGroupStateContract(
  name: string,
  create: () => GroupState,
): void {
  describe(`GroupState contract: ${name}`, () => {
    let state: GroupState;

    beforeEach(() => {
      state = create();
    });

    describe('before anything is stored', () => {
      it('has no groups, active group or group index for a window', async () => {
        await expect(state.getGroups(1)).resolves.toBeUndefined();
        await expect(state.getActiveGroup(1)).resolves.toBeUndefined();
        await expect(state.getGroupIndex(1)).resolves.toBeUndefined();
      });

      it('has no group for a tab', async () => {
        await expect(state.getTabGroup(7)).resolves.toBeUndefined();
      });

      it('has no version for what is stored of a window', async () => {
        await expect(state.getSchemaVersion(1)).resolves.toBeUndefined();
      });
    });

    describe('links to native groups', () => {
      const linked = (id: number, nativeGroupId: number): Group => ({
        ...group(id),
        nativeGroupId,
      });

      it('gives each group the link set for it, in its window only', async () => {
        await state.setGroups(1, [group(1), group(2)]);
        await state.setGroups(2, [group(1)]);

        await state.setNativeGroupLink(1, 2, 500);

        await expect(state.getGroups(1)).resolves.toEqual([
          group(1),
          linked(2, 500),
        ]);
        await expect(state.getGroups(2)).resolves.toEqual([group(1)]);
      });

      it('does not store a link given with the groups, which could be an old one', async () => {
        await state.setGroups(1, [group(1)]);
        await state.setNativeGroupLink(1, 1, 500);

        await state.setGroups(1, [linked(1, 400), linked(2, 600)]);

        // A group stored with a number has no link at all, not none
        await expect(state.getGroups(1)).resolves.toEqual([
          linked(1, 500),
          { ...group(2), nativeGroupId: undefined },
        ]);
      });

      it('keeps a group that has no native group as one', async () => {
        const { nativeGroupId, ...unknown } = group(1);
        await state.setGroups(1, [unknown, group(2)]);

        await expect(state.getGroups(1)).resolves.toEqual([unknown, group(2)]);
        expect(nativeGroupId).toBeNull();
      });

      it('forgets a link when told to, and changes nothing else', async () => {
        await state.setGroups(1, [group(1), group(2)]);
        await state.setNativeGroupLink(1, 1, 500);
        await state.setNativeGroupLink(1, 2, 600);

        await state.setNativeGroupLink(1, 1, undefined);

        await expect(state.getGroups(1)).resolves.toEqual([
          group(1),
          linked(2, 600),
        ]);
      });

      it('forgets the link of a group that is no longer among the groups, so a group of that id later has none', async () => {
        await state.setGroups(1, [group(1), group(2)]);
        await state.setNativeGroupLink(1, 2, 600);

        await state.setGroups(1, [group(1)]);
        await state.setGroups(1, [group(1), group(2)]);

        await expect(state.getGroups(1)).resolves.toEqual([group(1), group(2)]);
      });

      it('keeps the links of other windows when a window’s groups are stored', async () => {
        await state.setGroups(1, [group(1)]);
        await state.setGroups(12, [group(1)]);
        await state.setNativeGroupLink(12, 1, 700);

        await state.setGroups(1, []);

        await expect(state.getGroups(12)).resolves.toEqual([linked(1, 700)]);
      });

      it('gives no groups for a window whose groups were never stored, whatever links it has', async () => {
        await state.setNativeGroupLink(3, 1, 500);

        await expect(state.getGroups(3)).resolves.toBeUndefined();
      });
    });

    describe('the version of what is stored of a window', () => {
      it('gives back the version that was stored, for that window only', async () => {
        await state.setSchemaVersion(1, 2);
        await state.setSchemaVersion(1, 3);

        await expect(state.getSchemaVersion(1)).resolves.toBe(3);
        await expect(state.getSchemaVersion(2)).resolves.toBeUndefined();
      });

      it.each([0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'gives no version for %d, which is not one',
        async (version) => {
          await state.setSchemaVersion(1, version);

          await expect(state.getSchemaVersion(1)).resolves.toBeUndefined();
        },
      );

      it('is kept apart from the groups, the active group and the group index', async () => {
        await state.setSchemaVersion(1, 2);

        await expect(state.getGroups(1)).resolves.toBeUndefined();
        await expect(state.getActiveGroup(1)).resolves.toBeUndefined();
        await expect(state.getGroupIndex(1)).resolves.toBeUndefined();
      });
    });

    describe('groups', () => {
      it('gives back the groups that were stored', async () => {
        await state.setGroups(1, [group(1), group(2)]);

        await expect(state.getGroups(1)).resolves.toEqual([group(1), group(2)]);
      });

      it('keeps the order of the groups', async () => {
        await state.setGroups(1, [group(3), group(1), group(2)]);

        const stored = await state.getGroups(1);

        expect(stored?.map(({ id }) => id)).toEqual([3, 1, 2]);
      });

      it('replaces the previous groups', async () => {
        await state.setGroups(1, [group(1), group(2)]);
        await state.setGroups(1, [group(3)]);

        await expect(state.getGroups(1)).resolves.toEqual([group(3)]);
      });

      it('can store an empty list, which is not the same as nothing', async () => {
        await state.setGroups(1, []);

        await expect(state.getGroups(1)).resolves.toEqual([]);
      });

      it('keeps the groups of each window apart', async () => {
        await state.setGroups(1, [group(1)]);
        await state.setGroups(2, [group(2)]);

        await expect(state.getGroups(1)).resolves.toEqual([group(1)]);
        await expect(state.getGroups(2)).resolves.toEqual([group(2)]);
        await expect(state.getGroups(3)).resolves.toBeUndefined();
      });

      it('is not affected by changing the list after storing it', async () => {
        const groups = [group(1)];
        await state.setGroups(1, groups);

        groups.push(group(2));
        const first = groups[0];
        if (first) {
          first.name = 'Changed';
        }

        await expect(state.getGroups(1)).resolves.toEqual([group(1)]);
      });

      it('hands out a copy, so changing it does not change the stored groups', async () => {
        await state.setGroups(1, [group(1)]);

        const stored = await state.getGroups(1);
        stored?.push(group(2));
        const first = stored?.[0];
        if (first) {
          first.name = 'Changed';
        }

        await expect(state.getGroups(1)).resolves.toEqual([group(1)]);
      });
    });

    describe('active group', () => {
      it('gives back the active group that was stored', async () => {
        await state.setActiveGroup(1, 5);

        await expect(state.getActiveGroup(1)).resolves.toBe(5);
      });

      it.each([0, -1, -2])('can store %s', async (id) => {
        await state.setActiveGroup(1, id);

        await expect(state.getActiveGroup(1)).resolves.toBe(id);
      });

      it('replaces the previous one', async () => {
        await state.setActiveGroup(1, 5);
        await state.setActiveGroup(1, 6);

        await expect(state.getActiveGroup(1)).resolves.toBe(6);
      });

      it('is kept apart for each window', async () => {
        await state.setActiveGroup(1, 5);
        await state.setActiveGroup(2, 6);

        await expect(state.getActiveGroup(1)).resolves.toBe(5);
        await expect(state.getActiveGroup(2)).resolves.toBe(6);
      });
    });

    describe('group index', () => {
      it('gives back the index that was stored', async () => {
        await state.setGroupIndex(1, 4);

        await expect(state.getGroupIndex(1)).resolves.toBe(4);
      });

      it('can store 0', async () => {
        await state.setGroupIndex(1, 0);

        await expect(state.getGroupIndex(1)).resolves.toBe(0);
      });

      it('is kept apart for each window', async () => {
        await state.setGroupIndex(1, 4);
        await state.setGroupIndex(2, 9);

        await expect(state.getGroupIndex(1)).resolves.toBe(4);
        await expect(state.getGroupIndex(2)).resolves.toBe(9);
      });
    });

    describe('tab groups', () => {
      it('gives back the group that was stored for a tab', async () => {
        await state.setTabGroup(7, 3);

        await expect(state.getTabGroup(7)).resolves.toBe(3);
      });

      it.each([0, -1, -2])('can store %s', async (id) => {
        await state.setTabGroup(7, id);

        await expect(state.getTabGroup(7)).resolves.toBe(id);
      });

      it('replaces the previous group', async () => {
        await state.setTabGroup(7, 3);
        await state.setTabGroup(7, 4);

        await expect(state.getTabGroup(7)).resolves.toBe(4);
      });

      it('is kept apart for each tab', async () => {
        await state.setTabGroup(7, 3);
        await state.setTabGroup(8, 4);

        await expect(state.getTabGroup(7)).resolves.toBe(3);
        await expect(state.getTabGroup(8)).resolves.toBe(4);
      });

      it('is not mixed up with a window that has the same number', async () => {
        await state.setTabGroup(1, 3);
        await state.setActiveGroup(1, 9);

        await expect(state.getTabGroup(1)).resolves.toBe(3);
        await expect(state.getActiveGroup(1)).resolves.toBe(9);
      });
    });

    describe('forgetting the group of a tab', () => {
      it('leaves the tab without a group', async () => {
        await state.setTabGroup(7, 3);

        await state.clearTabGroup(7);

        await expect(state.getTabGroup(7)).resolves.toBeUndefined();
      });

      it('only forgets the tab it was asked about', async () => {
        await state.setTabGroup(7, 3);
        await state.setTabGroup(8, 4);

        await state.clearTabGroup(7);

        await expect(state.getTabGroup(8)).resolves.toBe(4);
      });

      it('does not mind a tab that had no group', async () => {
        await expect(state.clearTabGroup(7)).resolves.toBeUndefined();
      });

      it('lets the tab be given a group again', async () => {
        await state.setTabGroup(7, 3);
        await state.clearTabGroup(7);

        await state.setTabGroup(7, 5);

        await expect(state.getTabGroup(7)).resolves.toBe(5);
      });

      it('does not touch a window with the same number', async () => {
        await state.setTabGroup(1, 3);
        await state.setActiveGroup(1, 9);

        await state.clearTabGroup(1);

        await expect(state.getActiveGroup(1)).resolves.toBe(9);
      });
    });

    describe('the different kinds of state', () => {
      it('do not overwrite each other', async () => {
        await state.setGroups(1, [group(1)]);
        await state.setActiveGroup(1, 2);
        await state.setGroupIndex(1, 3);

        await expect(state.getGroups(1)).resolves.toEqual([group(1)]);
        await expect(state.getActiveGroup(1)).resolves.toBe(2);
        await expect(state.getGroupIndex(1)).resolves.toBe(3);
      });
    });
  });
}

/**
 * What a GroupState that keeps its values under the id of their window or tab (Chromium) does
 * beyond the rest: it lists and forgets them, and dates a window that closed.
 */
export function describeStoredIdsContract(
  name: string,
  create: () => GroupState,
): void {
  describe(`GroupState contract for values kept by id: ${name}`, () => {
    let state: GroupState;

    beforeEach(() => {
      state = create();
    });

    it('lists nothing before anything is stored', async () => {
      await expect(state.listStoredWindowIds()).resolves.toEqual([]);
      await expect(state.listStoredTabIds()).resolves.toEqual([]);
    });

    it('lists the windows and the tabs that values are stored for, each once', async () => {
      await state.setGroups(3, [group(1)]);
      await state.setActiveGroup(3, 1);
      await state.setActiveGroup(8, 1);
      await state.setTabGroup(20, 1);
      await state.setTabGroup(21, 1);

      expect((await state.listStoredWindowIds()).sort()).toEqual([3, 8]);
      expect((await state.listStoredTabIds()).sort()).toEqual([20, 21]);
    });

    it('forgets every value of a window, and no other window’s', async () => {
      await state.setGroups(3, [group(1)]);
      await state.setActiveGroup(3, 1);
      await state.setGroupIndex(3, 2);
      await state.setSchemaVersion(3, 5);
      await state.setClosedAt(3, 99);
      await state.setNativeGroupLink(3, 1, 500);
      await state.setGroups(4, [group(1)]);

      await state.forgetWindow(3);

      await expect(state.listStoredWindowIds()).resolves.toEqual([4]);
      await expect(state.getGroups(3)).resolves.toBeUndefined();
      await expect(state.getActiveGroup(3)).resolves.toBeUndefined();
      await expect(state.getGroupIndex(3)).resolves.toBeUndefined();
      await expect(state.getSchemaVersion(3)).resolves.toBeUndefined();
      await expect(state.getClosedAt(3)).resolves.toBeUndefined();
      await expect(state.getGroups(4)).resolves.toEqual([group(1)]);
    });

    it('forgets the links of a window with it, so a group of that id later has none', async () => {
      await state.setGroups(3, [group(1)]);
      await state.setNativeGroupLink(3, 1, 500);
      await state.setGroups(4, [group(1)]);
      await state.setNativeGroupLink(4, 1, 600);

      await state.forgetWindow(3);
      await state.setGroups(3, [group(1)]);

      await expect(state.getGroups(3)).resolves.toEqual([group(1)]);
      await expect(state.getGroups(4)).resolves.toEqual([
        { ...group(1), nativeGroupId: 600 },
      ]);
    });

    it('forgets a window it has no values for without failing', async () => {
      await expect(state.forgetWindow(9)).resolves.toBeUndefined();
    });

    it('forgets a tab, and no other tab', async () => {
      await state.setTabGroup(20, 1);
      await state.setTabGroup(21, 1);

      await state.forgetTab(20);

      await expect(state.listStoredTabIds()).resolves.toEqual([21]);
      await expect(state.getTabGroup(20)).resolves.toBeUndefined();
      await expect(state.getTabGroup(21)).resolves.toBe(1);
    });

    it('forgets a tab it has no values for without failing', async () => {
      await expect(state.forgetTab(9)).resolves.toBeUndefined();
    });

    it('says when a window was closed, for that window only, and none before', async () => {
      await expect(state.getClosedAt(3)).resolves.toBeUndefined();

      await state.setClosedAt(3, 1234);
      await state.setClosedAt(3, 5678);

      await expect(state.getClosedAt(3)).resolves.toBe(5678);
      await expect(state.getClosedAt(4)).resolves.toBeUndefined();
      await expect(state.listStoredWindowIds()).resolves.toEqual([3]);
    });
  });
}
