import { isReservedGroupId } from '../core/constants.js';
import { fallbackActiveGroup } from '../core/tab-assignment.js';
import type { GroupDeletionRequest as GroupDeletion } from '../core/messages.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Menus } from '../ports/menus.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import { messageOf } from '../share/guards.js';
import type { OwnMoves } from './own-moves.js';
import type { WindowGroups } from './window-groups.js';

export interface DeleteGroupDeps {
  tabs: Pick<Tabs, 'listInWindow' | 'close'>;
  nativeGroups: Pick<NativeGroups, 'removeTabs'>;
  groupState: Pick<
    GroupState,
    'getGroups' | 'setGroups' | 'getActiveGroup' | 'setActiveGroup'
  >;
  windowGroups: Pick<WindowGroups, 'createGroupInWindow'>;
  menus: Pick<Menus, 'remove'>;
  // Whether the browser has native tab groups at all
  hasTabGroups: boolean;
  // Shows the tabs of a group in a window, and hides the rest
  toggleVisibleTabs: (activeGroup: number, windowId: number) => Promise<void>;
  // What the browser says of a tab the add-on ungroups to close is not the person's doing
  ownMoves: Pick<OwnMoves, 'during'>;
  logger: Pick<Logger, 'debug' | 'warn' | 'error'>;
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
  toggleVisibleTabs,
  ownMoves,
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
        await ownMoves.during(inGroup, () => nativeGroups.removeTabs(inGroup));
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

  // The window shows a group that exists once one is taken from it: if it was the one shown (its
  // tabs closed with it, or it had none because a pinned tab was all it had), the first of the
  // others is; if it was the last of the user's, a new first group is made
  async function putRight(
    windowId: number,
    groupId: number,
    left: readonly Group[],
  ): Promise<void> {
    // The group for ungrouped tabs stays, and is not one of the user's
    if (left.every(({ id }) => isReservedGroupId(id))) {
      logger.debug('Last group deleted, creating new initial group...');
      await windowGroups.createGroupInWindow(windowId);
      return;
    }
    if ((await groupState.getActiveGroup(windowId)) === groupId) {
      // The group for ungrouped tabs is among them, and is not a group a window shows
      const next = fallbackActiveGroup(left);
      await groupState.setActiveGroup(windowId, next);
      await toggleVisibleTabs(next, windowId).catch((error: unknown) => {
        logger.warn(`Could not show group ${String(next)}:`, error);
      });
    }
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
    // The group is gone for good once the groups are stored without it: what fails after is no
    // failure to delete, or a page would keep the group and store it again
    await putRight(windowId, groupId, left).catch((error: unknown) => {
      logger.warn(
        `Group ${String(groupId)} is deleted, but window ${String(windowId)} could not be put right after it:`,
        error,
      );
    });
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
