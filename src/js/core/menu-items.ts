import { isNumber, isString } from '../share/guards.js';

const WHOLE_NUMBER = /^-?\d+$/;

/**
 * The group a context menu item stands for. The ids of the items that send a
 * tab to a group are the number of the group, as text; the other items have
 * ids that are words, and no group.
 */
export function groupIdOfMenuItem(menuItemId: unknown): number | undefined {
  if (isNumber(menuItemId)) {
    return Number.isInteger(menuItemId) ? menuItemId : undefined;
  }
  return isString(menuItemId) && WHOLE_NUMBER.test(menuItemId)
    ? Number(menuItemId)
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
