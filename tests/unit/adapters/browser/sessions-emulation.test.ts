import { describe, expect, it, vi } from 'vitest';
import { createBrowserGroupState } from '../../../../src/js/adapters/browser/group-state.js';
import {
  createSessionsEmulation,
  type StorageArea,
} from '../../../../src/js/adapters/browser/sessions-emulation.js';
import { createExclusively } from '../../../../src/js/adapters/browser/exclusive.js';
import { createFakeLocks } from '../../../support/fake-locks.js';
import { createFakeSessionArea } from '../../../support/fake-session-area.js';
import { createFakeStorage } from '../../../support/fake-storage.js';
import {
  describeGroupStateContract,
  describeStoredIdsContract,
} from '../../../support/group-state-contract.js';

const KEY = '__mock_sessions';
const PRIVATE_KEY = 'privateSessions';

// Values kept apart for the windows and tabs that are private, as the polyfill sets it up
function setUpWithPrivate(
  isPrivate: (scope: 'tabs' | 'windows', id: number) => Promise<boolean>,
  initial: Record<string, unknown> = {},
) {
  const storage = createFakeStorage(initial);
  const asked = vi.fn(isPrivate);
  const sessions = createSessionsEmulation(
    () => storage.area,
    undefined,
    asked,
  );
  return { sessions, asked, ...storage };
}

// Window 1 and tab 10 are private
const privateOnes = (scope: 'tabs' | 'windows', id: number) =>
  Promise.resolve(id === (scope === 'tabs' ? 10 : 1));

function setUp(initial: Record<string, unknown> = {}) {
  const storage = createFakeStorage(initial);
  const sessions = createSessionsEmulation(() => storage.area);
  return { sessions, ...storage };
}

const emulated = () => {
  const { sessions } = setUp();
  const { area } = createFakeSessionArea();
  return createBrowserGroupState(() => ({
    sessions,
    sessionsManagement: sessions,
    storage: { session: area },
  }));
};

// The emulation must hold up as the sessions of a real GroupState
describeGroupStateContract('sessions emulated in extension storage', emulated);
describeGroupStateContract(
  'sessions of private windows emulated under their own key',
  () => {
    const { sessions } = setUpWithPrivate(() => Promise.resolve(true));
    const { area } = createFakeSessionArea();
    return createBrowserGroupState(() => ({
      sessions,
      sessionsManagement: sessions,
      storage: { session: area },
    }));
  },
);
describeStoredIdsContract('sessions emulated in extension storage', emulated);

describe('adapters/browser/sessions-emulation.ts', () => {
  describe('the ids it keeps values under', () => {
    it('lists the windows and the tabs, as numbers', async () => {
      const { sessions } = setUp();
      await sessions.setWindowValue(3, 'a', 1);
      await sessions.setWindowValue(8, 'a', 1);
      await sessions.setTabValue(20, 'a', 1);

      expect((await sessions.windowIds()).sort()).toEqual([3, 8]);
      expect(await sessions.tabIds()).toEqual([20]);
    });

    it('leaves out an id that is not a whole number', async () => {
      const { sessions } = setUp({
        [KEY]: {
          tabs: { '5': { a: 1 }, x: { a: 1 }, '1.5': { a: 1 } },
          windows: {},
        },
      });

      expect(await sessions.tabIds()).toEqual([5]);
    });

    it('forgets a window, and a tab, with everything in it, and no other', async () => {
      const { sessions, data } = setUp();
      await sessions.setWindowValue(3, 'a', 1);
      await sessions.setWindowValue(3, 'b', 2);
      await sessions.setWindowValue(4, 'a', 1);
      await sessions.setTabValue(20, 'a', 1);
      await sessions.setTabValue(21, 'a', 1);

      await sessions.removeWindow(3);
      await sessions.removeTab(20);

      expect(data.get(KEY)).toEqual({
        windows: { '4': { a: 1 } },
        tabs: { '21': { a: 1 } },
      });
    });

    it('writes nothing to forget what it has no values for', async () => {
      const { sessions, calls } = setUp();

      await sessions.removeWindow(3);
      await sessions.removeTab(3);

      expect(calls.filter((call) => call.startsWith('set'))).toEqual([]);
    });

    it('drops the entry of a window or tab when its last value is removed', async () => {
      const { sessions, data } = setUp();
      await sessions.setTabValue(20, 'a', 1);
      await sessions.setTabValue(20, 'b', 2);

      await sessions.removeTabValue(20, 'a');
      expect(data.get(KEY)).toMatchObject({ tabs: { '20': { b: 2 } } });

      await sessions.removeTabValue(20, 'b');
      expect(data.get(KEY)).toEqual({ tabs: {}, windows: {} });
    });
  });

  describe('window values', () => {
    it('gives back what was stored for a window and key', async () => {
      const { sessions } = setUp();

      await sessions.setWindowValue(1, 'activeGroup', 5);

      await expect(sessions.getWindowValue(1, 'activeGroup')).resolves.toBe(5);
    });

    it('gives undefined for what was never stored', async () => {
      const { sessions } = setUp();
      await sessions.setWindowValue(1, 'a', 1);

      await expect(sessions.getWindowValue(1, 'b')).resolves.toBeUndefined();
      await expect(sessions.getWindowValue(2, 'a')).resolves.toBeUndefined();
    });

    it('keeps each window’s keys apart', async () => {
      const { sessions } = setUp();

      await sessions.setWindowValue(1, 'k', 'one');
      await sessions.setWindowValue(2, 'k', 'two');
      await sessions.setWindowValue(1, 'other', 'x');

      await expect(sessions.getWindowValue(1, 'k')).resolves.toBe('one');
      await expect(sessions.getWindowValue(2, 'k')).resolves.toBe('two');
      await expect(sessions.getWindowValue(1, 'other')).resolves.toBe('x');
    });

    it('removes a value and leaves the rest', async () => {
      const { sessions } = setUp();
      await sessions.setWindowValue(1, 'a', 1);
      await sessions.setWindowValue(1, 'b', 2);

      await sessions.removeWindowValue(1, 'a');

      await expect(sessions.getWindowValue(1, 'a')).resolves.toBeUndefined();
      await expect(sessions.getWindowValue(1, 'b')).resolves.toBe(2);
    });

    it('removing what is not there changes nothing', async () => {
      const { sessions } = setUp();
      await sessions.setWindowValue(1, 'a', 1);

      await sessions.removeWindowValue(1, 'missing');
      await sessions.removeWindowValue(9, 'a');

      await expect(sessions.getWindowValue(1, 'a')).resolves.toBe(1);
    });
  });

  describe('tab values', () => {
    it('gives back what was stored for a tab and key', async () => {
      const { sessions } = setUp();

      await sessions.setTabValue(7, 'groupId', 3);

      await expect(sessions.getTabValue(7, 'groupId')).resolves.toBe(3);
    });

    it('keeps tabs and windows with the same number apart', async () => {
      const { sessions } = setUp();

      await sessions.setTabValue(1, 'k', 'tab');
      await sessions.setWindowValue(1, 'k', 'window');

      await expect(sessions.getTabValue(1, 'k')).resolves.toBe('tab');
      await expect(sessions.getWindowValue(1, 'k')).resolves.toBe('window');
    });

    it('removes a value and leaves the rest', async () => {
      const { sessions } = setUp();
      await sessions.setTabValue(1, 'a', 1);
      await sessions.setTabValue(1, 'b', 2);

      await sessions.removeTabValue(1, 'a');

      await expect(sessions.getTabValue(1, 'a')).resolves.toBeUndefined();
      await expect(sessions.getTabValue(1, 'b')).resolves.toBe(2);
    });

    it('removing from a tab does not touch a window with the same number', async () => {
      const { sessions } = setUp();
      await sessions.setWindowValue(1, 'k', 'window');
      await sessions.setTabValue(1, 'k', 'tab');

      await sessions.removeTabValue(1, 'k');

      await expect(sessions.getWindowValue(1, 'k')).resolves.toBe('window');
    });
  });

  describe('how it is stored', () => {
    it('keeps everything under one key in the extension storage', async () => {
      const { sessions, data } = setUp();

      await sessions.setTabValue(7, 'groupId', 3);
      await sessions.setWindowValue(2, 'activeGroup', 5);

      expect([...data.keys()]).toEqual([KEY]);
      expect(data.get(KEY)).toEqual({
        tabs: { 7: { groupId: 3 } },
        windows: { 2: { activeGroup: 5 } },
      });
    });

    it('reads data that an earlier version wrote', async () => {
      const { sessions } = setUp({
        [KEY]: {
          tabs: { 7: { groupId: 3 } },
          windows: { 2: { activeGroup: 5 } },
        },
      });

      await expect(sessions.getTabValue(7, 'groupId')).resolves.toBe(3);
      await expect(sessions.getWindowValue(2, 'activeGroup')).resolves.toBe(5);
    });

    it('keeps what an earlier version wrote when it adds to it', async () => {
      const { sessions, data } = setUp({
        [KEY]: { tabs: { 7: { groupId: 3 } }, windows: { 2: { a: 1 } } },
      });

      await sessions.setTabValue(7, 'other', 'x');
      await sessions.setWindowValue(2, 'b', 2);

      expect(data.get(KEY)).toEqual({
        tabs: { 7: { groupId: 3, other: 'x' } },
        windows: { 2: { a: 1, b: 2 } },
      });
    });

    it.each([
      ['nothing', undefined],
      ['text', 'text'],
      ['a number', 5],
      ['null', null],
      ['a list without data', []],
      ['tabs that are not an object', { tabs: 'x', windows: 5 }],
      [
        'tab entries that are not objects',
        { tabs: { 7: 'x', 8: null }, windows: {} },
      ],
    ])('starts afresh when the stored data is %s', async (_name, stored) => {
      const { sessions, data } = setUp(
        stored === undefined ? {} : { [KEY]: stored },
      );

      await expect(sessions.getTabValue(7, 'groupId')).resolves.toBeUndefined();
      await sessions.setTabValue(7, 'groupId', 3);

      expect(data.get(KEY)).toEqual({
        tabs: { 7: { groupId: 3 } },
        windows: {},
      });
    });

    it('stores a key called __proto__ as plain data', async () => {
      const { sessions, data } = setUp();

      await sessions.setTabValue(1, '__proto__', 'x');

      const plain: unknown = JSON.parse('{"__proto__":"x"}');
      expect(JSON.stringify(data.get(KEY))).toBe(
        JSON.stringify({ tabs: { 1: plain }, windows: {} }),
      );
      await expect(sessions.getTabValue(1, '__proto__')).resolves.toBe('x');
    });

    it('reads the storage that exists when it is called', async () => {
      const first = createFakeStorage();
      const second = createFakeStorage();
      let current: StorageArea = first.area;
      const sessions = createSessionsEmulation(() => current);
      await sessions.setTabValue(1, 'k', 'in first');

      current = second.area;

      await expect(sessions.getTabValue(1, 'k')).resolves.toBeUndefined();
    });
  });

  describe('doing several things at once', () => {
    it('does not lose writes that overlap', async () => {
      const { sessions } = setUp();

      await Promise.all([
        sessions.setTabValue(1, 'k', 'a'),
        sessions.setTabValue(2, 'k', 'b'),
        sessions.setWindowValue(1, 'k', 'c'),
        sessions.setWindowValue(1, 'j', 'd'),
        sessions.setTabValue(1, 'j', 'e'),
      ]);

      await expect(sessions.getTabValue(1, 'k')).resolves.toBe('a');
      await expect(sessions.getTabValue(2, 'k')).resolves.toBe('b');
      await expect(sessions.getWindowValue(1, 'k')).resolves.toBe('c');
      await expect(sessions.getWindowValue(1, 'j')).resolves.toBe('d');
      await expect(sessions.getTabValue(1, 'j')).resolves.toBe('e');
    });

    it('reads after the writes that were asked for before it', async () => {
      const { sessions } = setUp();

      const writing = sessions.setTabValue(1, 'k', 'written');
      const reading = sessions.getTabValue(1, 'k');

      await writing;
      await expect(reading).resolves.toBe('written');
    });

    it('does one thing at a time', async () => {
      const storage = createFakeStorage();
      const log: string[] = [];
      const slow: StorageArea = {
        get: async (key) => {
          log.push('get start');
          await Promise.resolve();
          await Promise.resolve();
          log.push('get end');
          return storage.area.get(key);
        },
        set: async (items) => {
          log.push('set start');
          await Promise.resolve();
          log.push('set end');
          await storage.area.set(items);
        },
      };
      const sessions = createSessionsEmulation(() => slow);

      await Promise.all([
        sessions.setTabValue(1, 'a', 1),
        sessions.setTabValue(2, 'b', 2),
      ]);

      expect(log).toEqual([
        'get start',
        'get end',
        'set start',
        'set end',
        'get start',
        'get end',
        'set start',
        'set end',
      ]);
    });

    it('carries on after one thing fails', async () => {
      const storage = createFakeStorage();
      const failure = new Error('storage is full');
      const set = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockImplementation(storage.area.set);
      const sessions = createSessionsEmulation(() => ({
        get: storage.area.get,
        set,
      }));

      const failing = sessions.setTabValue(1, 'k', 'lost');
      const next = sessions.setTabValue(2, 'k', 'kept');

      await expect(failing).rejects.toBe(failure);
      await expect(next).resolves.toBeUndefined();
      await expect(sessions.getTabValue(2, 'k')).resolves.toBe('kept');
    });

    it('passes a failure to read on to the caller', async () => {
      const failure = new Error('cannot read');
      const sessions = createSessionsEmulation(() => ({
        get: () => Promise.reject(failure),
        set: () => Promise.resolve(),
      }));

      await expect(sessions.getWindowValue(1, 'k')).rejects.toBe(failure);
      await expect(sessions.setWindowValue(1, 'k', 1)).rejects.toBe(failure);
    });
  });

  describe('from several contexts of the extension', () => {
    // A storage that is slow to read, as it is when others are busy with it
    const slowStorage = (storage: ReturnType<typeof createFakeStorage>) => ({
      get: async (keys: string[]) => {
        const stored = await storage.area.get(keys);
        await Promise.resolve();
        await Promise.resolve();
        return stored;
      },
      set: storage.area.set,
    });

    it('loses a write when the contexts do not share locks', async () => {
      const storage = createFakeStorage();
      const background = createSessionsEmulation(() => slowStorage(storage));
      const page = createSessionsEmulation(() => slowStorage(storage));

      await Promise.all([
        background.setWindowValue(1, 'groups', ['a']),
        page.setTabValue(2, 'groupId', 3),
      ]);

      const stored = storage.data.get('__mock_sessions');
      const kept = JSON.stringify(stored).includes('groups');
      const alsoKept = JSON.stringify(stored).includes('groupId');
      expect(kept && alsoKept).toBe(false);
    });

    it('keeps every write when the contexts share locks', async () => {
      const storage = createFakeStorage();
      const { locks } = createFakeLocks();
      const background = createSessionsEmulation(
        () => slowStorage(storage),
        createExclusively(locks),
      );
      const page = createSessionsEmulation(
        () => slowStorage(storage),
        createExclusively(locks),
      );

      await Promise.all([
        background.setWindowValue(1, 'groups', ['a']),
        page.setTabValue(2, 'groupId', 3),
        page.removeTabValue(9, 'groupId'),
      ]);

      await expect(page.getWindowValue(1, 'groups')).resolves.toEqual(['a']);
      await expect(background.getTabValue(2, 'groupId')).resolves.toBe(3);
    });
  });

  describe('the values of private windows and tabs', () => {
    it('keeps them under a key of their own, and the others where they were', async () => {
      const { sessions, data } = setUpWithPrivate(privateOnes);

      await sessions.setWindowValue(1, 'groups', ['private']);
      await sessions.setTabValue(10, 'groupId', 1);
      await sessions.setWindowValue(2, 'groups', ['normal']);
      await sessions.setTabValue(20, 'groupId', 2);

      expect(data.get(PRIVATE_KEY)).toEqual({
        windows: { 1: { groups: ['private'] } },
        tabs: { 10: { groupId: 1 } },
      });
      expect(data.get(KEY)).toEqual({
        windows: { 2: { groups: ['normal'] } },
        tabs: { 20: { groupId: 2 } },
      });
    });

    it('gives them back, each from where it is', async () => {
      const { sessions } = setUpWithPrivate(privateOnes);
      await sessions.setWindowValue(1, 'groups', ['private']);
      await sessions.setWindowValue(2, 'groups', ['normal']);

      await expect(sessions.getWindowValue(1, 'groups')).resolves.toEqual([
        'private',
      ]);
      await expect(sessions.getWindowValue(2, 'groups')).resolves.toEqual([
        'normal',
      ]);
      await expect(
        sessions.getWindowValue(1, 'other'),
      ).resolves.toBeUndefined();
    });

    it('lists the windows and tabs that are kept apart from those that are kept', async () => {
      const { sessions } = setUpWithPrivate(privateOnes);
      await sessions.setWindowValue(1, 'a', 1);
      await sessions.setWindowValue(2, 'a', 1);
      await sessions.setTabValue(10, 'a', 1);
      await sessions.setTabValue(20, 'a', 1);

      expect(await sessions.windowIds()).toEqual([2]);
      expect(await sessions.tabIds()).toEqual([20]);
      expect(await sessions.privateWindowIds()).toEqual([1]);
      expect(await sessions.privateTabIds()).toEqual([10]);
    });

    it('asks whether a window or tab is private once, when its first value is stored', async () => {
      const { sessions, asked } = setUpWithPrivate(privateOnes);

      await sessions.setWindowValue(1, 'a', 1);
      await sessions.setWindowValue(1, 'b', 2);
      await sessions.setTabValue(20, 'a', 1);
      await sessions.setTabValue(20, 'b', 2);
      await sessions.getWindowValue(5, 'a');
      await sessions.removeTabValue(30, 'a');
      await sessions.removeWindow(6);

      expect(asked.mock.calls).toEqual([
        ['windows', 1],
        ['tabs', 20],
      ]);
    });

    it('keeps apart what cannot be asked about, as a window that has closed', async () => {
      const { sessions, data } = setUpWithPrivate(() =>
        Promise.reject(new Error('No window with id: 4')),
      );

      await sessions.setWindowValue(4, 'closedAt', 9);

      expect(data.get(PRIVATE_KEY)).toEqual({
        windows: { 4: { closedAt: 9 } },
        tabs: {},
      });
      expect(data.has(KEY)).toBe(false);
    });

    it('removes a value of a private window where it is, and its entry with the last', async () => {
      const { sessions, data } = setUpWithPrivate(privateOnes);
      await sessions.setWindowValue(1, 'a', 1);
      await sessions.setWindowValue(1, 'b', 2);

      await sessions.removeWindowValue(1, 'a');
      expect(data.get(PRIVATE_KEY)).toEqual({
        windows: { 1: { b: 2 } },
        tabs: {},
      });

      await sessions.removeWindowValue(1, 'b');
      expect(data.get(PRIVATE_KEY)).toEqual({ windows: {}, tabs: {} });
      expect(data.has(KEY)).toBe(false);
    });

    it('forgets a private window and tab with everything in them', async () => {
      const { sessions, data } = setUpWithPrivate(privateOnes);
      await sessions.setWindowValue(1, 'a', 1);
      await sessions.setTabValue(10, 'a', 1);

      await sessions.removeWindow(1);
      await sessions.removeTab(10);

      expect(data.get(PRIVATE_KEY)).toEqual({ windows: {}, tabs: {} });
      await expect(sessions.getWindowValue(1, 'a')).resolves.toBeUndefined();
    });

    it('reads both keys in one call, and writes only the one that changed, to store a value', async () => {
      const { sessions, calls } = setUpWithPrivate(privateOnes);

      await sessions.setWindowValue(2, 'a', 1);
      await sessions.setWindowValue(1, 'a', 1);

      expect(calls).toEqual([
        `get ${KEY},${PRIVATE_KEY}`,
        `set ${KEY}`,
        `get ${KEY},${PRIVATE_KEY}`,
        `set ${PRIVATE_KEY}`,
      ]);
    });

    it('moves values apart in one write of both keys', async () => {
      const { sessions, calls } = setUpWithPrivate(privateOnes, {
        [KEY]: { windows: { 1: { a: 1 } }, tabs: {} },
      });

      await sessions.setPrivate([1], []);

      expect(calls).toEqual([
        `get ${KEY},${PRIVATE_KEY}`,
        `set ${PRIVATE_KEY},${KEY}`,
      ]);
    });

    it('forgets and erases an id wherever it has values, as one that a version that stopped halfway left in both', async () => {
      const both = { windows: { 1: { a: 1, b: 2 } }, tabs: { 10: { a: 1 } } };
      const { sessions, data } = setUpWithPrivate(privateOnes, {
        [KEY]: both,
        [PRIVATE_KEY]: both,
      });

      await sessions.removeTab(10);
      await sessions.removeWindowValue(1, 'a');

      expect(data.get(KEY)).toEqual({ windows: { 1: { b: 2 } }, tabs: {} });
      expect(data.get(PRIVATE_KEY)).toEqual({
        windows: { 1: { b: 2 } },
        tabs: {},
      });
      await expect(sessions.getWindowValue(1, 'a')).resolves.toBeUndefined();
    });
  });

  describe('moving the values of private windows apart, as an earlier version stored them with the others', () => {
    const stored = {
      [KEY]: {
        windows: { 1: { groups: ['private'] }, 2: { groups: ['normal'] } },
        tabs: { 10: { groupId: 1 }, 20: { groupId: 2 } },
      },
      [PRIVATE_KEY]: { windows: { 3: { a: 1 } }, tabs: { 30: { a: 1 } } },
    };

    it('moves those of the windows and tabs given, and leaves the others', async () => {
      const { sessions, data } = setUpWithPrivate(privateOnes, stored);

      await sessions.setPrivate([1], [10]);

      expect(data.get(PRIVATE_KEY)).toEqual({
        windows: { 1: { groups: ['private'] }, 3: { a: 1 } },
        tabs: { 10: { groupId: 1 }, 30: { a: 1 } },
      });
      expect(data.get(KEY)).toEqual({
        windows: { 2: { groups: ['normal'] } },
        tabs: { 20: { groupId: 2 } },
      });
      await expect(sessions.getWindowValue(1, 'groups')).resolves.toEqual([
        'private',
      ]);
    });

    it('moves a tab alone, or a window alone', async () => {
      const { sessions } = setUpWithPrivate(privateOnes, stored);

      await sessions.setPrivate([], [10]);
      await sessions.setPrivate([1], []);

      expect(await sessions.privateWindowIds()).toEqual([1, 3]);
      expect(await sessions.privateTabIds()).toEqual([10, 30]);
    });

    it('writes nothing when none of them has values stored with the others', async () => {
      const { sessions, calls } = setUpWithPrivate(privateOnes, stored);

      await sessions.setPrivate([3, 7], [30, 70]);

      expect(calls.filter((call) => call.startsWith('set'))).toEqual([]);
    });
  });
});
