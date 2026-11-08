import type { Group, GroupState } from '../../src/js/ports/group-state.js';

/**
 * Store a window's groups as the add-on has them: the groups, then the link of each that has a
 * native group, which a GroupState keeps apart from them.
 */
export async function storeGroups(
  groupState: Pick<GroupState, 'setGroups' | 'setNativeGroupLink'>,
  windowId: number,
  groups: readonly Group[],
): Promise<void> {
  await groupState.setGroups(windowId, groups);
  await Promise.all(
    groups.flatMap(({ id, nativeGroupId }) =>
      typeof nativeGroupId === 'number'
        ? [groupState.setNativeGroupLink(windowId, id, nativeGroupId)]
        : [],
    ),
  );
}
