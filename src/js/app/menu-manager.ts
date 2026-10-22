/**
 * Menu Manager - Context menu management for Panorama Tab Groups
 *
 * Handles creation, updating, and removal of context menu items
 * for sending tabs to different groups.
 */
import type { GroupState } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { Menus } from '../ports/menus.js';
import type { Windows } from '../ports/windows.js';
import { isNumber, isRecord, isString } from '../share/guards.js';

export interface MenuManagerDeps {
  menus: Menus;
  groupState: Pick<GroupState, 'getGroups'>;
  windows: Windows;
  i18n: I18n;
  logger: Pick<Logger, 'warn' | 'error'>;
}

export interface MenuManager {
  addRefreshMenuItem: () => Promise<void>;
  createMenuList: () => Promise<void>;
  handleMenuChange: (message: unknown) => Promise<void>;
}

const SEND_TAB = 'send-tab';
const REFRESH_SPACER = 'refresh-spacer';
const REFRESH_GROUPS = 'refresh-groups';

type MenuChange =
  | {
      action: 'createMenuItem' | 'updateMenuItem';
      groupId: string | number;
      groupName: string;
    }
  | { action: 'removeMenuItem'; groupId: string | number };

const isGroupId = (value: unknown): value is string | number =>
  isString(value) || isNumber(value);

/** What the view asked for, or nothing if the message is not a menu change */
function parseMenuChange(message: unknown): MenuChange | undefined {
  if (!isRecord(message) || !isGroupId(message.groupId)) {
    return undefined;
  }
  const { action, groupId, groupName } = message;
  if (action === 'removeMenuItem') {
    return { action, groupId };
  }
  if (
    (action === 'createMenuItem' || action === 'updateMenuItem') &&
    isString(groupName)
  ) {
    return { action, groupId, groupName };
  }
  return undefined;
}

export function createMenuManager({
  menus,
  groupState,
  windows,
  i18n,
  logger,
}: MenuManagerDeps): MenuManager {
  const groupItem = (id: string | number, name: string) => ({
    id: String(id),
    title: `${String(id)}: ${name}`,
    parentId: SEND_TAB,
    contexts: ['tab' as const],
  });

  /**
   * Add the refresh item to the end of the menu list, so the refresh option is
   * always at the bottom.
   */
  async function addRefreshMenuItem(): Promise<void> {
    // The items may not exist yet; there is nothing to do about that
    await menus.remove(REFRESH_GROUPS).catch(() => undefined);
    await menus.remove(REFRESH_SPACER).catch(() => undefined);

    menus.create({
      id: REFRESH_SPACER,
      type: 'separator',
      parentId: SEND_TAB,
      contexts: ['tab'],
    });
    menus.create({
      id: REFRESH_GROUPS,
      title: i18n.getMessage('refreshGroups'),
      parentId: SEND_TAB,
      contexts: ['tab'],
    });
  }

  return {
    addRefreshMenuItem,

    /**
     * Create the complete menu list with all groups. Called during
     * initialization and when groups are refreshed.
     */
    async createMenuList() {
      try {
        await menus.removeAll();

        menus.create({
          id: SEND_TAB,
          title: i18n.getMessage('sendTabToGroup') || 'Send Tab to Group',
          contexts: ['tab'],
        });

        const groups = await groupState.getGroups(
          await windows.currentWindowId(),
        );
        // The window may not have its groups yet
        if (groups === undefined) {
          return;
        }

        groups.forEach(({ id, name }) => {
          menus.create(groupItem(id, name));
        });
        await addRefreshMenuItem();
      } catch (error) {
        logger.error('Failed to create menu list:', error);
      }
    },

    /**
     * Handle menu change messages from the view: createMenuItem,
     * removeMenuItem and updateMenuItem.
     */
    async handleMenuChange(message) {
      const change = parseMenuChange(message);
      if (change === undefined) {
        return;
      }
      const id = String(change.groupId);

      if (change.action === 'createMenuItem') {
        menus.create(groupItem(change.groupId, change.groupName));
        await addRefreshMenuItem(); // move refresh menu to end
      } else if (change.action === 'removeMenuItem') {
        try {
          await menus.remove(id);
        } catch (error) {
          // The menu item may not exist
          logger.warn(
            `Could not remove menu item ${id}:`,
            error instanceof Error ? error.message : error,
          );
        }
      } else {
        await menus.update(id, { title: `${id}: ${change.groupName}` });
      }
    },
  };
}
