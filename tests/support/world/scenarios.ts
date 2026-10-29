import type { Group } from '../../../src/js/ports/group-state.js';
import type { SeenTab, SeenWindow, World } from './world.js';

/**
 * Give a window groups of its own, as the user has made them: the tab at each place of
 * `tabIds` is in the group at the same place of `assignments`, and one group is active.
 */
export async function arrangeGroups(
  world: World,
  windowId: number,
  tabIds: readonly number[],
  assignments: readonly number[],
  active = 1,
): Promise<void> {
  const ids = [...new Set(assignments)];
  const made: Group[] = ids.map((id) => ({
    id,
    name: `G${String(id)}`,
    containerId: 'firefox-default',
    rect: { x: 0, y: 0, w: 0.3, h: 0.3 },
  }));
  await world.groupState.setGroups(windowId, made);
  await Promise.all(
    tabIds.map((tabId, place) =>
      world.groupState.setTabGroup(tabId, assignments[place] ?? 0),
    ),
  );
  await world.groupState.setActiveGroup(windowId, active);
}

/** Which window each tab is in */
export async function windowOfEachTab(
  world: World,
): Promise<Map<number, number>> {
  return new Map(
    (await world.windows()).flatMap((window) =>
      window.tabs.map((tab) => [tab.id, window.id] as const),
    ),
  );
}

/** The tabs that are in another window than they were: what must never be */
export async function tabsThatMoved(
  world: World,
  before: ReadonlyMap<number, number>,
): Promise<string[]> {
  const after = await windowOfEachTab(world);
  return [...before]
    .filter(([tabId, windowId]) => after.get(tabId) !== windowId)
    .map(([tabId]) => `tab ${String(tabId)}`);
}

/** The tabs of the window that are in the group of the add-on, in order */
export const tabsInGroup = (window: SeenWindow, group: number): SeenTab[] =>
  window.tabs.filter((tab) => tab.group === group);

/** The ids of the native groups the tabs are in, once each, without "none" */
export const nativeGroupsOf = (tabs: readonly SeenTab[]): number[] => [
  ...new Set(
    tabs.flatMap(({ nativeGroupId }) =>
      nativeGroupId === -1 ? [] : [nativeGroupId],
    ),
  ),
];

/** The native group each group of the add-on refers to, in the order of its groups, `undefined` for none */
export async function referencesOf(
  world: World,
  windowId: number,
): Promise<(number | null | undefined)[]> {
  return (await world.groupsOf(windowId))
    .filter(({ id }) => id >= 0)
    .map(({ nativeGroupId }) => nativeGroupId);
}
