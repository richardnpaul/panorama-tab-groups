const GROUP_ITEM = /^(\d+):(-?\d+)$/;

export interface GroupMenuItem {
  readonly windowId: number;
  readonly groupId: number;
}

/**
 * The context-menu item id for a group in a window. Group numbers repeat
 * across windows (each window starts at 0), and `menus` is extension-wide,
 * so the item id carries both.
 */
export function menuItemId(windowId: number, groupId: number): string {
  return `${String(windowId)}:${String(groupId)}`;
}

/**
 * The window and group a context-menu item stands for. Action items have
 * word ids (`refresh-groups`, `send-tab`) and no group.
 */
export function groupOfMenuItem(
  itemId: string | number,
): GroupMenuItem | undefined {
  const match = GROUP_ITEM.exec(String(itemId));
  return match
    ? { windowId: Number(match[1]), groupId: Number(match[2]) }
    : undefined;
}

/**
 * The tab to show when the active tab is sent away: the one before it among
 * the visible tabs, else the one after it, else the tab itself.
 */
export function neighbourOf(
  tabId: number,
  visibleTabIds: readonly number[],
): number {
  const position = visibleTabIds.indexOf(tabId);
  const others = visibleTabIds.filter((id) => id !== tabId);
  return others[position - 1] ?? others[position] ?? tabId;
}
