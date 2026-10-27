import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundHandlers } from '../../../src/js/adapters/browser/events.js';
import { createFakeSessions } from '../../support/fake-sessions.js';

const EXTENSION = 'moz-extension://id/';

interface FakeTab {
  id: number;
  windowId: number;
  active: boolean;
  pinned: boolean;
  url: string;
  lastAccessed: number;
}

const tab = (id: number, overrides: Partial<FakeTab> = {}): FakeTab => ({
  id,
  windowId: 1,
  active: false,
  pinned: false,
  url: `https://site${String(id)}/`,
  lastAccessed: id,
  ...overrides,
});

/** A browser with just enough in it for the background to run against */
function fakeBrowser(tabs: FakeTab[], { withTabGroups = true } = {}) {
  const sessions = createFakeSessions();
  const sync: Record<string, unknown> = {};
  const browser = {
    runtime: {
      getManifest: () => ({ version: '2.5.0' }),
      getURL: (path: string) => `${EXTENSION}${path}`,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
    },
    sessions: {
      ...sessions.api.sessions,
      getRecentlyClosed: vi.fn().mockResolvedValue([]),
    },
    storage: {
      sync: {
        get: vi.fn((defaults: object) =>
          Promise.resolve({ ...defaults, ...sync }),
        ),
      },
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    tabs: {
      query: vi.fn(
        (info: {
          windowId?: number;
          hidden?: boolean;
          highlighted?: boolean;
        }) =>
          Promise.resolve(
            tabs.filter(
              (candidate) =>
                info.windowId === undefined ||
                candidate.windowId === info.windowId,
            ),
          ),
      ),
      get: vi.fn((id: number) => {
        const found = tabs.find((candidate) => candidate.id === id);
        return found
          ? Promise.resolve(found)
          : Promise.reject(new Error('no tab'));
      }),
      update: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue([]),
      show: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: 99 }),
      group: vi.fn().mockResolvedValue(500),
      ungroup: vi.fn().mockResolvedValue(undefined),
    },
    windows: {
      getCurrent: vi.fn().mockResolvedValue({ id: 1 }),
      getLastFocused: vi.fn().mockResolvedValue({ id: 1 }),
      get: vi.fn().mockResolvedValue({ id: 1 }),
      getAll: vi.fn().mockResolvedValue([{ id: 1 }]),
    },
    action: {
      setTitle: vi.fn().mockResolvedValue(undefined),
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setPopup: vi.fn().mockResolvedValue(undefined),
    },
    contextMenus: {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      removeAll: vi.fn().mockResolvedValue(undefined),
    },
    i18n: { getMessage: vi.fn(() => 'Group ') },
    notifications: {
      create: vi.fn().mockResolvedValue('id'),
      clear: vi.fn().mockResolvedValue(true),
    },
    ...(withTabGroups
      ? {
          tabGroups: {
            query: vi.fn().mockResolvedValue([]),
            get: vi.fn().mockResolvedValue({ windowId: 1, title: 'x' }),
            update: vi.fn().mockResolvedValue({}),
          },
        }
      : {}),
  };
  return { browser, sessions, sync };
}

async function compose(
  tabs: FakeTab[] = [tab(1, { active: true })],
  options = {},
) {
  vi.resetModules();
  const fake = fakeBrowser(tabs, options);
  vi.stubGlobal('browser', fake.browser);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { composeBackground } =
    await import('../../../src/js/background/compose.js');
  return { ...fake, ...composeBackground() };
}

describe('background/compose.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gives a handler for every event of the browser', async () => {
    const { handlers } = await compose();

    const names: (keyof BackgroundHandlers)[] = [
      'toggleView',
      'triggerCommand',
      'createGroupInWindowIfMissing',
      'tabCreated',
      'tabAttached',
      'tabDetached',
      'tabActivated',
      'tabUpdated',
      'tabRemoved',
      'menuClicked',
      'handleMessage',
      'handleExternalMessage',
      'storageChanged',
      'nativeGroupRemoved',
      'nativeGroupUpdated',
    ];
    names.forEach((name) => {
      expect(typeof handlers[name]).toBe('function');
    });
  });

  it('says what the browser can do', async () => {
    await compose();

    expect(console.debug).toHaveBeenCalledWith('Browser capabilities:', {
      tabHide: true,
      tabGroups: true,
      mode: 'hybrid',
    });
  });

  it('forgets the group of a tab that was detached, in the browser’s own storage', async () => {
    const { handlers, sessions } = await compose();
    await sessions.api.sessions.setTabValue(7, 'groupId', 3);

    await handlers.tabDetached(7);

    expect(sessions.tabValues.has(sessions.slot(7, 'groupId'))).toBe(false);
  });

  it('opens the view in a new tab when there is none', async () => {
    const { handlers, browser } = await compose();

    await handlers.toggleView();

    expect(browser.tabs.create).toHaveBeenCalledWith({
      url: '/view.html',
      active: true,
    });
  });

  it('opens the options page for the shortcut that asks for it', async () => {
    const { handlers, browser } = await compose();

    await handlers.triggerCommand('manage-extension');

    expect(browser.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it('answers the pages whether the view is to refresh, and refreshes it when told', async () => {
    const { handlers, browser } = await compose();

    await expect(
      handlers.handleMessage({ action: 'checkViewRefresh' }),
    ).resolves.toEqual({
      viewRefreshOrdered: false,
    });
    await handlers.handleMessage({ action: 'refreshView' });

    await expect(
      handlers.handleMessage({ action: 'checkViewRefresh' }),
    ).resolves.toEqual({
      viewRefreshOrdered: true,
    });
    expect(browser.action.setPopup).toHaveBeenCalledWith({
      popup: 'popup-view/index.html',
    });
  });

  it('leaves the tabs of a backup alone while the options page opens it', async () => {
    const { handlers, browser, sessions } = await compose();
    await handlers.handleMessage({
      action: 'setBackgroundState',
      key: 'openingBackup',
      value: true,
    });

    await handlers.tabCreated({ id: 5, windowId: 1, active: true });

    expect(sessions.tabValues.size).toBe(0);
    expect(browser.tabs.query).not.toHaveBeenCalled();
  });

  it('assigns a tab that was created to the group of its window', async () => {
    const { handlers, init, sessions } = await compose([
      tab(1, { active: true }),
      tab(5),
    ]);
    await init();
    await sessions.api.sessions.setWindowValue(1, 'activeGroup', 0);

    await handlers.tabCreated({ id: 5, windowId: 1, active: false });

    expect(sessions.tabValues.get(sessions.slot(5, 'groupId'))).toBe(0);
  });

  it('shows the user that the start-up is slow, and takes it away when it is done', async () => {
    const { init, browser } = await compose();
    let finish: () => void = () => undefined;
    browser.sessions.getRecentlyClosed.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );

    const starting = init();
    await vi.advanceTimersByTimeAsync(1000);

    expect(browser.notifications.create).toHaveBeenCalledWith(
      'viewer-initializing',
      expect.objectContaining({ message: 'Restoring tab groups...' }),
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'showInitializationLoading',
    });

    finish();
    await starting;

    expect(browser.notifications.clear).toHaveBeenCalledWith(
      'viewer-initializing',
    );
  });

  it('moves a tab to the group chosen in the menu', async () => {
    const { handlers, init, browser, sessions } = await compose([
      tab(1, { active: true }),
      tab(5),
    ]);
    await init();

    await handlers.menuClicked({ menuItemId: '0' }, { id: 5, windowId: 1 });

    expect(sessions.tabValues.get(sessions.slot(5, 'groupId'))).toBe(0);
    expect(browser.tabs.move).toHaveBeenCalledWith(5, { index: -1 });
  });

  it('makes the menu again when the user asks to refresh the groups', async () => {
    const { handlers, init, browser } = await compose();
    await init();
    browser.contextMenus.removeAll.mockClear();

    await handlers.menuClicked({ menuItemId: 'refresh-groups' }, undefined);

    expect(browser.contextMenus.removeAll).toHaveBeenCalled();
  });

  it('deletes a group, with its tabs and its menu item, when the view asks', async () => {
    const { handlers, init, browser } = await compose([tab(1), tab(5)]);
    await init();

    const answer = await handlers.handleMessage({
      action: 'deleteGroup',
      groupId: 0,
      windowId: 1,
      nativeGroupId: null,
      tabIds: [5],
    });

    expect(answer).toEqual({ success: true });
    expect(browser.tabs.remove).toHaveBeenCalledWith(5);
    expect(browser.contextMenus.remove).toHaveBeenCalledWith('0');
  });

  it('switches to the next group for the shortcut', async () => {
    const { handlers, init, sessions, browser } = await compose([
      tab(1, { active: true }),
      tab(2),
    ]);
    await init();
    await sessions.api.sessions.setTabValue(1, 'groupId', 0);
    await sessions.api.sessions.setTabValue(2, 'groupId', 4);
    await sessions.api.sessions.setWindowValue(1, 'groups', [
      { id: 0, name: 'A', containerId: 'c', rect: { x: 0, y: 0, w: 1, h: 1 } },
      { id: 4, name: 'B', containerId: 'c', rect: { x: 0, y: 0, w: 1, h: 1 } },
    ]);
    await sessions.api.sessions.setWindowValue(1, 'activeGroup', 0);

    await handlers.triggerCommand('activate-next-group');

    expect(sessions.windowValues.get(sessions.slot(1, 'activeGroup'))).toBe(4);
    // Nothing is selected in the group it switches to, so one of its tabs is
    expect(browser.tabs.update).toHaveBeenCalledWith(2, { active: true });
  });

  it('knows a tab that shows the view page, by the address of the extension', async () => {
    const { handlers, init, sessions } = await compose();
    await init();

    await handlers.tabCreated({
      id: 5,
      windowId: 1,
      url: `${EXTENSION}view.html`,
    });

    expect(sessions.tabValues.get(sessions.slot(5, 'groupId'))).toBe(-1);
  });

  it('shows the group of the tab that was activated and hides the others', async () => {
    const { handlers, init, browser, sessions } = await compose([
      tab(5, { active: true }),
      tab(6),
    ]);
    await init();
    await sessions.api.sessions.setTabValue(5, 'groupId', 0);
    await sessions.api.sessions.setTabValue(6, 'groupId', 7);

    await handlers.tabActivated({ tabId: 5 });

    expect(browser.tabs.hide).toHaveBeenCalledWith([6]);
    expect(browser.tabs.show).toHaveBeenCalledWith([5]);
  });

  it('works in a browser without native tab groups', async () => {
    const { handlers, init, browser } = await compose(
      [tab(1, { active: true })],
      { withTabGroups: false },
    );

    await init();
    await handlers.toggleView();

    expect(console.debug).toHaveBeenCalledWith('Browser capabilities:', {
      tabHide: true,
      tabGroups: false,
      mode: 'legacy',
    });
    expect(browser.tabs.create).toHaveBeenCalledTimes(1);
  });
});
