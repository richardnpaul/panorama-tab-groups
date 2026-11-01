import type { GroupDeletionRequest as GroupDeletion } from '../core/messages.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Menus } from '../ports/menus.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import { messageOf } from '../share/guards.js';
import type { WindowGroups } from './window-groups.js';

export interface DeleteGroupDeps {
  tabs: Pick<Tabs, 'listInWindow' | 'close'>;
  nativeGroups: Pick<NativeGroups, 'removeTabs'>;
  groupState: Pick<GroupState, 'getGroups' | 'setGroups'>;
  windowGroups: Pick<WindowGroups, 'createGroupInWindow'>;
  menus: Pick<Menus, 'remove'>;
  // Whether the browser has native tab groups at all
  hasTabGroups: boolean;
  logger: Pick<Logger, 'debug' | 'error'>;
}

export type DeletionResult =
  { success: true } | { success: false; error: string };

/**
 * Delete a group completely: take its tabs out of its native group, close
 * them, forget the group and remove its menu item.
 */
export function createGroupDeletion({
  tabs,
  nativeGroups,
  groupState,
  windowGroups,
  menus,
  hasTabGroups,
  logger,
}: DeleteGroupDeps): (deletion: GroupDeletion) => Promise<DeletionResult> {
  // Taken out first, so the browser does not keep a group of closed tabs
  async function ungroupTabs({
    windowId,
    nativeGroupId,
    tabIds,
  }: GroupDeletion): Promise<void> {
    if (!hasTabGroups || typeof nativeGroupId !== 'number') {
      return;
    }
    try {
      // Only the tabs that are still there, and still in that native group
      const existing = await tabs.listInWindow(windowId);
      const inGroup = tabIds.filter((id) =>
        existing.some(
          (tab) => tab.id === id && tab.browserGroupId === nativeGroupId,
        ),
      );
      if (inGroup.length > 0) {
        await nativeGroups.removeTabs(inGroup);
        logger.debug(
          `Ungrouped ${String(inGroup.length)} tabs from native group ${String(nativeGroupId)}`,
        );
      }
    } catch (error) {
      // The group may be gone already, or its tabs ungrouped
      logger.debug(
        `Could not ungroup tabs (group may already be removed): ${messageOf(error)}`,
      );
    }
  }

  async function closeTabs(tabIds: readonly number[]): Promise<void> {
    await Promise.all(
      tabIds.map((id) =>
        tabs.close(id).catch((error: unknown) => {
          // The tab may be closed already
          logger.debug(
            `Could not remove tab ${String(id)}: ${messageOf(error)}`,
          );
        }),
      ),
    );
  }

  async function forgetGroup({
    groupId,
    windowId,
  }: GroupDeletion): Promise<void> {
    const groups = await groupState.getGroups(windowId);
    if (groups === undefined) {
      return;
    }
    const left = groups.filter(({ id }) => id !== groupId);
    await groupState.setGroups(windowId, left);

    if (left.length === 0) {
      logger.debug('Last group deleted, creating new initial group...');
      await windowGroups.createGroupInWindow(windowId);
    }
  }

  return async function deleteGroup(deletion) {
    logger.debug(
      `Deleting group ${String(deletion.groupId)} with ${String(deletion.tabIds.length)} tabs, nativeGroupId: ${String(deletion.nativeGroupId)}`,
    );

    try {
      await ungroupTabs(deletion);
      await closeTabs(deletion.tabIds);
      await forgetGroup(deletion);

      try {
        await menus.remove(String(deletion.groupId));
      } catch (error) {
        // The menu item may not exist
        logger.debug(`Could not remove menu item: ${messageOf(error)}`);
      }
      return { success: true };
    } catch (error) {
      logger.error(
        `Group deletion failed for group ${String(deletion.groupId)}:`,
        error,
      );
      return { success: false, error: messageOf(error) };
    }
  };
}
