import { VIEWER_GROUP_ID } from '../core/constants.js';
import type { DataVersion } from '../ports/data-version.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { MigrationFlag } from '../ports/migration-flag.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';
import type { AutoBackup } from './auto-backup.js';

/**
 * The version of the shape of the stored data that this version of the add-on writes
 * (docs/plans/data-structures-review.md, decision 3). What was stored before there was a
 * version is version 1.
 *
 * 2. Groups have no `containerId` (decision 4)
 * 3. Native mode hides no tab, and every group that has a tab has a native group (decision 1)
 * 4. A group's link to its native group is not stored with it, but in `storage.session` (decision 5)
 * 5. A pinned tab has no group (decision 6)
 */
export const DATA_VERSION = 5;

export interface MigrationsDeps {
  /** The stored state, as it is, not migrated on the way */
  groupState: GroupState;
  windows: Pick<Windows, 'listIds'>;
  tabs: Pick<Tabs, 'listInWindow' | 'show'>;
  dataVersion: DataVersion;
  // Cleared, so that the groups are given native groups again under the rules of now
  migrationFlag: Pick<MigrationFlag, 'setComplete'>;
  autoBackup: Pick<AutoBackup, 'writeIfDue'>;
  // Whether the browser can hide tabs at all
  canHideTabs: boolean;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  logger: Pick<Logger, 'debug' | 'warn'>;
}

export interface Migrations {
  /**
   * Bring what is stored of a window, and of its tabs, to the current version, once. A window
   * that comes back from long ago (Firefox restores a closed window with the values it had) is
   * brought up when it is first used. Gives whether it was; a failure is logged, and the window
   * is tried again at the next start of the background.
   */
  window: (windowId: number) => Promise<boolean>;
  /**
   * When the stored data is of an older version: write a backup of it as it is, then bring
   * every open window up. First at start-up, before anything reads what is stored.
   */
  atStart: () => Promise<void>;
}

const withoutContainer = (group: Group): Group => {
  const { containerId, ...rest } = group;
  return rest;
};

export function createMigrations({
  groupState,
  windows,
  tabs,
  dataVersion,
  migrationFlag,
  autoBackup,
  canHideTabs,
  useNativeGroups,
  logger,
}: MigrationsDeps): Migrations {
  // 1 to 2: a group's container was never a container, and is not kept
  async function dropContainers(windowId: number): Promise<void> {
    const groups = await groupState.getGroups(windowId);
    if (groups?.some(({ containerId }) => containerId !== undefined) === true) {
      await groupState.setGroups(windowId, groups.map(withoutContainer));
    }
  }

  // 2 to 3: native mode hid the tabs of the groups not shown, and hides none now; a window
  // restored from before is shown too, and its tabs join their native groups as they arrive
  async function showHiddenTabs(windowId: number): Promise<void> {
    if (!canHideTabs || !(await useNativeGroups())) {
      return;
    }
    const tabIds = (await tabs.listInWindow(windowId)).map(({ id }) => id);
    if (tabIds.length > 0) {
      await tabs.show(tabIds);
    }
  }

  // 3 to 4: the links stored with the groups are stale after a restart in Chromium, and are kept
  // apart now. Nothing is done for it: groups are read without those links, and stored again
  // without them the next time they are written. Writing them here would take a window's groups
  // as read, and lose what a page stored in between.
  const linksKeptApart = (): Promise<void> => Promise.resolve();

  // 4 to 5: a pinned tab was given the group of the window, and has none now. The view, if it is
  // pinned, is not in a group of the user's and keeps what marks it.
  async function ungroupPinnedTabs(windowId: number): Promise<void> {
    const pinned = (await tabs.listInWindow(windowId)).filter(
      (tab) => tab.pinned,
    );
    await Promise.all(
      pinned.map(async ({ id }) => {
        if ((await groupState.getTabGroup(id)) !== VIEWER_GROUP_ID) {
          await groupState.clearTabGroup(id);
        }
      }),
    );
  }

  // The step from each version to the next, from version 1; each can run again without harm
  const steps: ((windowId: number) => Promise<void>)[] = [
    dropContainers,
    showHiddenTabs,
    linksKeptApart,
    ungroupPinnedTabs,
  ];

  async function migrate(windowId: number): Promise<void> {
    // The state gives only whole versions from 1 (`isDataVersion`); data from before there was one is 1
    const from = (await groupState.getSchemaVersion(windowId)) ?? 1;
    const due = steps.slice(from - 1);
    if (due.length === 0) {
      return;
    }
    await due.reduce(
      (done, step) => done.then(() => step(windowId)),
      Promise.resolve(),
    );
    await groupState.setSchemaVersion(windowId, DATA_VERSION);
    logger.debug(
      `[Migration] Window ${String(windowId)}: version ${String(from)} to ${String(DATA_VERSION)}`,
    );
  }

  // Once for each window, however many ask for it at once
  const migrated = new Map<number, Promise<boolean>>();

  function window(windowId: number): Promise<boolean> {
    const known = migrated.get(windowId);
    if (known !== undefined) {
      return known;
    }
    const running = migrate(windowId).then(
      () => true,
      (error: unknown) => {
        logger.warn(
          `[Migration] Window ${String(windowId)} was not migrated; it is tried again at the next start:`,
          error,
        );
        return false;
      },
    );
    migrated.set(windowId, running);
    return running;
  }

  return {
    window,

    async atStart() {
      const stored = (await dataVersion.read()) ?? 1;
      if (stored >= DATA_VERSION) {
        return;
      }
      const windowIds = await windows.listIds();
      const kept = await Promise.all(
        windowIds.map((windowId) => groupState.getGroups(windowId)),
      );
      // A first run has nothing to keep
      if (kept.some((groups) => groups !== undefined && groups.length > 0)) {
        // Once an hour at most: a migration that fails is tried again at each start
        const saved = await autoBackup.writeIfDue(
          `before version ${String(stored)} of the stored data is brought to ${String(DATA_VERSION)}`,
        );
        if (!saved) {
          logger.warn(
            '[Migration] The backup before the migration could not be written; the data is brought up all the same',
          );
        }
      }
      const done = await Promise.all(windowIds.map(window));
      // A note that cannot be written is tried again at the next start, as the migration is; the
      // start-up goes on
      const note = async (what: string, write: () => Promise<void>) => {
        try {
          await write();
        } catch (error) {
          logger.warn(
            `[Migration] ${what} could not be stored; it is tried again at the next start:`,
            error,
          );
        }
      };
      // Before 3, only the group on show had a native group: the others get theirs now
      if (stored < 3) {
        await note('That the groups need native groups again', () =>
          migrationFlag.setComplete(false),
        );
      }
      // The version of the profile is the version of all of it: a window that failed keeps it back,
      // and everything is tried again at the next start (with a backup first)
      if (done.every(Boolean)) {
        await note('The version of the stored data', () =>
          dataVersion.write(DATA_VERSION),
        );
      } else {
        logger.warn(
          `[Migration] Not every window was migrated, so the stored data stays at version ${String(stored)} for now`,
        );
      }
    },
  };
}

/**
 * The group state, with each window brought to the current version before anything of it is
 * read or written. The values of tabs are brought up with their window.
 */
export function withMigratedWindows(
  inner: GroupState,
  migrations: Pick<Migrations, 'window'>,
): GroupState {
  const migrated = async <T>(
    windowId: number,
    work: () => Promise<T>,
  ): Promise<T> => {
    await migrations.window(windowId);
    return work();
  };

  return {
    ...inner,
    getGroups: (windowId) =>
      migrated(windowId, () => inner.getGroups(windowId)),
    setGroups: (windowId, groups) =>
      migrated(windowId, () => inner.setGroups(windowId, groups)),
    getActiveGroup: (windowId) =>
      migrated(windowId, () => inner.getActiveGroup(windowId)),
    setActiveGroup: (windowId, groupId) =>
      migrated(windowId, () => inner.setActiveGroup(windowId, groupId)),
    getGroupIndex: (windowId) =>
      migrated(windowId, () => inner.getGroupIndex(windowId)),
    setGroupIndex: (windowId, index) =>
      migrated(windowId, () => inner.setGroupIndex(windowId, index)),
  };
}
