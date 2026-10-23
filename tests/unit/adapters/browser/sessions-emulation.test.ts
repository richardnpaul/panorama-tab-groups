import { describe, expect, it, vi } from 'vitest';
import { createBrowserGroupState } from '../../../../src/js/adapters/browser/group-state.js';
import {
  createSessionsEmulation,
  type StorageArea,
} from '../../../../src/js/adapters/browser/sessions-emulation.js';
import { createExclusively } from '../../../../src/js/adapters/browser/exclusive.js';
import { createFakeLocks } from '../../../support/fake-locks.js';
import { createFakeStorage } from '../../../support/fake-storage.js';
import { describeGroupStateContract } from '../../../support/group-state-contract.js';

const KEY = '__mock_sessions';

function setUp(initial: Record<string, unknown> = {}) {
  const storage = createFakeStorage(initial);
  const sessions = createSessionsEmulation(() => storage.area);
  return { sessions, ...storage };
}

// The emulation must hold up as the sessions of a real GroupState
describeGroupStateContract('sessions emulated in extension storage', () => {
  const { sessions } = setUp();
  return createBrowserGroupState(() => ({ sessions }));
});

describe('adapters/browser/sessions-emulation.ts', () => {
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
      get: async (key: string) => {
        const stored = await storage.area.get(key);
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
});
