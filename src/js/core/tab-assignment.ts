import { getLowestPositiveGroupId } from './utils.js';

/** The Panorama view tab the extension has just asked the browser to open */
export interface OpeningView {
  // Not known until the browser has opened the tab
  tabId: number | null;
  windowId: number;
  /** Milliseconds since the epoch */
  creationTimestamp: number;
}

/**
 * How long after asking for the view tab any new tab in its window counts as
 * it: the browser may announce the tab before its address is known.
 */
export const VIEW_TAB_WINDOW_MS = 100;

/**
 * Whether a newly created tab is the Panorama view tab: it is the one that was
 * asked for, it appeared in that window just after, or it shows the view page.
 */
export function isPanoramaViewTab({
  tab,
  viewUrl,
  opening,
  now,
}: {
  tab: {
    id: number;
    windowId: number;
    url?: string | undefined;
    pendingUrl?: string | undefined;
  };
  viewUrl: string;
  opening: OpeningView | null;
  now: number;
}): boolean {
  if (tab.url === viewUrl || tab.pendingUrl === viewUrl) {
    return true;
  }
  return (
    opening !== null &&
    (opening.tabId === tab.id ||
      (opening.windowId === tab.windowId &&
        now - opening.creationTimestamp < VIEW_TAB_WINDOW_MS))
  );
}

/**
 * The group to put tabs in when a window has no active group yet: the lowest
 * numbered one, or the first ever group if there are none.
 */
export function fallbackActiveGroup(
  groups: readonly { id: unknown }[] | undefined,
): number {
  return getLowestPositiveGroupId(groups) ?? 0;
}
