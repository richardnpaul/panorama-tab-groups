/**
 * Menu Manager - Context menu management for Tab Groups Viewer
 *
 * Handles creation, updating, and removal of context menu items
 * for sending tabs to different groups.
 */
import { menuItemId } from '../core/menu-items.js';
import type { MenuChange } from '../core/messages.js';
import type { GroupState } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { Menus } from '../ports/menus.js';
import type { Windows } from '../ports/windows.js';

export interface MenuManagerDeps {
  menus: Menus;
  groupState: Pick<GroupState, 'getGroups'>;
  windows: Windows;
  i18n: I18n;
  logger: Pick<Logger, 'warn' | 'error'>;
}

export interface MenuManager {
  addRefreshMenuItem: () => Promise<void>;
  createMenuList: (forWindowId?: number) => Promise<void>;
  handleMenuChange: (change: MenuChange) => Promise<void>;
}

const SEND_TAB = 'send-tab';
const REFRESH_SPACER = 'refresh-spacer';
const REFRESH_GROUPS = 'refresh-groups';

export function createMenuManager({
  menus,
  groupState,
  windows,
  i18n,
  logger,
}: MenuManagerDeps): MenuManager {
  let turn: Promise<unknown> = Promise.resolve();
  const inTurn = (work: () => Promise<void>): Promise<void> => {
    const next = turn.then(work);
    turn = next.catch(() => undefined);
    return next;
  };

  const groupItem = (windowId: number, id: number, name: string) => ({
    id: menuItemId(windowId, id),
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
    createMenuList: (forWindowId) =>
      inTurn(async () => {
        try {
          await menus.removeAll();

          menus.create({
            id: SEND_TAB,
            title: i18n.getMessage('sendTabToGroup'),
            contexts: ['tab'],
          });

          const windowId = forWindowId ?? (await windows.currentWindowId());
          const groups = await groupState.getGroups(windowId);
          // The window may not have its groups yet
          groups?.forEach(({ id, name }) => {
            menus.create(groupItem(windowId, id, name));
          });
          await addRefreshMenuItem();
        } catch (error) {
          logger.error('Failed to create menu list:', error);
        }
      }),

    /**
     * Handle menu change messages from the view: createMenuItem,
     * removeMenuItem and updateMenuItem.
     */
    handleMenuChange: (change) =>
      inTurn(async () => {
        if (change.windowId !== (await windows.currentWindowId())) {
          return;
        }
        const id = menuItemId(change.windowId, change.groupId);

        if (change.action === 'createMenuItem') {
          menus.create(
            groupItem(change.windowId, change.groupId, change.groupName),
          );
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
          await menus.update(id, {
            title: `${String(change.groupId)}: ${change.groupName}`,
          });
        }
      }),
  };
}
