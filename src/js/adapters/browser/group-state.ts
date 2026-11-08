import type { Group, GroupState, Rect } from '../../ports/group-state.js';
import {
  isBoolean,
  isDataVersion,
  isNumber,
  isRecord,
  isString,
} from '../../share/guards.js';

/** The part of `browser.storage.session` that holds the links to native groups */
export interface SessionArea {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, number>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/** The part of `browser.sessions` that holds the per-window and per-tab values */
export interface SessionsApi {
  // Firefox before 115 has none, and no native groups to link to either
  storage?: { session?: SessionArea | undefined } | undefined;
  // Where the values are emulated (Chromium), the way to list and forget them
  sessionsManagement?:
    | {
        windowIds(): Promise<number[]>;
        tabIds(): Promise<number[]>;
        privateWindowIds(): Promise<number[]>;
        privateTabIds(): Promise<number[]>;
        setPrivate(
          windowIds: readonly number[],
          tabIds: readonly number[],
        ): Promise<void>;
        removeWindow(windowId: number): Promise<void>;
        removeTab(tabId: number): Promise<void>;
      }
    | undefined;
  sessions: {
    getWindowValue(windowId: number, key: string): Promise<unknown>;
    setWindowValue(
      windowId: number,
      key: string,
      value: unknown,
    ): Promise<void>;
    getTabValue(tabId: number, key: string): Promise<unknown>;
    setTabValue(tabId: number, key: string, value: unknown): Promise<void>;
    removeTabValue(tabId: number, key: string): Promise<void>;
  };
}

const isOptional =
  <T>(isValid: (value: unknown) => value is T) =>
  (value: unknown): value is T | undefined =>
    value === undefined || isValid(value);

const isOptionalNumber = isOptional(isNumber);
const isOptionalBoolean = isOptional(isBoolean);

function isRect(value: unknown): value is Rect {
  return (
    isRecord(value) &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isNumber(value.w) &&
    isNumber(value.h)
  );
}

/**
 * Whether stored data is a group. Only checks; the object is handed out as it
 * was stored, so fields this version does not know about survive.
 */
export function isGroup(value: unknown): value is Group {
  return (
    isRecord(value) &&
    isNumber(value.id) &&
    isString(value.name) &&
    isOptional(isString)(value.containerId) &&
    isRect(value.rect) &&
    isOptionalNumber(value.windowId) &&
    (value.nativeGroupId === null || isOptionalNumber(value.nativeGroupId)) &&
    isOptionalNumber(value.lastMoved) &&
    isOptionalBoolean(value.isSystemGroup) &&
    isOptionalNumber(value.tabCount)
  );
}

// Older data and other code may have stored a whole number as text
const WHOLE_NUMBER_TEXT = /^-?\d+$/;

const numberOrUndefined = (value: unknown): number | undefined => {
  if (isNumber(value)) {
    return value;
  }
  return isString(value) && WHOLE_NUMBER_TEXT.test(value)
    ? parseInt(value, 10)
    : undefined;
};

// Each link to a native group is a key of its own, so that writing one cannot undo another
const SESSION_KEY_PREFIX = 'nativeGroup';

const linkKey = (windowId: number, groupId: number): string =>
  `${SESSION_KEY_PREFIX}:${String(windowId)}:${String(groupId)}`;

/** A group as it is stored: a link to a native group is kept apart; a `null` stays */
function withoutLink(group: Group): Group {
  const { nativeGroupId, ...rest } = group;
  return nativeGroupId === null ? { ...rest, nativeGroupId } : rest;
}

/**
 * Keeps the extension's per-window and per-tab state in `browser.sessions`,
 * which is cleared when the window or tab goes away, and the links of its
 * groups to the browser's in `browser.storage.session`, which is cleared when
 * the browser closes (the browser's groups have new ids then, in Chromium).
 */
export function createBrowserGroupState(getApi: () => SessionsApi): GroupState {
  const sessions = () => getApi().sessions;
  const linkArea = () => getApi().storage?.session;
  const management = () => getApi().sessionsManagement;

  // The links of the groups of a window that are kept, by group id
  async function linksOf(
    windowId: number,
    groups: readonly Group[],
  ): Promise<Map<number, number>> {
    const area = linkArea();
    const stored =
      area === undefined || groups.length === 0
        ? {}
        : await area.get(groups.map(({ id }) => linkKey(windowId, id)));
    return new Map(
      groups.flatMap(({ id }) => {
        const link = stored[linkKey(windowId, id)];
        return isNumber(link) ? [[id, link] as const] : [];
      }),
    );
  }

  // Forget the links of a window's groups that are no longer among them
  async function dropLinksOfOthers(
    windowId: number,
    groups: readonly Group[],
  ): Promise<void> {
    const area = linkArea();
    if (area === undefined) {
      return;
    }
    const kept = new Set(groups.map(({ id }) => linkKey(windowId, id)));
    const ofWindow = `${SESSION_KEY_PREFIX}:${String(windowId)}:`;
    const gone = Object.keys(await area.get(null)).filter(
      (key) => key.startsWith(ofWindow) && !kept.has(key),
    );
    if (gone.length > 0) {
      await area.remove(gone);
    }
  }

  return {
    async getGroups(windowId) {
      const stored = await sessions().getWindowValue(windowId, 'groups');
      if (!Array.isArray(stored)) {
        return undefined;
      }
      const groups = stored.filter(isGroup).map(withoutLink);
      const links = await linksOf(windowId, groups);
      return groups.map((group) => {
        const link = links.get(group.id);
        return link === undefined ? group : { ...group, nativeGroupId: link };
      });
    },

    // The links of the groups taken away go first, so that a failure to let go of them stores no
    // groups, which a caller that undoes its change relies on. Where the groups then cannot be
    // stored, those taken away stay, without their links (found again at the next start).
    async setGroups(windowId, groups) {
      await dropLinksOfOthers(windowId, groups);
      await sessions().setWindowValue(
        windowId,
        'groups',
        groups.map(withoutLink),
      );
    },

    async setNativeGroupLink(windowId, groupId, nativeGroupId) {
      const area = linkArea();
      if (area === undefined) {
        return;
      }
      const key = linkKey(windowId, groupId);
      await (nativeGroupId === undefined
        ? area.remove([key])
        : area.set({ [key]: nativeGroupId }));
    },

    async getActiveGroup(windowId) {
      return numberOrUndefined(
        await sessions().getWindowValue(windowId, 'activeGroup'),
      );
    },

    async setActiveGroup(windowId, groupId) {
      await sessions().setWindowValue(windowId, 'activeGroup', groupId);
    },

    async getGroupIndex(windowId) {
      return numberOrUndefined(
        await sessions().getWindowValue(windowId, 'groupIndex'),
      );
    },

    async setGroupIndex(windowId, index) {
      await sessions().setWindowValue(windowId, 'groupIndex', index);
    },

    async getTabGroup(tabId) {
      return numberOrUndefined(await sessions().getTabValue(tabId, 'groupId'));
    },

    async setTabGroup(tabId, groupId) {
      await sessions().setTabValue(tabId, 'groupId', groupId);
    },

    async clearTabGroup(tabId) {
      await sessions().removeTabValue(tabId, 'groupId');
    },

    async getSchemaVersion(windowId) {
      const version = numberOrUndefined(
        await sessions().getWindowValue(windowId, 'schemaVersion'),
      );
      return isDataVersion(version) ? version : undefined;
    },

    async setSchemaVersion(windowId, version) {
      await sessions().setWindowValue(windowId, 'schemaVersion', version);
    },

    async listStoredWindowIds() {
      return (await management()?.windowIds()) ?? [];
    },

    async listStoredTabIds() {
      return (await management()?.tabIds()) ?? [];
    },

    async listPrivateWindowIds() {
      return (await management()?.privateWindowIds()) ?? [];
    },

    async listPrivateTabIds() {
      return (await management()?.privateTabIds()) ?? [];
    },

    async setPrivate(windowIds, tabIds) {
      await management()?.setPrivate(windowIds, tabIds);
    },

    async forgetWindow(windowId) {
      await management()?.removeWindow(windowId);
      // Its links go with it: a window of that id has none of its groups
      await dropLinksOfOthers(windowId, []);
    },

    async forgetTab(tabId) {
      await management()?.removeTab(tabId);
    },

    async getClosedAt(windowId) {
      return numberOrUndefined(
        await sessions().getWindowValue(windowId, 'closedAt'),
      );
    },

    async setClosedAt(windowId, at) {
      // A browser that keeps the values with the window has no window to write them to now
      if (management() !== undefined) {
        await sessions().setWindowValue(windowId, 'closedAt', at);
      }
    },
  };
}
