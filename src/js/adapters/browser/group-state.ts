import type { Group, GroupState, Rect } from '../../ports/group-state.js';
import { isBoolean, isNumber, isRecord, isString } from '../../share/guards.js';

/** The part of `browser.sessions` that holds the per-window and per-tab values */
export interface SessionsApi {
  sessions: {
    getWindowValue(windowId: number, key: string): Promise<unknown>;
    setWindowValue(
      windowId: number,
      key: string,
      value: unknown,
    ): Promise<void>;
    getTabValue(tabId: number, key: string): Promise<unknown>;
    setTabValue(tabId: number, key: string, value: unknown): Promise<void>;
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
    isString(value.containerId) &&
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

/**
 * Keeps the extension's per-window and per-tab state in `browser.sessions`,
 * which is cleared when the window or tab goes away.
 */
export function createBrowserGroupState(getApi: () => SessionsApi): GroupState {
  const sessions = () => getApi().sessions;

  return {
    async getGroups(windowId) {
      const stored = await sessions().getWindowValue(windowId, 'groups');
      return Array.isArray(stored) ? stored.filter(isGroup) : undefined;
    },

    async setGroups(windowId, groups) {
      await sessions().setWindowValue(windowId, 'groups', groups);
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
  };
}
