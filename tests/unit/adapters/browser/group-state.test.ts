import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserGroupState,
  type SessionsApi,
} from '../../../../src/js/adapters/browser/group-state.js';
import type {
  Group,
  GroupState,
} from '../../../../src/js/ports/group-state.js';
import { createFakeSessionArea } from '../../../support/fake-session-area.js';
import { createFakeSessions } from '../../../support/fake-sessions.js';
import { describeGroupStateContract } from '../../../support/group-state-contract.js';

describeGroupStateContract('browser sessions adapter', () => {
  const { api } = createFakeSessions();
  return createBrowserGroupState(() => api);
});

const valid = (): Record<string, unknown> => ({
  id: 4,
  name: 'Four',
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
});

function setUp() {
  const fake = createFakeSessions();
  const state = createBrowserGroupState(() => fake.api);
  return { ...fake, state };
}

describe('adapters/browser/group-state.ts', () => {
  describe('links to native groups', () => {
    const four: Group = {
      id: 4,
      name: 'Four',
      rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
    };

    function withLinks() {
      const fake = createFakeSessions();
      const session = createFakeSessionArea();
      const state = createBrowserGroupState(() => ({
        sessions: fake.api.sessions,
        storage: { session: session.area },
      }));
      return { ...fake, session, state };
    }

    it('keeps each in `storage.session`, under the window and the group', async () => {
      const { state, session, windowValues, slot } = withLinks();
      await state.setGroups(3, [four]);

      await state.setNativeGroupLink(3, 4, 500);

      expect(Object.fromEntries(session.values)).toEqual({
        'nativeGroup:3:4': 500,
      });
      expect(windowValues.get(slot(3, 'groups'))).toEqual([four]);
    });

    it('asks nothing of `storage.session` for a window with no groups', async () => {
      const { state, session } = withLinks();
      await state.setGroups(3, []);
      const get = vi.spyOn(session.area, 'get');

      await expect(state.getGroups(3)).resolves.toEqual([]);

      expect(get).not.toHaveBeenCalled();
    });

    it('removes nothing when no link is gone', async () => {
      const { state, session } = withLinks();
      await state.setGroups(3, [four]);
      await state.setNativeGroupLink(3, 4, 500);
      const remove = vi.spyOn(session.area, 'remove');

      await state.setGroups(3, [four]);

      expect(remove).not.toHaveBeenCalled();
    });

    it('stores no groups when the links of the others cannot be let go of, so that a failure stores nothing', async () => {
      const { state, session } = withLinks();
      await state.setGroups(3, [four]);
      const failure = new Error('the extension is reloading');
      vi.spyOn(session.area, 'get').mockRejectedValue(failure);

      await expect(
        state.setGroups(3, [{ ...four, name: 'Renamed' }]),
      ).rejects.toBe(failure);

      vi.restoreAllMocks();
      expect((await state.getGroups(3))?.[0]?.name).toBe('Four');
    });

    it('keeps none in a browser without `storage.session` (Firefox before 115), and works on', async () => {
      const { api } = createFakeSessions();
      const state = createBrowserGroupState(() => ({
        sessions: api.sessions,
      }));
      await state.setGroups(3, [four]);

      await state.setNativeGroupLink(3, 4, 500);
      await state.setGroups(3, [four]);

      await expect(state.getGroups(3)).resolves.toEqual([four]);
    });
  });

  describe('where it keeps things', () => {
    it('keeps a window’s groups, active group and index under their own keys', async () => {
      const { state, windowValues, slot } = setUp();
      const groups: Group[] = [];

      await state.setGroups(3, groups);
      await state.setActiveGroup(3, 8);
      await state.setGroupIndex(3, 9);

      expect(windowValues.get(slot(3, 'groups'))).toEqual([]);
      expect(windowValues.get(slot(3, 'activeGroup'))).toBe(8);
      expect(windowValues.get(slot(3, 'groupIndex'))).toBe(9);
    });

    it('keeps a tab’s group under groupId', async () => {
      const { state, tabValues, slot } = setUp();

      await state.setTabGroup(5, 2);

      expect(tabValues.get(slot(5, 'groupId'))).toBe(2);
    });

    it('forgets a tab’s group by removing the groupId value', async () => {
      const removeTabValue = vi.fn().mockResolvedValue(undefined);
      const state = createBrowserGroupState((): SessionsApi => ({
        sessions: {
          getWindowValue: vi.fn(),
          setWindowValue: vi.fn(),
          getTabValue: vi.fn(),
          setTabValue: vi.fn(),
          removeTabValue,
        },
      }));

      await state.clearTabGroup(5);

      expect(removeTabValue).toHaveBeenCalledTimes(1);
      expect(removeTabValue).toHaveBeenCalledWith(5, 'groupId');
    });

    it('asks the browser for the right window and key', async () => {
      const getWindowValue = vi.fn().mockResolvedValue(undefined);
      const getTabValue = vi.fn().mockResolvedValue(undefined);
      const state = createBrowserGroupState((): SessionsApi => ({
        sessions: {
          getWindowValue,
          setWindowValue: vi.fn(),
          getTabValue,
          setTabValue: vi.fn(),
          removeTabValue: vi.fn(),
        },
      }));

      await state.getGroups(3);
      await state.getActiveGroup(4);
      await state.getGroupIndex(5);
      await state.getTabGroup(6);

      expect(getWindowValue.mock.calls).toEqual([
        [3, 'groups'],
        [4, 'activeGroup'],
        [5, 'groupIndex'],
      ]);
      expect(getTabValue.mock.calls).toEqual([[6, 'groupId']]);
    });

    it('uses the browser that exists when it is called, not when it was made', async () => {
      let current = createFakeSessions();
      const state = createBrowserGroupState(() => current.api);
      await state.setActiveGroup(1, 5);

      current = createFakeSessions();

      await expect(state.getActiveGroup(1)).resolves.toBeUndefined();
    });

    it('passes on a failure to store', async () => {
      const failure = new Error('quota exceeded');
      const state = createBrowserGroupState(() => ({
        sessions: {
          getWindowValue: vi.fn(),
          getTabValue: vi.fn(),
          setWindowValue: vi.fn().mockRejectedValue(failure),
          setTabValue: vi.fn().mockRejectedValue(failure),
          removeTabValue: vi.fn().mockRejectedValue(failure),
        },
      }));

      await expect(state.setGroups(1, [])).rejects.toBe(failure);
      await expect(state.setActiveGroup(1, 1)).rejects.toBe(failure);
      await expect(state.setGroupIndex(1, 1)).rejects.toBe(failure);
      await expect(state.setTabGroup(1, 1)).rejects.toBe(failure);
      await expect(state.clearTabGroup(1)).rejects.toBe(failure);
    });

    it('waits for the browser to finish storing', async () => {
      let stored = false;
      const state = createBrowserGroupState(() => ({
        sessions: {
          getWindowValue: vi.fn(),
          getTabValue: vi.fn(),
          setWindowValue: async () => {
            await Promise.resolve();
            stored = true;
          },
          setTabValue: async () => {
            await Promise.resolve();
            stored = true;
          },
          removeTabValue: async () => {
            await Promise.resolve();
            stored = true;
          },
        },
      }));

      await state.setActiveGroup(1, 1);
      expect(stored).toBe(true);

      stored = false;
      await state.setTabGroup(1, 1);
      expect(stored).toBe(true);

      stored = false;
      await state.clearTabGroup(1);
      expect(stored).toBe(true);
    });
  });

  describe('reading what is stored', () => {
    const putGroups = async (value: unknown) => {
      const { state, windowValues, slot } = setUp();
      windowValues.set(slot(1, 'groups'), value);
      return state.getGroups(1);
    };

    it.each([null, 'text', 5, true, { id: 1 }])(
      'ignores stored groups that are not a list (%j)',
      async (value) => {
        await expect(putGroups(value)).resolves.toBeUndefined();
      },
    );

    it('keeps a valid group together with fields it does not know about', async () => {
      const stored = { ...valid(), extra: 'kept', lastMoved: 5 };

      await expect(putGroups([stored])).resolves.toEqual([stored]);
    });

    it('keeps a group that has no container, as version 2 of the stored data writes it', async () => {
      const { containerId, ...withoutContainer } = valid();

      await expect(putGroups([withoutContainer])).resolves.toEqual([
        withoutContainer,
      ]);
      expect(containerId).toBe('firefox-default');
    });

    it('drops entries that are not groups and keeps the rest in order', async () => {
      const result = await putGroups([
        valid(),
        null,
        'x',
        { ...valid(), id: 'nope' },
        { ...valid(), id: 9 },
      ]);

      expect(result?.map(({ id }) => id)).toEqual([4, 9]);
    });

    it.each([
      ['id', 'four'],
      ['id', undefined],
      ['name', 4],
      ['name', undefined],
      ['containerId', 4],
      ['rect', undefined],
      ['rect', 'big'],
      ['rect', null],
      ['rect', { x: 0, y: 0, w: 1 }],
      ['rect', { x: 'a', y: 0, w: 1, h: 1 }],
      ['rect', { x: 0, y: 'a', w: 1, h: 1 }],
      ['rect', { x: 0, y: 0, w: 'a', h: 1 }],
      ['rect', { x: 0, y: 0, w: 1, h: 'a' }],
      ['windowId', 'one'],
      ['nativeGroupId', 'one'],
      ['nativeGroupId', true],
      ['lastMoved', 'now'],
      ['isSystemGroup', 'yes'],
      ['tabCount', 'many'],
    ])('drops a group whose %s is %j', async (field, value) => {
      await expect(
        putGroups([{ ...valid(), [field]: value }]),
      ).resolves.toEqual([]);
    });

    it('keeps a group whose nativeGroupId is a number, which earlier versions stored, without it: it is no link', async () => {
      const stored = { ...valid(), nativeGroupId: 12 };

      await expect(putGroups([stored])).resolves.toEqual([valid()]);
    });

    it.each([
      ['windowId', 7],
      ['nativeGroupId', null],
      ['lastMoved', 1_700_000_000_000],
      ['isSystemGroup', true],
      ['isSystemGroup', false],
      ['tabCount', 0],
    ])('keeps a group whose %s is %j', async (field, value) => {
      const stored = { ...valid(), [field]: value };

      await expect(putGroups([stored])).resolves.toEqual([stored]);
    });

    describe('numbers that were stored as text', () => {
      const readers = {
        activeGroup: (state: GroupState) => state.getActiveGroup(1),
        groupIndex: (state: GroupState) => state.getGroupIndex(1),
        tab: (state: GroupState) => state.getTabGroup(1),
      };
      const kinds: (keyof typeof readers)[] = [
        'activeGroup',
        'groupIndex',
        'tab',
      ];

      const put = (kind: keyof typeof readers, value: unknown) => {
        const { state, windowValues, tabValues, slot } = setUp();
        if (kind === 'tab') {
          tabValues.set(slot(1, 'groupId'), value);
        } else {
          windowValues.set(slot(1, kind), value);
        }
        return readers[kind](state);
      };

      it.each(kinds)(
        'turns a whole number in text into a number for the %s',
        async (kind) => {
          await expect(put(kind, '5')).resolves.toBe(5);
          await expect(put(kind, '0')).resolves.toBe(0);
          await expect(put(kind, '-1')).resolves.toBe(-1);
          await expect(put(kind, '007')).resolves.toBe(7);
        },
      );

      it.each(kinds)(
        'ignores a stored %s that is not a whole number',
        async (kind) => {
          const values: unknown[] = [
            '',
            ' 5',
            '5 ',
            '5x',
            'x5',
            '5.5',
            '+5',
            'abc',
            null,
            true,
            { id: 5 },
            [5],
          ];
          const results = await Promise.all(
            values.map((value) => put(kind, value)),
          );

          expect(results.every((result) => result === undefined)).toBe(true);
        },
      );
    });
  });
});

describe('adapters/browser/group-state.ts, where the browser keeps values with their window and tab', () => {
  it('lists none and forgets none, as there is nothing of the add-on’s to prune', async () => {
    const { state, windowValues } = setUp();
    await state.setSchemaVersion(3, 5);

    await expect(state.listStoredWindowIds()).resolves.toEqual([]);
    await expect(state.listStoredTabIds()).resolves.toEqual([]);
    await expect(state.listPrivateWindowIds()).resolves.toEqual([]);
    await expect(state.listPrivateTabIds()).resolves.toEqual([]);
    await state.setPrivate([3], [3]);
    await state.forgetWindow(3);
    await state.forgetTab(3);

    // What was stored is still there: the window and the tab go with their values
    await expect(state.getSchemaVersion(3)).resolves.toBe(5);
    expect(windowValues.size).toBe(1);
  });

  it('does not write when a window closed: the window is gone, and its values with it', async () => {
    const { state, windowValues } = setUp();

    await state.setClosedAt(3, 1234);

    expect(windowValues.size).toBe(0);
    await expect(state.getClosedAt(3)).resolves.toBeUndefined();
  });

  it('reads and writes the closing time where the values are emulated', async () => {
    const fake = createFakeSessions();
    const removed: string[] = [];
    const state = createBrowserGroupState(() => ({
      sessions: fake.api.sessions,
      sessionsManagement: {
        windowIds: () => Promise.resolve([3]),
        tabIds: () => Promise.resolve([20]),
        privateWindowIds: () => Promise.resolve([4]),
        privateTabIds: () => Promise.resolve([40]),
        setPrivate: (windowIds, tabIds) => {
          removed.push(`private ${windowIds.join()} ${tabIds.join()}`);
          return Promise.resolve();
        },
        removeWindow: (id) => {
          removed.push(`window ${String(id)}`);
          return Promise.resolve();
        },
        removeTab: (id) => {
          removed.push(`tab ${String(id)}`);
          return Promise.resolve();
        },
      },
    }));

    await state.setClosedAt(3, 1234);
    await state.setPrivate([4, 5], [40]);
    await state.forgetWindow(3);
    await state.forgetTab(20);

    await expect(state.getClosedAt(3)).resolves.toBe(1234);
    await expect(state.listStoredWindowIds()).resolves.toEqual([3]);
    await expect(state.listStoredTabIds()).resolves.toEqual([20]);
    await expect(state.listPrivateWindowIds()).resolves.toEqual([4]);
    await expect(state.listPrivateTabIds()).resolves.toEqual([40]);
    expect(removed).toEqual(['private 4,5 40', 'window 3', 'tab 20']);
    expect(fake.windowValues.get(fake.slot(3, 'closedAt'))).toBe(1234);
  });
});
