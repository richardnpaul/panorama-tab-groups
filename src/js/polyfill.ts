import {
  retryWithoutWindowId,
  type BadgeTextDetails,
  type TitleDetails,
} from './adapters/browser/action-compat.js';
import { createExclusively, type Locks } from './adapters/browser/exclusive.js';
import {
  createSessionsEmulation,
  type IsPrivate,
  type SessionsEmulation,
  type StorageArea,
} from './adapters/browser/sessions-emulation.js';

/** The `browser.sessions` values; a browser may lack any of them */
interface PolyfillSessions {
  getTabValue?: (tabId: number, key: string) => Promise<unknown>;
  setTabValue?: (
    tabId: number,
    key: string,
    value: string | object,
  ) => Promise<void>;
  removeTabValue?: (tabId: number, key: string) => Promise<void>;
  getWindowValue?: (windowId: number, key: string) => Promise<unknown>;
  setWindowValue?: (
    windowId: number,
    key: string,
    value: string | object,
  ) => Promise<void>;
  removeWindowValue?: (windowId: number, key: string) => Promise<void>;
}

/** What only the emulation can do: list and forget what it keeps, which a browser's own values do by themselves */
export type SessionsManagement = Pick<
  SessionsEmulation,
  | 'windowIds'
  | 'tabIds'
  | 'privateWindowIds'
  | 'privateTabIds'
  | 'setPrivate'
  | 'removeWindow'
  | 'removeTab'
>;

export interface PolyfillTarget {
  sessions?: PolyfillSessions | undefined;
  // Set where the values are emulated
  sessionsManagement?: SessionsManagement | undefined;
  storage: { local: StorageArea };
  tabs?:
    { get: (tabId: number) => Promise<{ incognito: boolean }> } | undefined;
  windows?:
    { get: (windowId: number) => Promise<{ incognito: boolean }> } | undefined;
  action?:
    | {
        setTitle: (details: TitleDetails) => Promise<void>;
        setBadgeText: (details: BadgeTextDetails) => Promise<void>;
      }
    | undefined;
}

export interface PolyfillScope {
  browser?: PolyfillTarget | undefined;
  chrome?: PolyfillTarget | undefined;
  // Shared by all the contexts of the extension, where the browser has it
  navigator?: { locks?: Locks | undefined } | undefined;
}

/**
 * How the emulation knows a private window or tab, whose values it keeps apart from the others.
 * Every context of the add-on has `tabs` and `windows`; without them, nothing is kept apart.
 */
function isPrivateIn({ tabs, windows }: PolyfillTarget): IsPrivate | undefined {
  if (tabs === undefined || windows === undefined) {
    return undefined;
  }
  return async (scope, id) =>
    (await (scope === 'tabs' ? tabs.get(id) : windows.get(id))).incognito;
}

/**
 * Make Chromium look like Firefox: `browser` is `chrome`, the per-tab and
 * per-window values that only Firefox has are kept in the extension's storage,
 * and toolbar button calls that name a window work.
 */
export function installPolyfills(scope: PolyfillScope): void {
  scope.browser ??= scope.chrome;
  const { browser: target } = scope;
  if (target === undefined) {
    return;
  }

  const emulation = createSessionsEmulation(
    () => target.storage.local,
    createExclusively(scope.navigator?.locks),
    isPrivateIn(target),
  );
  target.sessions ??= {};
  const { sessions } = target;
  // Only where the browser has no values of its own: there the emulation is the store
  if (sessions.getTabValue === undefined) {
    target.sessionsManagement = {
      windowIds: emulation.windowIds,
      tabIds: emulation.tabIds,
      privateWindowIds: emulation.privateWindowIds,
      privateTabIds: emulation.privateTabIds,
      setPrivate: emulation.setPrivate,
      removeWindow: emulation.removeWindow,
      removeTab: emulation.removeTab,
    };
  }
  sessions.getTabValue ??= emulation.getTabValue;
  sessions.setTabValue ??= emulation.setTabValue;
  sessions.removeTabValue ??= emulation.removeTabValue;
  sessions.getWindowValue ??= emulation.getWindowValue;
  sessions.setWindowValue ??= emulation.setWindowValue;
  sessions.removeWindowValue ??= emulation.removeWindowValue;

  const { action } = target;
  if (action !== undefined) {
    action.setTitle = retryWithoutWindowId(
      action.setTitle.bind(action),
      ({ windowId, ...rest }) => rest,
    );
    action.setBadgeText = retryWithoutWindowId(
      action.setBadgeText.bind(action),
      ({ windowId, ...rest }) => rest,
    );
  }
}

installPolyfills(globalThis);
