import { describe, expect, it, vi } from 'vitest';
import { createBrowserGroupState } from '../../../src/js/adapters/browser/group-state.js';
import { createMemoryDataVersion } from '../../../src/js/adapters/memory/data-version.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMigrationFlag } from '../../../src/js/adapters/memory/migration-flag.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import {
  DATA_VERSION,
  createMigrations,
  withMigratedWindows,
} from '../../../src/js/app/migrations.js';
import type { Group, GroupState } from '../../../src/js/ports/group-state.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';
import { createFakeSessions } from '../../support/fake-sessions.js';

const rect = { x: 0, y: 0, w: 1, h: 1 };
// As versions before 2 stored a group
const oldGroup = (id: number, containerId = 'firefox-default'): Group => ({
  id,
  name: `G${String(id)}`,
  containerId,
  rect,
});
const group = (id: number): Group => ({ id, name: `G${String(id)}`, rect });
const tab = (id: number, windowId = 1): TabDetails => ({
  id,
  windowId,
  active: false,
  pinned: false,
  url: undefined,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId: undefined,
});

function setUp({
  stored,
  windowIds = [1],
  canHideTabs = true,
  native = true,
}: {
  stored?: number;
  windowIds?: number[];
  canHideTabs?: boolean;
  native?: boolean;
} = {}) {
  const groupState = createMemoryGroupState();
  const [first = 1, ...others] = windowIds;
  const windows = createMemoryWindows(first);
  others.forEach((windowId) => {
    windows.open(windowId);
  });
  const dataVersion = createMemoryDataVersion(stored);
  const tabs = createMemoryTabs();
  const migrationFlag = createMemoryMigrationFlag(true);
  const useNativeGroups = vi.fn(() => Promise.resolve(native));
  const order: string[] = [];
  const autoBackup = {
    writeIfDue: vi.fn((reason: string) => {
      order.push(`backup: ${reason}`);
      return Promise.resolve(true);
    }),
  };
  const logger = { debug: vi.fn(), warn: vi.fn() };
  const migrations = createMigrations({
    groupState,
    windows,
    tabs,
    dataVersion,
    migrationFlag,
    autoBackup,
    canHideTabs,
    useNativeGroups,
    logger,
  });
  return {
    migrations,
    groupState,
    tabs,
    migrationFlag,
    useNativeGroups,
    windows,
    dataVersion,
    autoBackup,
    logger,
    order,
  };
}

describe('app/migrations.ts', () => {
  it('is at version 5', () => {
    expect(DATA_VERSION).toBe(5);
  });

  describe('window', () => {
    it('takes the container out of the groups of a window stored before there was a version, and notes the version', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [
        oldGroup(1),
        oldGroup(-2, 'browser-default'),
      ]);

      await env.migrations.window(1);

      expect(await env.groupState.getGroups(1)).toEqual([group(1), group(-2)]);
      expect(await env.groupState.getSchemaVersion(1)).toBe(DATA_VERSION);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Migration] Window 1: version 1 to 5',
      );
    });

    it('does not store the groups again when they have no container, which a page may be storing at the same time', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1)]);
      const setGroups = vi.spyOn(env.groupState, 'setGroups');

      await env.migrations.window(1);

      expect(setGroups).not.toHaveBeenCalled();
      expect(await env.groupState.getSchemaVersion(1)).toBe(DATA_VERSION);
    });

    it('notes the version of a window that has nothing stored yet', async () => {
      const env = setUp();

      await env.migrations.window(1);

      expect(await env.groupState.getGroups(1)).toBeUndefined();
      expect(await env.groupState.getSchemaVersion(1)).toBe(DATA_VERSION);
    });

    it.each([5, 6])(
      'leaves a window that is at version %i as it is',
      async (version) => {
        const env = setUp();
        await env.groupState.setGroups(1, [oldGroup(1)]);
        await env.groupState.setSchemaVersion(1, version);
        const setSchemaVersion = vi.spyOn(env.groupState, 'setSchemaVersion');

        await env.migrations.window(1);

        expect(await env.groupState.getGroups(1)).toEqual([oldGroup(1)]);
        expect(setSchemaVersion).not.toHaveBeenCalled();
        expect(env.logger.debug).not.toHaveBeenCalled();
      },
    );

    it.each([0, -3])(
      'takes a window stored at version %i for one at the first, and runs every step',
      async (version) => {
        const env = setUp();
        await env.groupState.setGroups(1, [oldGroup(1)]);
        await env.groupState.setSchemaVersion(1, version);

        await expect(env.migrations.window(1)).resolves.toBe(true);

        expect(await env.groupState.getGroups(1)).toEqual([group(1)]);
        expect(await env.groupState.getSchemaVersion(1)).toBe(DATA_VERSION);
      },
    );

    it('runs only the last step for a window at the version before the current one: the number of steps goes with it', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [oldGroup(1)]);
      env.tabs.setDetails([{ ...tab(10), pinned: true }]);
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setSchemaVersion(1, DATA_VERSION - 1);

      await env.migrations.window(1);

      // Only the step to the current version ran: the pinned tab lost its group, and the
      // container (the first step's) is still there
      expect(await env.groupState.getTabGroup(10)).toBeUndefined();
      expect((await env.groupState.getGroups(1))?.[0]).toHaveProperty(
        'containerId',
      );
    });

    it('migrates a window once, however many ask at once', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [oldGroup(1)]);
      const read = vi.spyOn(env.groupState, 'getSchemaVersion');

      await Promise.all([
        env.migrations.window(1),
        env.migrations.window(1),
        env.migrations.window(2),
      ]);
      await env.migrations.window(1);

      expect(read.mock.calls).toEqual([[1], [2]]);
    });

    it('logs a window that could not be migrated, leaves its version, and does not try again until the next start', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [oldGroup(1)]);
      const failure = new Error('Invalid window ID: 1');
      const setGroups = vi
        .spyOn(env.groupState, 'setGroups')
        .mockRejectedValue(failure);

      await env.migrations.window(1);
      await env.migrations.window(1);

      expect(env.logger.warn).toHaveBeenCalledTimes(1);
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Migration] Window 1 was not migrated; it is tried again at the next start:',
        failure,
      );
      expect(setGroups).toHaveBeenCalledTimes(1);
      expect(await env.groupState.getSchemaVersion(1)).toBeUndefined();
    });
  });

  describe('atStart', () => {
    it('backs up what is stored, as it is, then brings every window up, then notes the version', async () => {
      const env = setUp({ windowIds: [1, 2] });
      await env.groupState.setGroups(1, [oldGroup(1)]);
      await env.groupState.setGroups(2, [oldGroup(5)]);
      // A window is migrated once its version is written
      vi.spyOn(env.groupState, 'setSchemaVersion').mockImplementation(
        (windowId) => {
          env.order.push(`migrate ${String(windowId)}`);
          return Promise.resolve();
        },
      );
      vi.spyOn(env.dataVersion, 'write').mockImplementation((version) => {
        env.order.push(`version ${String(version)}`);
        return Promise.resolve();
      });

      await env.migrations.atStart();

      expect(env.order).toEqual([
        'backup: before version 1 of the stored data is brought to 5',
        'migrate 1',
        'migrate 2',
        'version 5',
      ]);
    });

    it('writes the version, and the windows, including stored windows that are not open', async () => {
      const env = setUp({ windowIds: [2] });
      await env.groupState.setGroups(1, [oldGroup(1)]);

      await env.migrations.atStart();

      expect(env.autoBackup.writeIfDue).toHaveBeenCalledTimes(1);
      expect(await env.dataVersion.read()).toBe(DATA_VERSION);
      expect(await env.groupState.getGroups(1)).toEqual([group(1)]);
      expect(await env.groupState.getSchemaVersion(1)).toBe(DATA_VERSION);
      expect(await env.groupState.getSchemaVersion(2)).toBe(DATA_VERSION);
    });

    it('backs nothing up on a first run, where nothing is stored', async () => {
      const env = setUp({ windowIds: [1, 2] });
      await env.groupState.setGroups(2, []);

      await env.migrations.atStart();

      expect(env.autoBackup.writeIfDue).not.toHaveBeenCalled();
      expect(await env.dataVersion.read()).toBe(DATA_VERSION);
    });

    it('does nothing where the stored data is at the version already', async () => {
      const env = setUp({ stored: 5 });
      await env.groupState.setGroups(1, [oldGroup(1)]);
      const listIds = vi.spyOn(env.windows, 'listIds');

      await env.migrations.atStart();

      expect(listIds).not.toHaveBeenCalled();
      expect(env.autoBackup.writeIfDue).not.toHaveBeenCalled();
      expect(await env.groupState.getSchemaVersion(1)).toBeUndefined();
    });

    it('keeps the version of the profile back when a window could not be migrated, and says so, so it is all tried again', async () => {
      const env = setUp({ windowIds: [1, 2] });
      await env.groupState.setGroups(1, [oldGroup(1)]);
      await env.groupState.setGroups(2, [oldGroup(2)]);
      const failure = new Error('Invalid window ID: 2');
      const set = env.groupState.setGroups.bind(env.groupState);
      vi.spyOn(env.groupState, 'setGroups').mockImplementation((id, groups) =>
        id === 2 ? Promise.reject(failure) : set(id, groups),
      );

      await env.migrations.atStart();

      expect(await env.dataVersion.read()).toBeUndefined();
      expect(await env.groupState.getSchemaVersion(1)).toBe(DATA_VERSION);
      expect(await env.groupState.getSchemaVersion(2)).toBeUndefined();
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Migration] Not every window was migrated, so the stored data stays at version 1 for now',
      );
    });

    it('goes on with the migration, and says so, when the backup before it could not be written', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [oldGroup(1)]);
      env.autoBackup.writeIfDue.mockResolvedValue(false);

      await env.migrations.atStart();

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Migration] The backup before the migration could not be written; the data is brought up all the same',
      );
      expect(await env.dataVersion.read()).toBe(DATA_VERSION);
    });

    it('says nothing of a backup when it was written', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [oldGroup(1)]);

      await env.migrations.atStart();

      expect(env.logger.warn).not.toHaveBeenCalled();
    });

    it('brings up stored data that is at an older version, backing up any window that has groups', async () => {
      const env = setUp({ stored: 1, windowIds: [1, 2] });
      await env.groupState.setGroups(1, [oldGroup(1)]);

      await env.migrations.atStart();

      expect(env.autoBackup.writeIfDue).toHaveBeenCalledTimes(1);
      expect(await env.dataVersion.read()).toBe(DATA_VERSION);
    });

    it.each([1, 2])(
      'has the groups of version %i given native groups again, as only the one shown had one',
      async (stored) => {
        const env = setUp({ stored });

        await env.migrations.atStart();

        await expect(env.migrationFlag.isComplete()).resolves.toBe(false);
      },
    );

    it('goes on, and says so, when it cannot note that the groups need native groups again', async () => {
      const env = setUp({ stored: 2 });
      const failure = new Error('storage is full');
      env.migrationFlag.failWith(failure);

      await expect(env.migrations.atStart()).resolves.toBeUndefined();

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Migration] That the groups need native groups again could not be stored; it is tried again at the next start:',
        failure,
      );
      expect(await env.dataVersion.read()).toBe(DATA_VERSION);
    });

    it('goes on, and says so, when it cannot store the version', async () => {
      const env = setUp({ stored: 4 });
      const failure = new Error('storage is full');
      vi.spyOn(env.dataVersion, 'write').mockRejectedValue(failure);

      await expect(env.migrations.atStart()).resolves.toBeUndefined();

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Migration] The version of the stored data could not be stored; it is tried again at the next start:',
        failure,
      );
    });

    it('leaves the migration to native groups alone from version 3', async () => {
      const env = setUp({ stored: 3 });

      await env.migrations.atStart();

      await expect(env.migrationFlag.isComplete()).resolves.toBe(true);
    });
  });

  describe('the step to version 5', () => {
    const pinned = (id: number): TabDetails => ({ ...tab(id), pinned: true });

    it('takes the group of every pinned tab of a window, and no other tab’s', async () => {
      const env = setUp();
      await env.groupState.setSchemaVersion(1, 4);
      env.tabs.setDetails([pinned(10), tab(11), pinned(12)]);
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(11, 1);
      await env.groupState.setTabGroup(12, -2);

      await env.migrations.window(1);

      expect(await env.groupState.getTabGroup(10)).toBeUndefined();
      expect(await env.groupState.getTabGroup(11)).toBe(1);
      expect(await env.groupState.getTabGroup(12)).toBeUndefined();
      expect(await env.groupState.getSchemaVersion(1)).toBe(DATA_VERSION);
    });

    it('leaves a pinned view as the view', async () => {
      const env = setUp();
      await env.groupState.setSchemaVersion(1, 4);
      env.tabs.setDetails([pinned(10)]);
      await env.groupState.setTabGroup(10, -1);

      await env.migrations.window(1);

      expect(await env.groupState.getTabGroup(10)).toBe(-1);
    });

    it('does nothing for a window at version 5 or later', async () => {
      const env = setUp();
      await env.groupState.setSchemaVersion(1, 5);
      env.tabs.setDetails([pinned(10)]);
      await env.groupState.setTabGroup(10, 1);

      await env.migrations.window(1);

      expect(await env.groupState.getTabGroup(10)).toBe(1);
    });
  });

  describe('the step to version 4', () => {
    it('leaves the groups as stored, with the links earlier versions kept with them, which are not read', async () => {
      const fake = createFakeSessions();
      const groupState = createBrowserGroupState(() => fake.api);
      await fake.api.sessions.setWindowValue(1, 'groups', [
        { ...group(1), nativeGroupId: 500 },
        { ...group(-2), nativeGroupId: null },
      ]);
      await groupState.setSchemaVersion(1, 3);
      const migrations = createMigrations({
        groupState,
        windows: createMemoryWindows(1),
        tabs: createMemoryTabs(),
        dataVersion: createMemoryDataVersion(),
        migrationFlag: createMemoryMigrationFlag(true),
        autoBackup: { writeIfDue: vi.fn() },
        canHideTabs: true,
        useNativeGroups: () => Promise.resolve(true),
        logger: { debug: vi.fn(), warn: vi.fn() },
      });

      await migrations.window(1);

      expect(fake.windowValues.get(fake.slot(1, 'groups'))).toEqual([
        { ...group(1), nativeGroupId: 500 },
        { ...group(-2), nativeGroupId: null },
      ]);
      expect(await groupState.getGroups(1)).toEqual([
        group(1),
        { ...group(-2), nativeGroupId: null },
      ]);
      expect(await groupState.getSchemaVersion(1)).toBe(DATA_VERSION);
    });
  });

  describe('the step to version 3', () => {
    it('shows the tabs of a window in native mode, which hid those of the groups not shown', async () => {
      const env = setUp();
      await env.groupState.setSchemaVersion(1, 2);
      env.tabs.setDetails([tab(10), tab(11), tab(12, 2)]);
      await env.tabs.hide([11]);

      await env.migrations.window(1);

      expect(env.tabs.calls).toEqual(['hide 11', 'show 10,11']);
      expect(await env.groupState.getSchemaVersion(1)).toBe(DATA_VERSION);
    });

    it('shows nothing of a window with no tabs', async () => {
      const env = setUp();
      await env.groupState.setSchemaVersion(1, 2);

      await env.migrations.window(1);

      expect(env.tabs.calls).toEqual([]);
    });

    it.each([
      ['native groups are off', true, false],
      ['the browser cannot hide tabs', false, true],
    ])('shows nothing where %s', async (_, canHideTabs, native) => {
      const env = setUp({ canHideTabs, native });
      await env.groupState.setSchemaVersion(1, 2);
      env.tabs.setDetails([tab(10)]);

      await env.migrations.window(1);

      expect(env.tabs.calls).toEqual([]);
      expect(env.useNativeGroups).toHaveBeenCalledTimes(canHideTabs ? 1 : 0);
      expect(await env.groupState.getSchemaVersion(1)).toBe(DATA_VERSION);
    });
  });

  describe('withMigratedWindows', () => {
    const calls: [keyof GroupState, (state: GroupState) => Promise<unknown>][] =
      [
        ['getGroups', (state) => state.getGroups(3)],
        ['setGroups', (state) => state.setGroups(3, [])],
        ['getActiveGroup', (state) => state.getActiveGroup(3)],
        ['setActiveGroup', (state) => state.setActiveGroup(3, 1)],
        ['getGroupIndex', (state) => state.getGroupIndex(3)],
        ['setGroupIndex', (state) => state.setGroupIndex(3, 4)],
      ];

    it.each(calls)(
      '%s waits for the window to be migrated',
      async (name, call) => {
        const order: string[] = [];
        let migrated: () => void = () => undefined;
        const window = vi.fn(
          (windowId: number) =>
            new Promise<boolean>((resolve) => {
              order.push(`migrating ${String(windowId)}`);
              migrated = () => {
                order.push('migrated');
                resolve(true);
              };
            }),
        );
        const inner: GroupState = {
          ...createMemoryGroupState(),
          [name]: () => {
            order.push(name);
            return Promise.resolve(undefined);
          },
        };

        const done = call(withMigratedWindows(inner, { window }));
        await Promise.resolve();
        expect(order).toEqual(['migrating 3']);

        migrated();
        await done;
        expect(order).toEqual(['migrating 3', 'migrated', name]);
      },
    );

    it('gives what the state gives, and stores what it is given', async () => {
      const inner = createMemoryGroupState();
      const state = withMigratedWindows(inner, {
        window: () => Promise.resolve(true),
      });

      await state.setGroups(3, [group(1)]);
      await state.setActiveGroup(3, 1);
      await state.setGroupIndex(3, 4);

      await expect(state.getGroups(3)).resolves.toEqual([group(1)]);
      await expect(state.getActiveGroup(3)).resolves.toBe(1);
      await expect(state.getGroupIndex(3)).resolves.toBe(4);
    });

    it('migrates nothing for the values of a tab, or the version', async () => {
      const window = vi.fn(() => Promise.resolve(true));
      const state = withMigratedWindows(createMemoryGroupState(), { window });

      await state.setTabGroup(5, 1);
      await state.getTabGroup(5);
      await state.clearTabGroup(5);
      await state.setSchemaVersion(3, 2);
      await state.getSchemaVersion(3);

      expect(window).not.toHaveBeenCalled();
    });
  });
});
