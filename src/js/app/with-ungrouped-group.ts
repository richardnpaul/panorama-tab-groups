import { ensureUngroupedGroup } from '../core/groups.js';
import type { Clock } from '../ports/clock.js';
import type { GroupState } from '../ports/group-state.js';

/**
 * A GroupState that always stores a window's groups together with the system
 * group for ungrouped tabs. Everything else is the state it wraps.
 */
export function withUngroupedGroup(
  inner: GroupState,
  clock: Clock,
): GroupState {
  return {
    ...inner,
    setGroups: (windowId, groups) =>
      inner.setGroups(windowId, ensureUngroupedGroup(groups, clock.now())),
  };
}
