import type { Group } from '../ports/group-state.js';
import {
  isValidUserGroupId,
  UNGROUPED_GROUP_ID,
  UNGROUPED_GROUP_NAME,
} from './constants.js';
import { mod } from './utils.js';

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

/** A group counts as having a native group only for a real (non-zero) id */
export function nativeGroupIdOf(group: Group | undefined): number | undefined {
  const id = group?.nativeGroupId;
  return typeof id === 'number' && id !== 0 ? id : undefined;
}

/**
 * The group a step of `direction` (1 for next, -1 for previous) from the
 * active one, wrapping round. Only the groups of the user count, not the
 * system groups. When the active group is not one of them, the next group is
 * the first and the previous the last.
 */
export function groupBeside(
  groups: readonly Group[],
  activeGroup: number | undefined,
  direction: 1 | -1,
): Group | undefined {
  const switchable = groups.filter(({ id }) => isValidUserGroupId(id));
  const position = switchable.findIndex(({ id }) => id === activeGroup);
  const from = position === -1 && direction === -1 ? 0 : position;
  return switchable.at(mod(from + direction, switchable.length));
}
