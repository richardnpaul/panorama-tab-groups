import { isReservedGroupId } from '../core/constants.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Toolbar } from '../ports/toolbar.js';

export interface ToolbarServiceDeps {
  groupState: Pick<GroupState, 'getGroups' | 'getActiveGroup'>;
  toolbar: Toolbar;
  logger: Pick<Logger, 'warn'>;
}

export interface ToolbarService {
  /** Show the active group and the number of groups of a window */
  updateActionTitle: (windowId: number, activeGroup?: number) => Promise<void>;
  /** Show that the window has no active group yet */
  showNoActiveGroup: (windowId: number) => Promise<void>;
}

const BADGE_COLOUR = '#666666';

export function createToolbarService({
  groupState,
  toolbar,
  logger,
}: ToolbarServiceDeps): ToolbarService {
  // The toolbar is a nicety: failing to update it must never stop the caller
  async function show(
    windowId: number,
    title: string,
    badge: string,
  ): Promise<void> {
    try {
      await toolbar.setTitle(windowId, title);
      await toolbar.setBadgeText(windowId, badge);
      await toolbar.setBadgeBackgroundColor(BADGE_COLOUR);
    } catch (error) {
      logger.warn('Failed to set action title/badge:', error);
    }
  }

  return {
    async updateActionTitle(windowId, activeGroup) {
      const groups = (await groupState.getGroups(windowId)) ?? [];
      const active = activeGroup ?? (await groupState.getActiveGroup(windowId));
      const name = groups.find(({ id }) => id === active)?.name ?? 'None';

      // The system group for ungrouped tabs is kept with the groups, but is not one the user has
      const shown = groups.filter(({ id }) => !isReservedGroupId(id)).length;

      await show(windowId, `Active Group: ${name}`, String(shown));
    },

    showNoActiveGroup: (windowId) => show(windowId, 'Active Group: None', '1'),
  };
}
