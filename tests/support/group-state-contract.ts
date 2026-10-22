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
