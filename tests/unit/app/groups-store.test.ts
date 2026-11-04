import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryMessaging } from '../../../src/js/adapters/memory/messaging.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createGroupsStore } from '../../../src/js/app/groups-store.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import { storeGroups } from '../../support/stored-groups.js';

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
    await storeGroups(groupState, WINDOW, groups);
  }
  const messaging = createMemoryMessaging();
  const tabs = createMemoryTabs();
  const clock = createMemoryClock(5000);
  const logger = { error: vi.fn() };
  const i18n = { getMessage: vi.fn().mockReturnValue('Group ') };
  const nativeGroups = createMemoryNativeGroups([50], WINDOW);
  const store = await createGroupsStore(
    { groupState, messaging, nativeGroups, tabs, clock, i18n, logger },
    WINDOW,
  );
  return {
    store,
    groupState,
    messaging,
    nativeGroups,
    tabs,
    clock,
    logger,
    i18n,
  };
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
          nativeGroups: createMemoryNativeGroups(),
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

    it('makes nothing when the group cannot be stored, and says so to the caller', async () => {
      const { store, groupState, messaging } = await setUp();
      const failure = new Error('storage is full');
      vi.spyOn(groupState, 'setGroups').mockRejectedValue(failure);

      await expect(store.create()).rejects.toBe(failure);

      expect(store.getIds()).toEqual([1, 2]);
      expect(messaging.sent).toEqual([]);
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

    it('gives the native group of the group the new name as its title, before the name is stored', async () => {
      const env = await setUp([stored(1, { nativeGroupId: 50 }), stored(2)]);
      await env.groupState.setNativeGroupLink(WINDOW, 1, 50);
      const titleWhenStored: (string | undefined)[] = [];
      const setGroups = env.groupState.setGroups.bind(env.groupState);
      vi.spyOn(env.groupState, 'setGroups').mockImplementation(
        async (windowId, groups) => {
          titleWhenStored.push(env.nativeGroups.groups.get(50)?.title);
          await setGroups(windowId, groups);
        },
      );

      await env.store.rename(1, 'Renamed');

      expect(env.nativeGroups.calls).toEqual(['title 50 Renamed']);
      expect(titleWhenStored).toEqual(['Renamed']);
    });

    it('gives the title to the native group the group was linked to after the view loaded', async () => {
      const env = await setUp();
      // The background links the group once the view has its copy, as a native group made then
      await env.groupState.setNativeGroupLink(WINDOW, 1, 50);

      await env.store.rename(1, 'Renamed');

      expect(env.nativeGroups.calls).toEqual(['title 50 Renamed']);
    });

    it('gives no native group a title for a group the background has deleted since the view loaded', async () => {
      const env = await setUp([stored(1, { nativeGroupId: 50 }), stored(2)]);
      await env.groupState.setGroups(WINDOW, [stored(2)]);

      await env.store.rename(1, 'Renamed');

      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('changes nothing when the groups cannot be read for the link, and says so to the caller', async () => {
      const env = await setUp();
      const failure = new Error('storage is gone');
      vi.spyOn(env.groupState, 'getGroups').mockRejectedValue(failure);

      await expect(env.store.rename(1, 'Renamed')).rejects.toBe(failure);

      expect(env.store.getName(1)).toBe('Stored 1');
      expect(env.messaging.sent).toEqual([]);
    });

    it('changes nothing when the name cannot be stored: the native group gets its title back', async () => {
      const env = await setUp([stored(1, { name: 'Work', nativeGroupId: 50 })]);
      await env.groupState.setNativeGroupLink(WINDOW, 1, 50);
      await env.nativeGroups.setTitle(50, 'Work');
      const failure = new Error('storage is full');
      vi.spyOn(env.groupState, 'setGroups').mockRejectedValue(failure);

      await expect(env.store.rename(1, 'Play')).rejects.toBe(failure);

      expect(env.store.getName(1)).toBe('Work');
      expect(env.nativeGroups.groups.get(50)?.title).toBe('Work');
      expect(env.messaging.sent).toEqual([]);
    });

    it('gives no native group a title back when it gave none the new one', async () => {
      const env = await setUp([stored(1, { name: 'Work' })]);
      const failure = new Error('storage is full');
      vi.spyOn(env.groupState, 'setGroups').mockRejectedValue(failure);

      await expect(env.store.rename(1, 'Play')).rejects.toBe(failure);

      expect(env.nativeGroups.calls).toEqual([]);
      expect(env.store.getName(1)).toBe('Work');
    });

    it('gives no title back to a native group that would not take the new one', async () => {
      const env = await setUp([stored(1, { name: 'Work', nativeGroupId: 70 })]);
      await env.groupState.setNativeGroupLink(WINDOW, 1, 70);
      vi.spyOn(env.groupState, 'setGroups').mockRejectedValue(
        new Error('storage is full'),
      );
      const setTitle = vi.spyOn(env.nativeGroups, 'setTitle');

      await expect(env.store.rename(1, 'Play')).rejects.toThrow();

      expect(setTitle).toHaveBeenCalledTimes(1);
    });

    it('says so when the native group cannot be given its title back', async () => {
      const env = await setUp([stored(1, { name: 'Work', nativeGroupId: 50 })]);
      await env.groupState.setNativeGroupLink(WINDOW, 1, 50);
      const failure = new Error('storage is full');
      vi.spyOn(env.groupState, 'setGroups').mockRejectedValue(failure);
      const titleFailure = new Error('dragging a tab');
      vi.spyOn(env.nativeGroups, 'setTitle')
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(titleFailure);

      await expect(env.store.rename(1, 'Play')).rejects.toBe(failure);

      expect(env.logger.error).toHaveBeenCalledWith(
        'Could not give native group 50 back the name of group 1:',
        titleFailure,
      );
    });

    it('stores a copy with the new name, and only then changes its own', async () => {
      const env = await setUp([
        stored(1, { name: 'Work' }),
        stored(2, { name: 'Home' }),
      ]);
      const nameWhenStored: (string | undefined)[] = [];
      const setGroups = env.groupState.setGroups.bind(env.groupState);
      vi.spyOn(env.groupState, 'setGroups').mockImplementation(
        async (windowId, groups) => {
          nameWhenStored.push(env.store.getName(1));
          await setGroups(windowId, groups);
        },
      );

      await env.store.rename(1, 'Play');

      expect(nameWhenStored).toEqual(['Work']);
      expect(env.store.getName(1)).toBe('Play');
      expect(
        (await env.groupState.getGroups(WINDOW))?.map(({ name }) => name),
      ).toEqual(['Play', 'Home']);
    });

    it('gives no native group a title for a group that has none', async () => {
      const env = await setUp();

      await env.store.rename(2, 'Renamed');

      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('says so, and still renames, when the native group cannot be given the title', async () => {
      const env = await setUp([stored(1, { nativeGroupId: 70 }), stored(2)]);
      await env.groupState.setNativeGroupLink(WINDOW, 1, 70);

      await env.store.rename(1, 'Renamed');

      expect(env.logger.error).toHaveBeenCalledWith(
        'Could not give native group 70 the new name of group 1:',
        new Error('No group with id: 70'),
      );
      expect((await env.groupState.getGroups(WINDOW))?.[0]?.name).toBe(
        'Renamed',
      );
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

  describe('changes made while another is being stored', () => {
    // Each store of the groups holds until it is let go, once it has written
    function slowStores(env: Awaited<ReturnType<typeof setUp>>) {
      const setGroups = env.groupState.setGroups.bind(env.groupState);
      const written: (() => void)[] = [];
      vi.spyOn(env.groupState, 'setGroups').mockImplementation(
        async (windowId, groups) => {
          await setGroups(windowId, groups);
          await new Promise<void>((resolve) => {
            written.push(resolve);
          });
        },
      );
      return {
        letGo: async () => {
          await flush();
          written.splice(0).forEach((resolve) => {
            resolve();
          });
        },
      };
    }

    it('keeps the new name when the groups are stored again while it is stored', async () => {
      const env = await setUp();
      const stores = slowStores(env);

      const renaming = env.store.rename(1, 'New');
      await flush();
      const moving = env.store.transform(2, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
      await stores.letGo();
      await stores.letGo();
      await stores.letGo();
      await Promise.all([renaming, moving]);

      expect(
        (await env.groupState.getGroups(WINDOW))?.map(({ name }) => name),
      ).toEqual(['New', 'Stored 2']);
      expect(env.store.get(2)?.rect).toEqual({
        x: 0.5,
        y: 0.5,
        w: 0.1,
        h: 0.1,
      });
    });

    it('does not store a group being deleted again when another change is stored meanwhile', async () => {
      const env = await setUp();
      let reply: (answer: unknown) => void = () => undefined;
      const asked = new Promise<void>((askedToDelete) => {
        vi.spyOn(env.messaging, 'send').mockImplementation(
          (message) =>
            new Promise((resolve) => {
              if ('action' in message && message.action === 'deleteGroup') {
                reply = resolve;
                askedToDelete();
              } else {
                resolve(undefined);
              }
            }),
        );
      });

      const removing = env.store.remove(1);
      await asked;
      // The background deletes it, and stores the groups without it
      await env.groupState.setGroups(WINDOW, [stored(2)]);
      const moving = env.store.transform(2, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
      reply({ success: true });
      await Promise.all([removing, moving]);

      expect(
        (await env.groupState.getGroups(WINDOW))?.map(({ id }) => id),
      ).toEqual([2]);
    });

    it('moves and orders its own groups at once, while an earlier change is still being stored', async () => {
      const env = await setUp([stored(1), stored(2), stored(3)]);
      // The background never answers the delete, which holds the changes after it
      vi.spyOn(env.messaging, 'send').mockReturnValue(
        new Promise(() => {
          // never settles
        }),
      );
      const rect = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };

      const changes = [
        env.store.remove(3),
        env.store.transform(2, rect),
        env.store.moveTo(2, 0),
      ];

      expect(env.store.get(2)?.rect).toBe(rect);
      expect(env.store.get(2)?.lastMoved).toBe(5000);
      expect(env.store.getIds()).toEqual([2, 1, 3]);
      expect(changes).toHaveLength(3);
    });

    it('goes on with the next change when one fails', async () => {
      const env = await setUp();
      vi.spyOn(env.groupState, 'setGroups')
        .mockRejectedValueOnce(new Error('storage is full'))
        .mockResolvedValue(undefined);

      const renaming = env.store.rename(1, 'New');
      const moving = env.store.moveTo(2, 0);

      await expect(renaming).rejects.toThrow('storage is full');
      await expect(moving).resolves.toBeUndefined();
      expect(env.store.getIds()).toEqual([2, 1]);
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

    it('sends the native group the group was linked to after the view loaded', async () => {
      const { store, messaging, groupState } = await setUp();
      await groupState.setNativeGroupLink(WINDOW, 1, 50);
      messaging.reply({ success: true });

      await store.remove(1);

      expect(messaging.sent[0]).toHaveProperty('nativeGroupId', 50);
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

    it('takes in the first group the background made when this was the last', async () => {
      const { store, messaging, groupState } = await setUp([stored(1)]);
      vi.spyOn(messaging, 'send').mockImplementation(async (message) => {
        if ('action' in message && message.action === 'deleteGroup') {
          // As the background does: the groups without it, and a new first one
          await groupState.setGroups(WINDOW, [
            stored(-2, { name: 'Ungrouped' }),
            stored(0, { name: 'Fresh' }),
          ]);
          return { success: true };
        }
        return undefined;
      });

      await expect(store.remove(1)).resolves.toBe(true);

      expect(store.getIds()).toEqual([0]);
      expect(store.get(0)?.name).toBe('Fresh');
      expect(store.get(0)?.tabCount).toBe(0);
    });

    it('takes in nothing when the window has no groups stored after the delete', async () => {
      const { store, messaging, groupState } = await setUp();
      vi.spyOn(messaging, 'send').mockImplementation(async (message) => {
        if ('action' in message && message.action === 'deleteGroup') {
          await groupState.forgetWindow(WINDOW);
          return { success: true };
        }
        return undefined;
      });

      await expect(store.remove(1)).resolves.toBe(true);

      expect(store.getIds()).toEqual([2]);
    });

    it('still says the group was deleted when the groups cannot be read after, and says so', async () => {
      const { store, messaging, groupState, logger } = await setUp();
      messaging.reply({ success: true });
      const failure = new Error('storage is gone');
      const getGroups = groupState.getGroups.bind(groupState);
      vi.spyOn(groupState, 'getGroups')
        .mockImplementationOnce(getGroups)
        .mockRejectedValue(failure);

      await expect(store.remove(1)).resolves.toBe(true);

      expect(store.getIds()).toEqual([2]);
      expect(logger.error).toHaveBeenCalledWith(
        'Could not read the groups of window 7 after group 1 was deleted:',
        failure,
      );
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

      await expect(store.remove(99)).resolves.toBe(false);

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
