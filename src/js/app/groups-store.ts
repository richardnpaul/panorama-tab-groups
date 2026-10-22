import type { Clock } from '../ports/clock.js';
import type { Group, GroupState, Rect } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { Messaging } from '../ports/messaging.js';
import type { Tabs } from '../ports/tabs.js';
import { isRecord, isString } from '../share/guards.js';

export interface GroupsStoreDeps {
  groupState: GroupState;
  messaging: Messaging;
  tabs: Tabs;
  clock: Clock;
  i18n: I18n;
  logger: Pick<Logger, 'error'>;
}

/** The groups of one window, as the view shows and edits them */
export interface GroupsStore {
  getLength(): number;
  getIds(): number[];
  get(id: number): Group | null;
  getName(id: number): string | undefined;
  forEach(callback: (group: Group) => void): void;
  create(): Promise<Group>;
  remove(id: number): Promise<void>;
  rename(id: number, newName: string): Promise<void>;
  transform(id: number, rect: Rect): Promise<void>;
  getActive(): Promise<number | undefined>;
  setActive(id: number): Promise<void>;
}

function deleteFailureReason(response: unknown): string {
  return isRecord(response) && isString(response.error) && response.error !== ''
    ? response.error
    : 'No response';
}

export async function createGroupsStore(
  { groupState, messaging, tabs, clock, i18n, logger }: GroupsStoreDeps,
  windowId: number,
): Promise<GroupsStore> {
  // The system groups (negative ids) are the background's business, not the view's
  const groups =
    (await groupState.getGroups(windowId))?.filter(({ id }) => id >= 0) ?? [];
  groups.forEach((group) => {
    group.tabCount = 0;
  });

  const get = (id: number): Group | null =>
    groups.find((group) => group.id === id) ?? null;

  const save = (): Promise<void> => groupState.setGroups(windowId, groups);

  // The menu is updated by the background; the view does not wait for it
  const updateMenu = (message: object): void => {
    messaging.send(message).catch((error: unknown) => {
      logger.error('Failed to update the menu:', error);
    });
  };

  const nextId = async (): Promise<number> => {
    const id = (await groupState.getGroupIndex(windowId)) ?? 0;
    await groupState.setGroupIndex(windowId, id + 1);
    return id;
  };

  return {
    getLength: () => groups.length,
    getIds: () => groups.map(({ id }) => id),
    get,
    getName: (id) => get(id)?.name,
    forEach: (callback) => {
      groups.forEach((group) => {
        callback(group);
      });
    },

    async create() {
      const id = await nextId();
      const group: Group = {
        id,
        name: `${i18n.getMessage('defaultGroupName')}${String(id)}`,
        windowId,
        containerId: 'firefox-default',
        rect: { x: 0, y: 0, w: 0.2, h: 0.2 },
        lastMoved: clock.now(),
      };
      groups.push(group);
      updateMenu({
        action: 'createMenuItem',
        groupId: id.toString(),
        groupName: group.name,
      });
      await save();
      return group;
    },

    async remove(id) {
      const group = get(id);
      if (group === null) {
        return;
      }

      const tabIds = await tabs.listIdsInCurrentWindow();
      const tabGroups = await Promise.all(
        tabIds.map((tabId) => groupState.getTabGroup(tabId)),
      );

      // The background does the whole clean-up, including the native group
      const response = await messaging.send({
        action: 'deleteGroup',
        groupId: id,
        windowId,
        nativeGroupId: group.nativeGroupId,
        tabIds: tabIds.filter((_tabId, position) => tabGroups[position] === id),
      });

      if (!isRecord(response) || response.success !== true) {
        logger.error(
          `Failed to delete group ${String(id)}:`,
          deleteFailureReason(response),
        );
        return;
      }

      groups.splice(groups.indexOf(group), 1);
    },

    async rename(id, newName) {
      const group = get(id);
      if (group === null) {
        return;
      }
      group.name = newName;
      updateMenu({
        action: 'updateMenuItem',
        groupId: id.toString(),
        groupName: newName,
      });
      await save();
    },

    async transform(id, rect) {
      const group = get(id);
      if (group === null) {
        return;
      }
      group.rect = rect;
      group.lastMoved = clock.now();
      await save();
    },

    getActive: () => groupState.getActiveGroup(windowId),
    setActive: (id) => groupState.setActiveGroup(windowId, id),
  };
}
