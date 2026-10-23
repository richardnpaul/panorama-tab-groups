import { nativeGroupIdOf } from '../core/groups.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { MigrationFlag } from '../ports/migration-flag.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';
import type { NativeGroupAssignment } from './native-group-assignment.js';

export interface NativeGroupsSyncDeps {
  groupState: Pick<GroupState, 'getGroups' | 'setGroups' | 'getActiveGroup'>;
  tabs: Pick<Tabs, 'listInWindow'>;
  windows: Pick<Windows, 'listIds'>;
  nativeGroups: Pick<NativeGroups, 'get' | 'removeTabs'>;
  assignment: NativeGroupAssignment;
  migrationFlag: MigrationFlag;
  logger: Pick<Logger, 'debug' | 'warn' | 'error'>;
}

/** What the browser says about a native tab group that changed or went */
export interface NativeGroupEvent {
  id: number;
  windowId: number;
  title?: string | undefined;
}

export interface NativeGroupsSync {
  /**
   * Give the groups of existing users native tab groups, once. Gives false if
   * it failed, and then it is tried again next time.
   */
  migrate: () => Promise<boolean>;
  /**
   * Take the tabs out of all native tab groups, and forget them, when the
   * feature is switched off. Rejects if that failed.
   */
  cleanup: () => Promise<void>;
  /** The user closed a native tab group: forget it, but keep our group */
  onRemoved: (group: NativeGroupEvent) => Promise<void>;
  /** The user changed a native tab group: follow its name */
  onUpdated: (group: NativeGroupEvent) => Promise<void>;
}

const withoutNativeGroup = (group: Group): Group => {
  const { nativeGroupId, ...rest } = group;
  return rest;
};

// Ours has `null` for the group that never has one, and nothing before it had
const hasReference = (group: Group): boolean =>
  typeof group.nativeGroupId === 'number';

export function createNativeGroupsSync({
  groupState,
  tabs,
  windows,
  nativeGroups,
  assignment,
  migrationFlag,
  logger,
}: NativeGroupsSyncDeps): NativeGroupsSync {
  // While the groups are being taken apart on purpose, the browser's reports
  // that they are gone are not to be acted on
  let cleaning = false;

  // A reference to a native group that has gone since is dropped
  async function withoutStaleReference(group: Group): Promise<Group> {
    const reference = group.nativeGroupId;
    if (typeof reference !== 'number') {
      return group;
    }
    try {
      await nativeGroups.get(reference);
      return group;
    } catch (error) {
      logger.warn(
        `Group ${String(group.id)} has stale nativeGroupId ${String(reference)}, will recreate`,
        error,
      );
      return withoutNativeGroup(group);
    }
  }

  async function migrateWindow(windowId: number): Promise<void> {
    const groups = await groupState.getGroups(windowId);
    if (groups === undefined || groups.length === 0) {
      logger.debug(`No groups to migrate for window ${String(windowId)}`);
      return;
    }

    const valid = await Promise.all(groups.map(withoutStaleReference));

    // Only the active group gets a native group now: the others get theirs
    // when they become active
    const activeGroup = await groupState.getActiveGroup(windowId);
    const target = valid.find(
      (group) =>
        group.id === activeGroup && nativeGroupIdOf(group) === undefined,
    );
    if (target !== undefined) {
      try {
        const creation = await assignment.createNativeGroup({
          windowId,
          group: target,
          groups: valid,
          label: 'Migration',
        });
        if (creation.kind === 'created') {
          return;
        }
      } catch (error) {
        logger.warn(
          `Failed to create native group for group ${String(target.id)}:`,
          error,
        );
      }
    }

    await groupState.setGroups(windowId, valid);
  }

  async function migrate(): Promise<boolean> {
    try {
      if (await migrationFlag.isComplete()) {
        logger.debug('Migration already complete, skipping');
        return true;
      }

      const windowIds = await windows.listIds();
      await Promise.all(windowIds.map(migrateWindow));
      await migrationFlag.setComplete(true);
      return true;
    } catch (error) {
      logger.error('Migration to hybrid groups failed:', error);
      return false;
    }
  }

  async function cleanWindow(windowId: number): Promise<void> {
    const groups = await groupState.getGroups(windowId);
    if (groups === undefined) {
      return;
    }

    try {
      const grouped = (await tabs.listInWindow(windowId)).flatMap(
        ({ id, browserGroupId }) =>
          browserGroupId !== undefined && browserGroupId > 0 ? [id] : [],
      );
      if (grouped.length > 0) {
        await nativeGroups.removeTabs(grouped);
      }
    } catch (error) {
      logger.warn(
        `Failed to ungroup tabs in window ${String(windowId)}:`,
        error,
      );
    }

    await groupState.setGroups(
      windowId,
      groups.map((group) =>
        hasReference(group) ? withoutNativeGroup(group) : group,
      ),
    );
  }

  async function cleanup(): Promise<void> {
    cleaning = true;
    try {
      const windowIds = await windows.listIds();
      await Promise.all(windowIds.map(cleanWindow));

      // So that switching native groups on again migrates afresh
      await migrationFlag.setComplete(false);
    } catch (error) {
      logger.error('Native groups cleanup failed:', error);
      throw error;
    } finally {
      cleaning = false;
    }
  }

  // Change the groups of a window that refer to the native group. Nothing is
  // written when none does: the browser reports a group right after it is made,
  // before the group that made it has been given its reference, and writing the
  // groups back as they were then would lose that reference.
  async function followNativeGroup(
    { id, windowId }: NativeGroupEvent,
    change: (group: Group) => Group,
    failure: string,
  ): Promise<void> {
    try {
      const groups = await groupState.getGroups(windowId);
      if (groups?.some((group) => group.nativeGroupId === id) === true) {
        await groupState.setGroups(
          windowId,
          groups.map((group) =>
            group.nativeGroupId === id ? change(group) : group,
          ),
        );
      }
    } catch (error) {
      logger.warn(failure, error);
    }
  }

  return {
    migrate,
    cleanup,

    async onRemoved(group) {
      if (cleaning) {
        logger.debug(
          `Native tab group removed (ignored during cleanup): ${String(group.id)}`,
        );
        return;
      }
      await followNativeGroup(
        group,
        withoutNativeGroup,
        'Error syncing removed native group:',
      );
    },

    onUpdated: (group) =>
      followNativeGroup(
        group,
        (ours) => ({ ...ours, name: group.title ?? ours.name }),
        'Error syncing updated native group:',
      ),
  };
}
