import type { Group } from '../ports/group-state.js';
import { UNGROUPED_GROUP_ID, UNGROUPED_GROUP_NAME } from './constants.js';

/**
 * The groups with the system group for ungrouped tabs guaranteed to be there:
 * added if missing, and with its fixed fields restored if it exists. The given
 * list is not changed.
 */
export function ensureUngroupedGroup(
  groups: readonly Group[] | null | undefined,
  now: number,
): Group[] {
  const existing = groups ?? [];
  const index = existing.findIndex(({ id }) => id === UNGROUPED_GROUP_ID);

  if (index === -1) {
    return [
      ...existing,
      {
        id: UNGROUPED_GROUP_ID,
        name: UNGROUPED_GROUP_NAME,
        containerId: 'browser-default',
        nativeGroupId: null, // Never has a native group
        rect: { x: 0, y: 0, w: 0, h: 0 }, // No position in the grid
        lastMoved: now,
        isSystemGroup: true,
      },
    ];
  }

  return existing.map((group, position) =>
    position === index
      ? {
          ...group,
          name: UNGROUPED_GROUP_NAME,
          isSystemGroup: true,
          nativeGroupId: null,
        }
      : group,
  );
}
