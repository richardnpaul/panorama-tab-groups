import type { Clock } from '../ports/clock.js';
import type { Group, GroupState, Rect } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { Messaging } from '../ports/messaging.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import { nativeGroupIdOf } from '../core/groups.js';
import type { MenuChange } from '../core/messages.js';
import { moveGroupTo } from '../core/popup.js';
import { isRecord, isString } from '../share/guards.js';

export interface GroupsStoreDeps {
  groupState: GroupState;
  messaging: Messaging;
  // The title of a group's native group goes with its name, or the browser's next report of the
  // native group would give the group its old name back
  nativeGroups: Pick<NativeGroups, 'setTitle'>;
  tabs: Pick<Tabs, 'listIdsInCurrentWindow'>;
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
  /**
   * Have the background delete the group, with its tabs; whether it was deleted: not for a group
   * it does not have, nor when the background did not delete it (which is logged)
   */
  remove(id: number): Promise<boolean>;
  rename(id: number, newName: string): Promise<void>;
  transform(id: number, rect: Rect): Promise<void>;
  /** Put the group in the gap of the list it was dropped in (0 is before the first) */
  moveTo(id: number, gap: number): Promise<void>;
  getActive(): Promise<number | undefined>;
  setActive(id: number): Promise<void>;
}

function deleteFailureReason(response: unknown): string {
  return isRecord(response) && isString(response.error) && response.error !== ''
    ? response.error
    : 'No response';
}

export async function createGroupsStore(
  {
    groupState,
    messaging,
    nativeGroups,
    tabs,
    clock,
    i18n,
    logger,
  }: GroupsStoreDeps,
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

  // The groups the background stored that the page does not have, as the new first group it
  // makes when the last is deleted, are the page's too. Only those: a move of the page's own not
  // yet stored stays. The group is deleted whether they can be read or not.
  async function takeInNew(deleted: number): Promise<void> {
    try {
      ((await groupState.getGroups(windowId)) ?? [])
        .filter(({ id }) => id >= 0 && id !== deleted && get(id) === null)
        .forEach((group) => {
          group.tabCount = 0;
          groups.push(group);
        });
    } catch (error) {
      logger.error(
        `Could not read the groups of window ${String(windowId)} after group ${String(deleted)} was deleted:`,
        error,
      );
    }
  }

  // The changes take turns: each stores the groups as the one before left them, so a change
  // stored while a rename is still being stored does not store the old name over the new one.
  // One that fails is passed to its caller, and the next goes on.
  let turn: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(change: () => Promise<T>): Promise<T> => {
    const done = turn.then(change);
    turn = done.catch(() => undefined);
    return done;
  };

  // The link the background has stored for a group now: the copy loaded with the view has none
  // for a native group made after it
  const linkOf = async (id: number): Promise<number | undefined> =>
    nativeGroupIdOf(
      (await groupState.getGroups(windowId))?.find((group) => group.id === id),
    );

  // The menu is updated by the background; the view does not wait for it
  const updateMenu = (message: MenuChange): void => {
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

    create: () =>
      inTurn(async () => {
        const id = await nextId();
        const group: Group = {
          id,
          name: `${i18n.getMessage('defaultGroupName')}${String(id)}`,
          windowId,
          rect: { x: 0, y: 0, w: 0.2, h: 0.2 },
          lastMoved: clock.now(),
        };
        // Stored first, as a rename is: a group that cannot be stored is not made
        await groupState.setGroups(windowId, [...groups, group]);
        groups.push(group);
        updateMenu({
          action: 'createMenuItem',
          windowId,
          groupId: id,
          groupName: group.name,
        });
        return group;
      }),

    remove: (id) =>
      inTurn(async () => {
        const group = get(id);
        if (group === null) {
          return false;
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
          nativeGroupId: await linkOf(id),
          tabIds: tabIds.filter(
            (_tabId, position) => tabGroups[position] === id,
          ),
        });

        if (!isRecord(response) || response.success !== true) {
          logger.error(
            `Failed to delete group ${String(id)}:`,
            deleteFailureReason(response),
          );
          return false;
        }

        groups.splice(groups.indexOf(group), 1);
        await takeInNew(id);
        return true;
      }),

    // Nothing changes until the new name is stored, and a rename that fails leaves everything
    // as it was: the native group gets its title back
    rename: (id, newName) =>
      inTurn(async () => {
        const group = get(id);
        if (group === null) {
          return;
        }
        const nativeGroupId = await linkOf(id);
        // Before the name is stored: a report of the native group read after it has the new title
        const titled =
          nativeGroupId !== undefined &&
          (await nativeGroups.setTitle(nativeGroupId, newName).then(
            () => true,
            (error: unknown) => {
              logger.error(
                `Could not give native group ${String(nativeGroupId)} the new name of group ${String(id)}:`,
                error,
              );
              return false;
            },
          ));
        try {
          await groupState.setGroups(
            windowId,
            groups.map((each) =>
              each.id === id ? { ...each, name: newName } : each,
            ),
          );
        } catch (error) {
          if (titled) {
            await nativeGroups
              .setTitle(nativeGroupId, group.name)
              .catch((titleError: unknown) => {
                logger.error(
                  `Could not give native group ${String(nativeGroupId)} back the name of group ${String(id)}:`,
                  titleError,
                );
              });
          }
          throw error;
        }
        group.name = newName;
        updateMenu({
          action: 'updateMenuItem',
          windowId,
          groupId: id,
          groupName: newName,
        });
      }),

    // A move is the view's own at once, as it draws from it; only storing it waits its turn,
    // and stores the groups as the changes before it left them
    transform(id, rect) {
      const group = get(id);
      if (group === null) {
        return Promise.resolve();
      }
      group.rect = rect;
      group.lastMoved = clock.now();
      return inTurn(save);
    },

    moveTo(id, gap) {
      if (get(id) === null) {
        return Promise.resolve();
      }
      const order = moveGroupTo(
        groups.map((group) => group.id),
        id,
        gap,
      );
      groups.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      return inTurn(save);
    },

    getActive: () => groupState.getActiveGroup(windowId),
    setActive: (id) => groupState.setActiveGroup(windowId, id),
  };
}
