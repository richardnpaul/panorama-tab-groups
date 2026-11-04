import {
  isReservedGroupId,
  UNGROUPED_GROUP_ID,
  VIEWER_GROUP_ID,
} from '../core/constants.js';
import { fallbackActiveGroup } from '../core/tab-assignment.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';

export interface WindowRebuildDeps {
  /** Where the browser does not keep the add-on's values with their window and tab (Chromium) */
  enabled: boolean;
  /** The groups of the windows that are open, where the rebuilt ones are stored */
  groupState: Pick<
    GroupState,
    | 'getGroups'
    | 'getGroupIndex'
    | 'setGroups'
    | 'setActiveGroup'
    | 'setGroupIndex'
    | 'setTabGroup'
    | 'clearTabGroup'
    | 'setNativeGroupLink'
  >;
  /** What was kept of the windows that closed, read as it was stored */
  archive: Pick<
    GroupState,
    | 'getGroups'
    | 'getActiveGroup'
    | 'getGroupIndex'
    | 'getClosedAt'
    | 'listStoredWindowIds'
    | 'forgetWindow'
  >;
  // A private window is given groups from its native groups alone: what was kept is of windows
  // that were not private, and is not given to one that is
  windows: Pick<Windows, 'listIds' | 'listNonPrivateIds'>;
  tabs: Pick<Tabs, 'listInWindow'>;
  nativeGroups: Pick<NativeGroups, 'listIdsInWindow' | 'tabIdsIn' | 'get'>;
  // For the title of a group that has no name
  i18n: Pick<I18n, 'getMessage'>;
  // The address of the view page
  viewUrl: string;
  logger: Pick<Logger, 'debug' | 'warn'>;
}

export interface WindowRebuild {
  /**
   * Start-up: every window that has native groups and none of the add-on's gets its groups
   * from them, and from what was kept of the windows that were open before. Windows are
   * paired with what was kept all at once, as two windows can fit the same entry.
   */
  rebuildAll: () => Promise<void>;
  /**
   * A window opened: the same for it alone. Gives whether it got its groups, which it does not
   * where it has no native groups, or where nothing that was kept fits.
   */
  rebuildWindow: (windowId: number) => Promise<boolean>;
}

interface Native {
  id: number;
  title: string;
  collapsed: boolean;
  tabIds: number[];
}

/** A window that has native groups and none of the add-on's */
interface Restored {
  windowId: number;
  natives: Native[];
}

/** What was kept of a window that closed */
interface Closed {
  windowId: number;
  groups: Group[];
  activeGroup: number | undefined;
  groupIndex: number | undefined;
  closedAt: number;
}

/** How well an entry fits a window: with fewer groups left over (none, when the titles are all of the names), and with the shown group the open one */
interface Fit {
  restored: Restored;
  closed: Closed;
  leftOver: number;
  active: boolean;
}

const DEFAULT_RECT = { x: 0, y: 0, w: 0.5, h: 0.5 };

export function createWindowRebuild({
  enabled,
  groupState,
  archive,
  windows,
  tabs,
  nativeGroups,
  i18n,
  viewUrl,
  logger,
}: WindowRebuildDeps): WindowRebuild {
  // What a native group is called, as `createNativeGroup` makes it: a group with no name by its number
  const titleOf = (group: Group): string =>
    group.name === ''
      ? `${i18n.getMessage('defaultGroupName')}${String(group.id)}`
      : group.name;

  async function nativesOf(windowId: number): Promise<Native[]> {
    const ids = await nativeGroups.listIdsInWindow(windowId);
    return Promise.all(
      ids.map(async (id) => {
        const { title, collapsed } = await nativeGroups.get(id);
        return {
          id,
          title: title ?? '',
          collapsed,
          tabIds: await nativeGroups.tabIdsIn(id),
        };
      }),
    );
  }

  // The windows among these that have native groups and no group of the add-on's
  async function restoredAmong(
    windowIds: readonly number[],
  ): Promise<Restored[]> {
    const found = await Promise.all(
      windowIds.map(async (windowId): Promise<Restored[]> => {
        const groups = (await groupState.getGroups(windowId)) ?? [];
        if (groups.some(({ id }) => !isReservedGroupId(id))) {
          return [];
        }
        const natives = await nativesOf(windowId);
        return natives.length === 0 ? [] : [{ windowId, natives }];
      }),
    );
    return found.flat();
  }

  async function closedWindows(): Promise<Closed[]> {
    // What was kept is read before what is open: a window that opens in between is not taken for
    // one that closed
    const kept = await archive.listStoredWindowIds();
    const open = new Set(await windows.listIds());
    const stored = kept.filter((id) => !open.has(id));
    return Promise.all(
      stored.map(async (windowId) => ({
        windowId,
        // Only the user's groups: the group for ungrouped tabs is made again
        groups: ((await archive.getGroups(windowId)) ?? []).filter(
          ({ id }) => !isReservedGroupId(id),
        ),
        activeGroup: await archive.getActiveGroup(windowId),
        groupIndex: await archive.getGroupIndex(windowId),
        // A window that was still open when the browser quit has no closing time, and comes ahead
        // of one that had already closed
        closedAt:
          (await archive.getClosedAt(windowId)) ?? Number.MAX_SAFE_INTEGER,
      })),
    );
  }

  // Every title of the native groups is the name of a group that was kept
  function fitOf(restored: Restored, closed: Closed): Fit | undefined {
    const names = new Set(closed.groups.map(titleOf));
    const titles = new Set(restored.natives.map(({ title }) => title));
    if (![...titles].every((title) => names.has(title))) {
      return undefined;
    }
    const open = restored.natives.filter(({ collapsed }) => !collapsed);
    const shown = closed.groups.find(({ id }) => id === closed.activeGroup);
    return {
      restored,
      closed,
      leftOver: names.size - titles.size,
      active:
        open.length === 1 &&
        shown !== undefined &&
        open[0]?.title === titleOf(shown),
    };
  }

  const better = (first: Fit, second: Fit): number =>
    first.leftOver - second.leftOver ||
    Number(second.active) - Number(first.active) ||
    second.closed.closedAt - first.closed.closedAt ||
    first.closed.windowId - second.closed.windowId ||
    first.restored.windowId - second.restored.windowId;

  /** Each restored window with the entry it is paired with, best fits first, each used once */
  function pairs(restored: Restored[], closed: Closed[]): Map<number, Closed> {
    const fits = restored
      .flatMap((window) => closed.map((entry) => fitOf(window, entry)))
      .flatMap((fit) => fit ?? [])
      .sort(better);
    const paired = new Map<number, Closed>();
    const taken = new Set<number>();
    fits.forEach(({ restored: window, closed: entry }) => {
      if (!paired.has(window.windowId) && !taken.has(entry.windowId)) {
        paired.set(window.windowId, entry);
        taken.add(entry.windowId);
      }
    });
    return paired;
  }

  async function apply(restored: Restored, closed: Closed | undefined) {
    const { windowId, natives } = restored;
    const kept = closed?.groups ?? [];
    // A title that two groups share is no way to tell them apart
    const claimed = new Set<number>();
    const matched = natives.map((native): Group | undefined => {
      const named = kept.filter((group) => titleOf(group) === native.title);
      const [only] = named;
      if (named.length !== 1 || only === undefined || claimed.has(only.id)) {
        return undefined;
      }
      claimed.add(only.id);
      return only;
    });

    const first = Math.max(
      closed?.groupIndex ?? (await groupState.getGroupIndex(windowId)) ?? 0,
      ...kept.map(({ id }) => id + 1),
    );
    const made = natives.flatMap((native, at) =>
      matched[at] === undefined ? [native] : [],
    );
    const added: Group[] = made.map((native, at) => {
      const id = first + at;
      return {
        id,
        name:
          native.title === ''
            ? `${i18n.getMessage('defaultGroupName')}${String(id)}`
            : native.title,
        rect: DEFAULT_RECT,
      };
    });
    const groupOf = new Map<number, number>();
    natives.forEach((native, at) => {
      const own = matched[at];
      if (own !== undefined) {
        groupOf.set(native.id, own.id);
      }
    });
    made.forEach((native, at) => {
      groupOf.set(native.id, first + at);
    });

    // The groups are stored last of the values that go with them, and what was kept is let go of
    // after them: a window that fails on the way has no group of the user's, so it is tried again
    // as a window with none, and what was kept is still there
    // Each tab follows its native group; a tab in none is ungrouped, and a pinned one has no group
    await Promise.all(
      (await tabs.listInWindow(windowId)).map(async (tab) => {
        if (tab.pinned) {
          await groupState.clearTabGroup(tab.id);
          return;
        }
        const native = natives.find(({ tabIds }) => tabIds.includes(tab.id));
        const own = native === undefined ? undefined : groupOf.get(native.id);
        const url = tab.url ?? tab.pendingUrl;
        await groupState.setTabGroup(
          tab.id,
          url === viewUrl ? VIEWER_GROUP_ID : (own ?? UNGROUPED_GROUP_ID),
        );
      }),
    );

    // The group that is open is the one shown; failing that, the one that was
    const open = natives.filter(({ collapsed }) => !collapsed);
    const [only] = open;
    const shown =
      open.length === 1 && only !== undefined
        ? groupOf.get(only.id)
        : closed?.activeGroup;
    const all = [...kept, ...added];
    await groupState.setGroupIndex(windowId, first + added.length);
    await groupState.setActiveGroup(
      windowId,
      shown !== undefined && all.some(({ id }) => id === shown)
        ? shown
        : fallbackActiveGroup(all),
    );
    await groupState.setGroups(windowId, all);
    await Promise.all(
      [...groupOf].map(([nativeId, groupId]) =>
        groupState.setNativeGroupLink(windowId, groupId, nativeId),
      ),
    );

    if (closed !== undefined) {
      await archive.forgetWindow(closed.windowId);
    }
    logger.debug(
      `[Rebuild] Window ${String(windowId)}: ${String(natives.length)} native groups, ${closed === undefined ? 'no window kept to go with them' : `groups of window ${String(closed.windowId)} kept`}`,
    );
  }

  async function rebuild(windowIds: readonly number[]): Promise<Set<number>> {
    const restored = await restoredAmong(windowIds);
    if (restored.length === 0) {
      return new Set();
    }
    const notPrivate = new Set(await windows.listNonPrivateIds());
    const paired = pairs(
      restored.filter(({ windowId }) => notPrivate.has(windowId)),
      await closedWindows(),
    );
    // One after the other: each writes the groups of its window whole. One that fails is logged,
    // and the others go on; it counts as rebuilt only if it has groups of the user's by the end
    const rebuilt = new Set<number>();
    await restored.reduce(async (done, window) => {
      await done;
      try {
        await apply(window, paired.get(window.windowId));
      } catch (error) {
        logger.warn(
          `[Rebuild] Window ${String(window.windowId)} could not be rebuilt:`,
          error,
        );
      }
      const groups = (await groupState.getGroups(window.windowId)) ?? [];
      if (groups.some(({ id }) => !isReservedGroupId(id))) {
        rebuilt.add(window.windowId);
      }
    }, Promise.resolve());
    return rebuilt;
  }

  return {
    async rebuildAll() {
      if (!enabled) {
        return;
      }
      try {
        await rebuild(await windows.listIds());
      } catch (error) {
        logger.warn('[Rebuild] The groups could not be rebuilt:', error);
      }
    },

    async rebuildWindow(windowId) {
      if (!enabled) {
        return false;
      }
      try {
        return (await rebuild([windowId])).has(windowId);
      } catch (error) {
        logger.warn(
          `[Rebuild] The groups of window ${String(windowId)} could not be rebuilt:`,
          error,
        );
        return false;
      }
    },
  };
}
