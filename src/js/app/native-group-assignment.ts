import { getColorForGroupId } from '../core/utils.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';

export interface NativeGroupAssignmentDeps {
  tabs: Pick<Tabs, 'listInWindow'>;
  windows: Pick<Windows, 'exists'>;
  groupState: Pick<GroupState, 'getTabGroup' | 'setNativeGroupLink'>;
  nativeGroups: Pick<
    NativeGroups,
    'createFromTabs' | 'setAppearance' | 'get' | 'removeTabs' | 'setCollapsed'
  >;
  // For the title of a group that has no name
  i18n: Pick<I18n, 'getMessage'>;
  logger: Pick<Logger, 'debug' | 'error' | 'warn'>;
}

export type NativeGroupCreation =
  | { kind: 'created'; nativeGroupId: number }
  // The group has no tab in the window, so there is nothing to group
  | { kind: 'no-tabs' }
  // The group could not be made; the reason has been logged
  | { kind: 'aborted' };

export interface NativeGroupAssignment {
  /**
   * Put the tabs of a group that are in a window into a new native tab group,
   * style it like the group, and link it to the group. `label` starts the log
   * messages: the event that led to this. A group that is not the one shown is
   * made `collapsed`, as the others are.
   */
  createNativeGroup: (options: {
    windowId: number;
    group: Group;
    label: string;
    collapsed?: boolean;
  }) => Promise<NativeGroupCreation>;
}

export function createNativeGroupAssignment({
  tabs,
  windows,
  groupState,
  nativeGroups,
  i18n,
  logger,
}: NativeGroupAssignmentDeps): NativeGroupAssignment {
  // The group was made in the window it was meant for. If not, the browser
  // moved the tabs, so they are taken out again rather than left in a group
  // nothing refers to.
  async function madeInWindow(
    nativeGroupId: number,
    tabIds: readonly number[],
    windowId: number,
    label: string,
  ): Promise<boolean> {
    try {
      const { windowId: madeIn } = await nativeGroups.get(nativeGroupId);
      if (madeIn === windowId) {
        return true;
      }
      logger.error(
        `[${label}] ❌ Window mismatch: created group ${String(nativeGroupId)} in window ${String(madeIn)}, expected ${String(windowId)}`,
      );
      await nativeGroups.removeTabs(tabIds).catch((error: unknown) => {
        logger.error(`[${label}] Failed to ungroup tabs:`, error);
      });
    } catch (error) {
      logger.error(`[${label}] Failed to validate native group:`, error);
    }
    return false;
  }

  return {
    async createNativeGroup({ windowId, group, label, collapsed = false }) {
      // A pinned tab is not grouped: grouping would unpin it
      const windowTabs = (await tabs.listInWindow(windowId)).filter(
        ({ pinned }) => !pinned,
      );
      const memberships = await Promise.all(
        windowTabs.map(async ({ id }) => ({
          id,
          groupId: await groupState.getTabGroup(id),
        })),
      );
      const tabIds = memberships
        .filter(({ groupId }) => groupId === group.id)
        .map(({ id }) => id);

      if (tabIds.length === 0) {
        logger.debug(
          `[${label}] No tabs found for group ${String(group.id)} to create native group`,
        );
        return { kind: 'no-tabs' };
      }

      if (!(await windows.exists(windowId))) {
        logger.warn(
          `[${label}] Window ${String(windowId)} was closed before creating native group`,
        );
        return { kind: 'aborted' };
      }

      const nativeGroupId = await nativeGroups.createFromTabs(tabIds, windowId);
      await nativeGroups.setAppearance(nativeGroupId, {
        title:
          group.name === ''
            ? `${i18n.getMessage('defaultGroupName')}${String(group.id)}`
            : group.name,
        color: getColorForGroupId(group.id),
      });

      // A reference to a group in the wrong window must not be kept
      if (!(await madeInWindow(nativeGroupId, tabIds, windowId, label))) {
        return { kind: 'aborted' };
      }

      // The link alone is written: making the group may have emptied another,
      // which the browser then removed and is forgetting the link of meanwhile
      await groupState.setNativeGroupLink(windowId, group.id, nativeGroupId);
      if (collapsed) {
        await nativeGroups.setCollapsed(nativeGroupId, true);
      }
      logger.debug(
        `[${label}] Created native group ${String(nativeGroupId)} for group ${String(group.id)} with ${String(tabIds.length)} tabs in window ${String(windowId)}`,
      );
      return { kind: 'created', nativeGroupId };
    },
  };
}
