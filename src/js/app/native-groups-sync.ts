import { isReservedGroupId, UNGROUPED_GROUP_ID } from '../core/constants.js';
import { fallbackActiveGroup } from '../core/tab-assignment.js';
import { nativeGroupIdOf } from '../core/groups.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { MigrationFlag } from '../ports/migration-flag.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';
import type { NativeGroupAssignment } from './native-group-assignment.js';

export interface NativeGroupsSyncDeps {
  groupState: Pick<
    GroupState,
    | 'getGroups'
    | 'setGroups'
    | 'setNativeGroupLink'
    | 'getActiveGroup'
    | 'getTabGroup'
    | 'setTabGroup'
  >;
  tabs: Pick<Tabs, 'listInWindow' | 'show'>;
  windows: Pick<Windows, 'listIds'>;
  nativeGroups: Pick<NativeGroups, 'get' | 'removeTabs'>;
  assignment: NativeGroupAssignment;
  migrationFlag: MigrationFlag;
  // Whether the browser can hide tabs, which native mode never does
  canHideTabs: boolean;
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
   * After the browser started again, the native groups have new ids and the groups
   * refer to the old ones: a group whose tabs are not in the native group it refers to
   * is linked to the one its tabs are in, if they are all in one, and forgets the
   * reference if not (it is made again when it is needed).
   */
  relink: () => Promise<void>;
  /**
   * Give the groups of existing users native tab groups, once. Gives false if
   * it failed, and then it is tried again next time. It failed if it tried to
   * make native groups and not one could be made (a browser that has none, or
   * that refuses): saying it was done then would be wrong, and would stop it
   * being tried again.
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

/** What came of the attempt to give the active group of a window a native group */
type WindowMigration = 'created' | 'failed' | 'nothing-to-do';

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
  canHideTabs,
  logger,
}: NativeGroupsSyncDeps): NativeGroupsSync {
  // While the groups are being taken apart on purpose, the browser's reports
  // that they are gone are not to be acted on
  let cleaning = false;
  // What the browser reports is followed one report after the other: a rename
  // writes the groups of a window whole, and two at once would each write back
  // what the other changed. Each report's failure is logged, so this never rejects.
  let following: Promise<void> = Promise.resolve();

  function inTurn(work: () => Promise<void>, failure: string): Promise<void> {
    following = following.then(() =>
      work().catch((error: unknown) => {
        logger.warn(failure, error);
      }),
    );
    return following;
  }

  // A link to a native group that has gone since is forgotten
  async function withoutStaleReference(
    windowId: number,
    group: Group,
  ): Promise<Group> {
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
      await groupState.setNativeGroupLink(windowId, group.id, undefined);
      return withoutNativeGroup(group);
    }
  }

  // A tab that is shown already is left as it is
  async function showAll(windowId: number): Promise<void> {
    const tabIds = (await tabs.listInWindow(windowId)).map(({ id }) => id);
    if (tabIds.length > 0) {
      await tabs.show(tabIds);
    }
  }

  // A group with no tabs in the window has nothing to be made of
  async function nativeGroupFor(
    windowId: number,
    group: Group,
    collapsed: boolean,
  ): Promise<WindowMigration> {
    try {
      const creation = await assignment.createNativeGroup({
        windowId,
        group,
        label: 'Migration',
        collapsed,
      });
      if (creation.kind === 'created') {
        return 'created';
      }
      return creation.kind === 'aborted' ? 'failed' : 'nothing-to-do';
    } catch (error) {
      logger.warn(
        `Failed to create native group for group ${String(group.id)}:`,
        error,
      );
      return 'failed';
    }
  }

  async function migrateWindow(windowId: number): Promise<WindowMigration> {
    const groups = await groupState.getGroups(windowId);
    if (groups === undefined || groups.length === 0) {
      logger.debug(`No groups to migrate for window ${String(windowId)}`);
      return 'nothing-to-do';
    }

    const valid = await Promise.all(
      groups.map((group) => withoutStaleReference(windowId, group)),
    );

    // Every group that has a tab gets a native group, one after the other: a group made
    // can empty another, which the browser then removes
    const activeGroup = await groupState.getActiveGroup(windowId);
    const outcomes = await valid
      .filter(
        (group) =>
          !isReservedGroupId(group.id) && nativeGroupIdOf(group) === undefined,
      )
      .reduce<Promise<WindowMigration[]>>(
        async (done, group) => [
          ...(await done),
          await nativeGroupFor(windowId, group, group.id !== activeGroup),
        ],
        Promise.resolve([]),
      );

    // No tab is hidden in native mode: those the groups not shown had hidden are shown, after
    // they are in their collapsed native groups (Firefox groups a hidden tab, and keeps it
    // hidden: tests/e2e/firefox-facts.spec.ts), so they do not show outside them first
    if (canHideTabs) {
      await showAll(windowId);
    }

    if (outcomes.includes('created')) {
      return 'created';
    }
    return outcomes.includes('failed') ? 'failed' : 'nothing-to-do';
  }

  // A group is linked to the native group its tabs are in, where they are all in
  // one that the tabs of no other group are in; otherwise to none, and one is made
  // when it is needed
  async function relinkWindow(windowId: number): Promise<void> {
    const groups = await groupState.getGroups(windowId);
    if (groups === undefined) {
      return;
    }
    const placed = await Promise.all(
      (await tabs.listInWindow(windowId)).map(
        async ({ id, browserGroupId }) => ({
          browserGroupId,
          group: await groupState.getTabGroup(id),
        }),
      ),
    );
    // The native groups that the tabs of a group are in
    const nativeIdsOf = (groupId: number): number[] => [
      ...new Set(
        placed.flatMap((tab) =>
          tab.group === groupId &&
          tab.browserGroupId !== undefined &&
          tab.browserGroupId > 0
            ? [tab.browserGroupId]
            : [],
        ),
      ),
    ];

    const found = groups
      .filter(({ id }) => !isReservedGroupId(id))
      .map((group) => {
        const ids = nativeIdsOf(group.id);
        return { group, link: ids.length === 1 ? ids[0] : undefined };
      });
    const shared = new Set(
      found
        .map(({ link }) => link)
        .filter((link, at, all) => all.indexOf(link) !== at),
    );
    await Promise.all(
      found.map(async ({ group, link }) => {
        const next = shared.has(link) ? undefined : link;
        if (next !== nativeGroupIdOf(group)) {
          await groupState.setNativeGroupLink(windowId, group.id, next);
        }
      }),
    );
  }

  async function relink(): Promise<void> {
    try {
      await Promise.all((await windows.listIds()).map(relinkWindow));
    } catch (error) {
      logger.warn('Linking the groups to the native groups failed:', error);
    }
  }

  async function migrate(): Promise<boolean> {
    try {
      if (await migrationFlag.isComplete()) {
        logger.debug('Migration already complete, skipping');
        return true;
      }

      const outcomes = await Promise.all(
        (await windows.listIds()).map(migrateWindow),
      );
      if (outcomes.includes('failed') && !outcomes.includes('created')) {
        logger.error(
          'Migration to hybrid groups failed: no window could be given a native tab group',
        );
        return false;
      }
      await migrationFlag.setComplete(true);
      return true;
    } catch (error) {
      logger.error('Migration to hybrid groups failed:', error);
      return false;
    }
  }

  // With native groups off, tabs are hidden: one in the group for ungrouped tabs, which is none to
  // show, would be hidden for good. Such a tab joins the group the window shows.
  async function giveUngroupedTabsAGroup(
    windowId: number,
    groups: readonly Group[],
  ): Promise<void> {
    const active = await groupState.getActiveGroup(windowId);
    const shown =
      active !== undefined && groups.some(({ id }) => id === active)
        ? active
        : fallbackActiveGroup(groups);
    await Promise.all(
      (await tabs.listInWindow(windowId)).map(async ({ id, pinned }) => {
        if (
          !pinned &&
          (await groupState.getTabGroup(id)) === UNGROUPED_GROUP_ID
        ) {
          await groupState.setTabGroup(id, shown);
        }
      }),
    );
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

    await Promise.all(
      groups
        .filter(hasReference)
        .map(({ id }) =>
          groupState.setNativeGroupLink(windowId, id, undefined),
        ),
    );
    await giveUngroupedTabsAGroup(windowId, groups);
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

  // The groups of a window linked to a native group. The browser reports a group
  // right after it is made, before the group that made it has its link: none is
  // linked to it then, and nothing is done.
  async function linkedTo({
    id,
    windowId,
  }: NativeGroupEvent): Promise<Group[]> {
    const groups = (await groupState.getGroups(windowId)) ?? [];
    return groups.filter((group) => group.nativeGroupId === id);
  }

  async function forget(event: NativeGroupEvent): Promise<void> {
    await Promise.all(
      (await linkedTo(event)).map(({ id }) =>
        groupState.setNativeGroupLink(event.windowId, id, undefined),
      ),
    );
  }

  // The name is the native group's title as it is now, not as the event said: the browser
  // reports a group made with no title (Chromium does, a moment before the title is set), and
  // that report can arrive after the group was linked. A group the add-on is making is linked
  // only once its title is set, so a report of a group no group is linked to is left alone. The
  // groups are read again once the title is known, and stored only when a name changes: a page
  // may store them while the title is asked for, and most reports (a group collapsed or
  // expanded) change no name.
  async function rename(event: NativeGroupEvent): Promise<void> {
    const isLinked = (groups: Group[] | undefined): boolean =>
      groups?.some((group) => group.nativeGroupId === event.id) === true;
    if (!isLinked(await groupState.getGroups(event.windowId))) {
      return;
    }
    // A group that is gone has been reported gone, which forgets its link
    const { title } = await nativeGroups.get(event.id);
    if (title === undefined) {
      return;
    }
    const groups = (await groupState.getGroups(event.windowId)) ?? [];
    if (
      !groups.some(
        (group) => group.nativeGroupId === event.id && group.name !== title,
      )
    ) {
      return;
    }
    await groupState.setGroups(
      event.windowId,
      groups.map((group) =>
        group.nativeGroupId === event.id ? { ...group, name: title } : group,
      ),
    );
  }

  return {
    relink,
    migrate,
    cleanup,

    async onRemoved(group) {
      if (cleaning) {
        logger.debug(
          `Native tab group removed (ignored during cleanup): ${String(group.id)}`,
        );
        return;
      }
      await inTurn(() => forget(group), 'Error syncing removed native group:');
    },

    onUpdated: (group) =>
      inTurn(() => rename(group), 'Error syncing updated native group:'),
  };
}
