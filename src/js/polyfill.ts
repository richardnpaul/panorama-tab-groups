import {
  retryWithoutWindowId,
  type BadgeTextDetails,
  type TitleDetails,
} from './adapters/browser/action-compat.js';
import {
  createSessionsEmulation,
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

export interface PolyfillTarget {
  sessions?: PolyfillSessions | undefined;
  storage: { local: StorageArea };
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

  const emulation = createSessionsEmulation(() => target.storage.local);
  target.sessions ??= {};
  const { sessions } = target;
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
