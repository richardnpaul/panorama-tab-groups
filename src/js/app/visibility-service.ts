import {
  checkActiveGroup,
  planVisibility,
  type VisibilityTab,
} from '../core/visibility.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';

export interface VisibilityDeps {
  tabs: Pick<Tabs, 'listInCurrentWindow' | 'activate' | 'hide' | 'show'>;
  windows: Pick<Windows, 'currentWindowId' | 'lastFocusedWindowId'>;
  groupState: Pick<GroupState, 'getTabGroup' | 'getGroups'>;
  nativeGroups: NativeGroups;
  toolbar: {
    updateActionTitle: (windowId: number, activeGroup: number) => Promise<void>;
  };
  // Whether the browser can hide tabs at all
  canHideTabs: boolean;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  logger: Pick<Logger, 'warn' | 'error'>;
}

export interface VisibilityService {
  /**
   * Show the tabs of the active group and hide the others, keeping the native
   * tab groups in step. `noTabSelected` also activates one of the shown tabs.
   */
  toggleVisibleTabs: (
    activeGroup: unknown,
    noTabSelected?: boolean,
  ) => Promise<void>;
}

export function createVisibilityService({
  tabs,
  windows,
  groupState,
  nativeGroups,
  toolbar,
  canHideTabs,
  useNativeGroups,
  logger,
}: VisibilityDeps): VisibilityService {
  // Pinned tabs always stay visible, so their group does not matter; a tab
  // that cannot be read has probably been closed and is left out
  async function withGroup(tab: {
    id: number;
    pinned: boolean;
    lastAccessed: number;
  }): Promise<VisibilityTab | undefined> {
    if (tab.pinned) {
      return { ...tab, groupId: undefined };
    }
    try {
      return { ...tab, groupId: await groupState.getTabGroup(tab.id) };
    } catch {
      return undefined;
    }
  }

  // Ignored: the native group may have been closed since it was recorded
  const ignoringFailure = (action: Promise<void>): Promise<void> =>
    action.catch(() => undefined);

  return {
    async toggleVisibleTabs(activeGroup, noTabSelected = false) {
      const check = checkActiveGroup(activeGroup);
      if (!check.valid) {
        // Switching to no group would hide every tab
        if (check.problem === 'undefined') {
          logger.warn(
            '[ToggleVisibleTabs] activeGroup is undefined, so no tab is hidden or shown',
          );
        } else {
          logger.error(
            `[ToggleVisibleTabs] Invalid activeGroup: ${String(activeGroup)} - must be -1 or positive integer`,
          );
        }
        return;
      }

      const windowTabs = await tabs.listInCurrentWindow();
      const windowId = await windows.currentWindowId();
      const groupedTabs = await Promise.all(windowTabs.map(withGroup));
      const groups = (await useNativeGroups())
        ? ((await groupState.getGroups(windowId)) ?? [])
        : [];

      const plan = planVisibility({
        activeGroup: check.activeGroup,
        noTabSelected,
        tabs: groupedTabs.filter((tab) => tab !== undefined),
        groups,
        canHideTabs,
      });

      if (plan.kind === 'abort') {
        logger.error(
          `[ToggleVisibleTabs] ERROR: No tabs will be shown! All ${String(plan.hiddenCount)} tabs would be hidden (activeGroup=${String(check.activeGroup)}), so nothing is changed`,
        );
        return;
      }

      if (plan.activate !== undefined) {
        await tabs.activate(plan.activate);
      }

      // Collapse and hide the inactive groups
      await Promise.all(
        plan.collapse.map((id) =>
          ignoringFailure(nativeGroups.setCollapsed(id, true)),
        ),
      );
      if (plan.hide.length > 0) {
        await tabs.hide(plan.hide);
      }

      // Show and expand the active group
      if (plan.show.length > 0) {
        await tabs.show(plan.show);
      }
      if (plan.expand !== undefined) {
        await ignoringFailure(nativeGroups.setCollapsed(plan.expand, false));
      }

      if (plan.updateTitle) {
        await toolbar.updateActionTitle(
          await windows.lastFocusedWindowId(),
          check.activeGroup,
        );
      }
    },
  };
}
