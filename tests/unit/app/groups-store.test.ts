import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMessaging } from '../../../src/js/adapters/memory/messaging.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createGroupsStore } from '../../../src/js/app/groups-store.js';
import type { Group } from '../../../src/js/ports/group-state.js';

const WINDOW = 7;

const stored = (id: number, extra: Partial<Group> = {}): Group => ({
  id,
  name: `Stored ${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
  ...extra,
});

async function setUp(groups: readonly Group[] | null = [stored(1), stored(2)]) {
  const groupState = createMemoryGroupState();
  if (groups !== null) {
    await groupState.setGroups(WINDOW, groups);
  }
  const messaging = createMemoryMessaging();
  const tabs = createMemoryTabs();
  const clock = createMemoryClock(5000);
  const logger = { error: vi.fn() };
  const i18n = { getMessage: vi.fn().mockReturnValue('Group ') };
  const store = await createGroupsStore(
    { groupState, messaging, tabs, clock, i18n, logger },
    WINDOW,
  );
  return { store, groupState, messaging, tabs, clock, logger, i18n };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('app/groups-store.ts', () => {
  describe('loading', () => {
    it('holds the groups stored for its window, in order', async () => {
      const { store } = await setUp([stored(3), stored(1), stored(2)]);

      expect(store.getIds()).toEqual([3, 1, 2]);
      expect(store.getLength()).toBe(3);
    });

    it('leaves out the system groups and any other negative id', async () => {
      const { store } = await setUp([
        stored(-1),
        stored(1),
        stored(-2),
        stored(0),
        stored(-3),
        stored(2),
      ]);

      expect(store.getIds()).toEqual([1, 0, 2]);
    });

    it('starts empty when nothing is stored', async () => {
      const { store } = await setUp(null);

      expect(store.getLength()).toBe(0);
      expect(store.getIds()).toEqual([]);
    });

    it('starts every group with no tabs counted', async () => {
      const { store } = await setUp([stored(1, { tabCount: 9 })]);

      expect(store.get(1)?.tabCount).toBe(0);
    });

    it('reads the state of its own window only', async () => {
      const { groupState } = await setUp();
      await groupState.setGroups(WINDOW + 1, [stored(50)]);

      const other = await createGroupsStore(
        {
          groupState,
          messaging: createMemoryMessaging(),
          tabs: createMemoryTabs(),
          clock: createMemoryClock(),
          i18n: { getMessage: () => '' },
          logger: { error: vi.fn() },
        },
        WINDOW + 1,
      );

      expect(other.getIds()).toEqual([50]);
    });
  });

  describe('reading', () => {
    it('finds a group by id', async () => {
      const { store } = await setUp();

      expect(store.get(2)?.name).toBe('Stored 2');
    });

    it('gives null for an id it does not know', async () => {
      const { store } = await setUp();

      expect(store.get(99)).toBeNull();
    });

    it('gives the name of a group, or nothing for an unknown id', async () => {
      const { store } = await setUp();

      expect(store.getName(1)).toBe('Stored 1');
      expect(store.getName(99)).toBeUndefined();
    });

    it('hands out the live group, so changes to it are kept', async () => {
      const { store } = await setUp();

      const group = store.get(1);
      if (group) {
        group.tabCount = 4;
      }

      expect(store.get(1)?.tabCount).toBe(4);
    });

    it('goes through every group in order with the live group', async () => {
      const { store } = await setUp([stored(5), stored(6)]);
      const seen: Group[] = [];

      store.forEach((group) => {
        seen.push(group);
      });

      expect(seen.map(({ id }) => id)).toEqual([5, 6]);
      expect(seen[0]).toBe(store.get(5));
      expect(seen[1]).toBe(store.get(6));
    });

    it('passes only the group to the callback', async () => {
      const { store } = await setUp([stored(1)]);
      const callback = vi.fn();

      store.forEach(callback);

      expect(callback.mock.calls[0]).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('makes the next group, named after the language and its id', async () => {
      const { store, groupState, i18n } = await setUp();
      await groupState.setGroupIndex(WINDOW, 3);
      i18n.getMessage.mockReturnValue('Gruppe ');

      const group = await store.create();

      expect(i18n.getMessage).toHaveBeenCalledWith('defaultGroupName');
      expect(group).toEqual({
        id: 3,
        name: 'Gruppe 3',
        windowId: WINDOW,
        containerId: 'firefox-default',
        rect: { x: 0, y: 0, w: 0.2, h: 0.2 },
        lastMoved: 5000,
      });
    });

    it('starts at 0 when no group was made before in the window', async () => {
      const { store } = await setUp();

      expect((await store.create()).id).toBe(0);
    });

    it('moves the index on, so the next group gets the next id', async () => {
      const { store, groupState } = await setUp();
      await groupState.setGroupIndex(WINDOW, 3);

      await store.create();
      const second = await store.create();

      expect(second.id).toBe(4);
      await expect(groupState.getGroupIndex(WINDOW)).resolves.toBe(5);
    });

    it('adds the group to the store and saves all the groups', async () => {
      const { store, groupState } = await setUp();

      const group = await store.create();

      expect(store.getIds()).toEqual([1, 2, group.id]);
      expect(store.get(group.id)).toBe(group);
      const saved = await groupState.getGroups(WINDOW);
      expect(saved?.map(({ id }) => id)).toEqual([1, 2, group.id]);
    });

    it('tells the background to add a menu item for the group', async () => {
      const { store, messaging, groupState } = await setUp();
      await groupState.setGroupIndex(WINDOW, 3);

      await store.create();

      expect(messaging.sent).toEqual([
        { action: 'createMenuItem', groupId: '3', groupName: 'Group 3' },
      ]);
    });

    it('still makes the group when the menu item cannot be added, and says so', async () => {
      const { store, messaging, logger } = await setUp();
      const failure = new Error('background is asleep');
      messaging.fail(failure);

      const group = await store.create();
      await flush();

      expect(store.get(group.id)).toBe(group);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to update the menu:',
        failure,
      );
    });

    it('does not complain when the menu item was added', async () => {
      const { store, logger } = await setUp();

      await store.create();
      await flush();

      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('renames the group, saves it and updates its menu item', async () => {
      const { store, groupState, messaging } = await setUp();

      await store.rename(2, 'Renamed');

      expect(store.getName(2)).toBe('Renamed');
      expect((await groupState.getGroups(WINDOW))?.[1]?.name).toBe('Renamed');
      expect(messaging.sent).toEqual([
        { action: 'updateMenuItem', groupId: '2', groupName: 'Renamed' },
      ]);
    });

    it('does nothing for an unknown group', async () => {
      const { store, groupState, messaging } = await setUp();

      await store.rename(99, 'Renamed');

      expect(messaging.sent).toEqual([]);
      expect(
        (await groupState.getGroups(WINDOW))?.map(({ name }) => name),
      ).toEqual(['Stored 1', 'Stored 2']);
    });

    it('says so when the menu item cannot be updated, and still renames', async () => {
      const { store, messaging, logger } = await setUp();
      const failure = new Error('no receiver');
      messaging.fail(failure);

      await store.rename(1, 'New');
      await flush();

      expect(store.getName(1)).toBe('New');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to update the menu:',
        failure,
      );
    });
  });

  describe('transform', () => {
    it('moves and resizes the group, stamps the time and saves', async () => {
      const { store, groupState, clock } = await setUp();
      clock.set(8000);
      const rect = { x: 0.5, y: 0.6, w: 0.7, h: 0.8 };

      await store.transform(2, rect);

      expect(store.get(2)?.rect).toBe(rect);
      expect(store.get(2)?.lastMoved).toBe(8000);
      const saved = (await groupState.getGroups(WINDOW))?.[1];
      expect(saved?.rect).toEqual(rect);
      expect(saved?.lastMoved).toBe(8000);
    });

    it('does nothing for an unknown group', async () => {
      const { store, groupState } = await setUp();

      await store.transform(99, { x: 1, y: 1, w: 1, h: 1 });

      expect((await groupState.getGroups(WINDOW))?.[0]?.rect).toEqual({
        x: 0.1,
        y: 0.2,
        w: 0.3,
        h: 0.4,
      });
    });
  });

  describe('moveTo', () => {
    const three = [stored(1), stored(2), stored(3)];

    it('puts the group in the gap it was dropped in, and saves the order', async () => {
      const { store, groupState } = await setUp(three);

      await store.moveTo(1, 3);

      expect(store.getIds()).toEqual([2, 3, 1]);
      const saved = await groupState.getGroups(WINDOW);
      expect(saved?.map(({ id }) => id)).toEqual([2, 3, 1]);
    });

    it('moves a group to the front', async () => {
      const { store } = await setUp(three);

      await store.moveTo(3, 0);

      expect(store.getIds()).toEqual([3, 1, 2]);
    });

    it('keeps the groups themselves', async () => {
      const { store } = await setUp(three);
      const second = store.get(2);

      await store.moveTo(2, 0);

      expect(store.get(2)).toBe(second);
    });

    it('leaves the order and the saved groups as they are for an unknown group', async () => {
      const { store, groupState } = await setUp(three);
      const save = vi.spyOn(groupState, 'setGroups');

      await store.moveTo(99, 0);

      expect(store.getIds()).toEqual([1, 2, 3]);
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('the active group', () => {
    it('is kept in the state of the window', async () => {
      const { store, groupState } = await setUp();

      await store.setActive(2);

      await expect(store.getActive()).resolves.toBe(2);
      await expect(groupState.getActiveGroup(WINDOW)).resolves.toBe(2);
    });

    it('is nothing until one is set', async () => {
      const { store } = await setUp();

      await expect(store.getActive()).resolves.toBeUndefined();
    });
  });

  describe('remove', () => {
    it('asks the background to delete the group with the tabs that belong to it', async () => {
      const { store, messaging, tabs, groupState } = await setUp([
        stored(1, { nativeGroupId: 44 }),
        stored(2),
      ]);
      tabs.setIds([101, 102, 103]);
      await groupState.setTabGroup(101, 1);
      await groupState.setTabGroup(102, 2);
      await groupState.setTabGroup(103, 1);
      messaging.reply({ success: true });

      await store.remove(1);

      expect(messaging.sent).toEqual([
        {
          action: 'deleteGroup',
          groupId: 1,
          windowId: WINDOW,
          nativeGroupId: 44,
          tabIds: [101, 103],
        },
      ]);
    });

    it('sends no native group id for a group without one', async () => {
      const { store, messaging } = await setUp();
      messaging.reply({ success: true });

      await store.remove(1);

      expect(messaging.sent[0]).toHaveProperty('nativeGroupId', undefined);
    });

    it('lists the tabs of the group in the order the window has them', async () => {
      const { store, messaging, tabs, groupState } = await setUp();
      tabs.setIds([9, 3, 6]);
      await Promise.all([9, 3, 6].map((id) => groupState.setTabGroup(id, 1)));
      messaging.reply({ success: true });

      await store.remove(1);

      expect(messaging.sent[0]).toHaveProperty('tabIds', [9, 3, 6]);
    });

    it('drops the group from the store once the background has deleted it', async () => {
      const { store, messaging } = await setUp();
      messaging.reply({ success: true });

      await store.remove(1);

      expect(store.getIds()).toEqual([2]);
      expect(store.get(1)).toBeNull();
    });

    it('leaves saving the groups to the background', async () => {
      const { store, messaging, groupState } = await setUp();
      messaging.reply({ success: true });

      await store.remove(1);

      expect((await groupState.getGroups(WINDOW))?.map(({ id }) => id)).toEqual(
        [1, 2],
      );
    });

    it('does nothing for an unknown group', async () => {
      const { store, messaging } = await setUp();

      await store.remove(99);

      expect(messaging.sent).toEqual([]);
      expect(store.getLength()).toBe(2);
    });

    it('keeps the group and reports why when the background could not delete it', async () => {
      const { store, messaging, logger } = await setUp();
      messaging.reply({ success: false, error: 'Failed' });

      await store.remove(1);

      expect(store.getIds()).toEqual([1, 2]);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to delete group 1:',
        'Failed',
      );
    });

    it.each([
      ['no answer', undefined],
      ['a null answer', null],
      ['an answer that is not an object', 'nope'],
      ['an answer without an error', { success: false }],
      ['an empty error', { success: false, error: '' }],
      ['an error that is not text', { success: false, error: 5 }],
    ])('reports that there was no answer for %s', async (_name, answer) => {
      const { store, messaging, logger } = await setUp();
      messaging.reply(answer);

      await store.remove(1);

      expect(store.getIds()).toEqual([1, 2]);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to delete group 1:',
        'No response',
      );
    });

    it.each([
      ['a success that is not true', { success: 'yes' }],
      ['no success flag', {}],
    ])('does not delete on %s', async (_name, answer) => {
      const { store, messaging } = await setUp();
      messaging.reply(answer);

      await store.remove(1);

      expect(store.getIds()).toEqual([1, 2]);
    });
  });
});
