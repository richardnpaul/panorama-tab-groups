import type { Clock } from '../ports/clock.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { Windows } from '../ports/windows.js';
import type { ToolbarService } from './toolbar-service.js';

export interface WindowGroupsDeps {
  groupState: Pick<
    GroupState,
    | 'getGroups'
    | 'setGroups'
    | 'getGroupIndex'
    | 'setGroupIndex'
    | 'setActiveGroup'
  >;
  windows: Pick<Windows, 'listIds'>;
  i18n: I18n;
  clock: Clock;
  toolbar: Pick<ToolbarService, 'showNoActiveGroup'>;
  // Settles once the extension has finished starting up
  waitForInitialization: () => Promise<void>;
  // Whether a backup is being opened, which brings its own groups
  isOpeningBackup: () => boolean;
  logger: Pick<Logger, 'debug'>;
}

export interface WindowGroups {
  /**
   * Give a window its first group, and make it the active one. This handles
   * new windows, existing windows at installation, and a window whose last
   * group was deleted.
   */
  createGroupInWindow: (windowId: number) => Promise<void>;
  /**
   * Do that only for a window that has no group, so a window the user
   * restores keeps the groups it had, and show that it has no active group
   * yet.
   */
  createGroupInWindowIfMissing: (windowId: number) => Promise<void>;
  /** Make sure each window has a group */
  setupWindows: () => Promise<void>;
}

export function createWindowGroups({
  groupState,
  windows,
  i18n,
  clock,
  toolbar,
  waitForInitialization,
  isOpeningBackup,
  logger,
}: WindowGroupsDeps): WindowGroups {
  // The number the next group of the window gets
  async function newGroupUid(windowId: number): Promise<number> {
    const uid = (await groupState.getGroupIndex(windowId)) ?? 0;
    await groupState.setGroupIndex(windowId, uid + 1);
    return uid;
  }

  async function createGroupInWindow(windowId: number): Promise<void> {
    if (isOpeningBackup()) {
      logger.debug('Skipping creation of groups since we are opening backup');
      return;
    }

    const groupId = await newGroupUid(windowId);
    // The native group is made later, when tabs are assigned to the group
    const group: Group = {
      id: groupId,
      name: `${i18n.getMessage('defaultGroupName')}${String(groupId)}`,
      containerId: 'browser-default',
      nativeGroupId: null,
      rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      lastMoved: clock.now(),
    };

    // The group for ungrouped tabs is added too, but is never the active one
    await groupState.setGroups(windowId, [group]);
    await groupState.setActiveGroup(windowId, groupId);
  }

  async function createGroupInWindowIfMissing(windowId: number): Promise<void> {
    await waitForInitialization();

    const groups = await groupState.getGroups(windowId);
    if (groups === undefined || groups.length === 0) {
      logger.debug(`No groups found for window ${String(windowId)}!`);
      await createGroupInWindow(windowId);
    }
    await toolbar.showNoActiveGroup(windowId);
  }

  return {
    createGroupInWindow,
    createGroupInWindowIfMissing,
    async setupWindows() {
      const windowIds = await windows.listIds();
      await Promise.all(windowIds.map(createGroupInWindowIfMissing));
    },
  };
}
