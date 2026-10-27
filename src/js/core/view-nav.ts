/** The tabs of a group of the view, in the order they are shown */
export interface NavGroup {
  groupId: number;
  tabIds: readonly number[];
}

/**
 * The tab to move to from the active one, one step forward (1) or back (-1):
 * the next tab of its group, else the first (or last) tab of the next group
 * that has any, going round from the last group to the first. Nothing if the
 * active tab is in none of the groups.
 */
export function neighbourTabId(
  groups: readonly NavGroup[],
  activeTabId: number,
  direction: 1 | -1,
): number | undefined {
  const here = groups.findIndex(({ tabIds }) => tabIds.includes(activeTabId));
  const current = groups[here];
  if (current === undefined) {
    return undefined;
  }

  const within =
    current.tabIds[current.tabIds.indexOf(activeTabId) + direction];
  if (within !== undefined) {
    return within;
  }

  // The groups after this one, then this one again, going round
  const before = groups.slice(0, here);
  const after = groups.slice(here + 1);
  const order =
    direction === 1
      ? [...after, ...before, current]
      : [...before.reverse(), ...after.reverse(), current];
  const [target] = order.filter(({ tabIds }) => tabIds.length > 0);
  return direction === 1 ? target?.tabIds.at(0) : target?.tabIds.at(-1);
}

/**
 * The tab to make active after a search: the last one whose title has the
 * text in it, whatever its case, or the tab that was active if none has.
 */
export function searchedTabId(
  tabs: readonly { id: number; title: string }[],
  search: string,
  activeTabId: number,
): number {
  const wanted = search.toLowerCase();
  return (
    tabs.filter(({ title }) => title.toLowerCase().includes(wanted)).at(-1)
      ?.id ?? activeTabId
  );
}

/** The theme to show: the one chosen, or for 'auto' the one the system is in */
export function effectiveTheme(
  preference: string,
  systemPrefersDark: boolean,
): string {
  if (preference === 'auto') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return preference;
}

/** The classes that start with the prefix and a dash */
export function classesWithPrefix(
  classes: readonly string[],
  prefix: string,
): string[] {
  return classes.filter((name) => name.startsWith(`${prefix}-`));
}

/**
 * The tab a new tab goes before in its group: the one shown next after it,
 * which is the one with the next higher place in the window. Nothing if it
 * goes last.
 */
export function tabToPutBefore(
  place: number,
  shown: readonly { id: number; index: number }[],
): number | undefined {
  return shown
    .filter(({ index }) => index > place)
    .sort((first, second) => first.index - second.index)
    .at(0)?.id;
}
