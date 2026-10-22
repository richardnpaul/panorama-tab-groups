import { createBrowserGroupState } from '../adapters/browser/group-state.js';
import { systemClock } from '../adapters/system/clock.js';
import { withUngroupedGroup } from '../app/with-ungrouped-group.js';
import type { GroupState } from '../ports/group-state.js';

/**
 * The group state the background and view code share: the browser's session
 * storage, with the group for ungrouped tabs always kept.
 */
interface StateManager extends Omit<GroupState, 'setTabGroup'> {
  // The background still passes the id of a clicked menu item, which is a string
  setTabGroup(tabId: number, groupId: number | string): Promise<void>;
}

const groupState = withUngroupedGroup(
  createBrowserGroupState(() => browser),
  systemClock,
);

export const stateManager: StateManager = {
  ...groupState,
  setTabGroup: (tabId, groupId) =>
    groupState.setTabGroup(tabId, parseInt(String(groupId), 10)),
};
