import { nativeGroupIdOf } from './groups.js';
import type { Group } from '../ports/group-state.js';

/** A tab of the window, with the group the extension has it in */
export interface VisibilityTab {
  id: number;
  pinned: boolean;
  lastAccessed: number;
  groupId: number | undefined;
}

export interface VisibilityInput {
  activeGroup: number;
  // True when no tab of the window is selected after the switch
  noTabSelected: boolean;
  tabs: readonly VisibilityTab[];
  // The groups whose native tab groups are to be collapsed or expanded; none
  // when native groups are not in use
  groups: readonly Group[];
  canHideTabs: boolean;
}

export type VisibilityPlan =
  | {
      kind: 'abort';
      // How many tabs would have been hidden, with none left to show
      hiddenCount: number;
    }
  | {
      kind: 'apply';
      activate: number | undefined;
      // In the order they are done: collapse, hide; show, expand
      collapse: number[];
      hide: number[];
      show: number[];
      expand: number | undefined;
      updateTitle: boolean;
    };

export type ActiveGroupCheck =
  | { valid: true; activeGroup: number }
  | { valid: false; problem: 'undefined' | 'invalid' };

/**
 * Whether the active group can be switched to, and if not, why not. It is
 * either the view (-1) or a whole number from 0.
 */
export function checkActiveGroup(activeGroup: unknown): ActiveGroupCheck {
  if (activeGroup === undefined) {
    return { valid: false, problem: 'undefined' };
  }
  if (activeGroup === -1) {
    return { valid: true, activeGroup };
  }
  return typeof activeGroup === 'number' &&
    Number.isInteger(activeGroup) &&
    activeGroup >= 0
    ? { valid: true, activeGroup }
    : { valid: false, problem: 'invalid' };
}

/**
 * What to do to switch the window to the active group: show its tabs, hide
 * the others, and keep the native tab groups in step. Pinned tabs stay as
 * they are. If the switch would leave no tab to show, the plan is to do
 * nothing, rather than hide every tab.
 */
export function planVisibility({
  activeGroup,
  noTabSelected,
  tabs,
  groups,
  canHideTabs,
}: VisibilityInput): VisibilityPlan {
  const switching = tabs.filter(({ pinned }) => !pinned);
  const shown = switching.filter(({ groupId }) => groupId === activeGroup);
  const hidden = switching.filter(({ groupId }) => groupId !== activeGroup);

  if (shown.length === 0 && hidden.length > 0) {
    return { kind: 'abort', hiddenCount: hidden.length };
  }

  const mostRecent = shown.reduce<VisibilityTab | undefined>(
    (best, candidate) =>
      best === undefined || candidate.lastAccessed > best.lastAccessed
        ? candidate
        : best,
    undefined,
  );

  return {
    kind: 'apply',
    activate: noTabSelected ? mostRecent?.id : undefined,
    collapse:
      hidden.length > 0
        ? groups
            .filter(({ id }) => id !== activeGroup)
            .flatMap((group) => nativeGroupIdOf(group) ?? [])
        : [],
    hide: canHideTabs ? hidden.map(({ id }) => id) : [],
    show: canHideTabs ? shown.map(({ id }) => id) : [],
    expand:
      shown.length > 0
        ? nativeGroupIdOf(groups.find(({ id }) => id === activeGroup))
        : undefined,
    updateTitle: activeGroup >= 0,
  };
}
