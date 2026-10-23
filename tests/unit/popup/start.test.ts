// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeSessions } from '../../support/fake-sessions.js';
import { setUpPopupPage } from '../../support/popup-page.js';

const WINDOW = 1;

const group = (id: number, name: string) => ({
  id,
  name,
  containerId: 'firefox-default',
  rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
});

const rawTab = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  windowId: WINDOW,
  index: id,
  title: `Tab ${String(id)}`,
  url: `https://site${String(id)}/`,
  pinned: false,
  discarded: false,
  lastAccessed: id * 10,
  ...overrides,
});

async function load(
  options: { stored?: Record<string, unknown>; page?: boolean } = {},
) {
  vi.resetModules();
  const { stored = {}, page = true } = options;
  if (page) {
    setUpPopupPage();
  } else {
    document.body.innerHTML = '';
  }

  const sessions = createFakeSessions();
  await sessions.api.sessions.setWindowValue(WINDOW, 'groups', [
    group(0, 'First'),
    group(1, 'Second'),
  ]);
  await sessions.api.sessions.setWindowValue(WINDOW, 'groupIndex', 2);
  const tabs = [rawTab(1), rawTab(2), rawTab(3), rawTab(4, { pinned: true })];
  await Promise.all(
    [
      [1, 0],
      [2, 1],
      [3, 1],
    ].map(([tabId, groupId]) =>
      sessions.api.sessions.setTabValue(tabId ?? 0, 'groupId', groupId),
    ),
  );

  const browserFake = {
    runtime: {
      getManifest: () => ({ version: '2.0' }),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
    },
    i18n: { getMessage: vi.fn((name: string) => `[${name}]`) },
    storage: {
      sync: {
        get: vi.fn((defaults: object) =>
          Promise.resolve({ ...defaults, ...stored }),
        ),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn() },
    },
    sessions: sessions.api.sessions,
    windows: { getCurrent: vi.fn().mockResolvedValue({ id: WINDOW }) },
    tabs: {
      query: vi.fn(() => Promise.resolve(tabs)),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: 50 }),
    },
  };
  vi.stubGlobal('browser', browserFake);
  const matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);

  const { startPopup } = await import('../../../src/popup-view/start.js');
  return {
    startPopup,
    browser: browserFake,
    sessions,
    close,
    confirm,
    error,
    matchMedia,
  };
}

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const element = (selector: string): HTMLElement => {
  const found = document.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`No ${selector}`);
  }
  return found;
};

// The state also holds a group of the tabs that are in none
const idOf = (each: { id: number }): number => each.id;
const isUserGroup = (id: number): boolean => id >= 0;

const groupNames = () =>
  Array.from(document.querySelectorAll('#main-frame .list__item')).map(
    (item) => item.querySelector('.list__link span')?.textContent,
  );

describe('popup-view/start.ts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('dresses the page and shows the groups', async () => {
    const env = await load({ stored: { theme: 'light' } });

    await env.startPopup();

    expect(document.body.classList.contains('theme-light')).toBe(true);
    expect(groupNames()).toEqual(['First', 'Second']);
    expect(document.body.classList.contains('content-loading')).toBe(false);
    expect(element('#main-frame').classList.contains('frame--active')).toBe(
      true,
    );
  });

  it('shows how many tabs each group has, without the pinned ones', async () => {
    const env = await load();

    await env.startPopup();

    expect(
      Array.from(
        document.querySelectorAll('#main-frame .list__link--extend span'),
      ).map((count) => count.textContent),
    ).toEqual(['[tabCount]', '[tabCount]']);
  });

  it('asks whether the system prefers the dark theme', async () => {
    const env = await load();

    await env.startPopup();

    expect(env.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  });

  it('fails when the page lacks the frames', async () => {
    const env = await load({ page: false });

    await expect(env.startPopup()).rejects.toThrow(
      'Element not found: #frame-shell',
    );
  });

  it('goes to a group and closes the popup', async () => {
    const env = await load();
    await env.startPopup();

    element('#group-1 .list__close-wrapper > .list__link').click();
    await settle();

    expect(env.browser.tabs.update).toHaveBeenCalledWith(2, { active: true });
    expect(
      await env.sessions.api.sessions.getWindowValue(WINDOW, 'activeGroup'),
    ).toBe(1);
    expect(env.close).toHaveBeenCalledTimes(1);
  });

  it('shows the tabs of a group, and goes back from them', async () => {
    const env = await load();
    await env.startPopup();

    element('#group-1 .list__link--extend').click();
    await settle();

    expect(
      Array.from(
        document.querySelectorAll('#aside-frame .list__item--tab'),
      ).map((item) => item.getAttribute('data-tab')),
    ).toEqual(['2', '3']);
    expect(
      element('#frame-shell').classList.contains('frame-shell--aside-active'),
    ).toBe(true);

    element('#aside-frame .button-ghost--back').click();
    await settle();

    expect(
      element('#frame-shell').classList.contains('frame-shell--aside-active'),
    ).toBe(false);
    expect(document.activeElement).toBe(
      element('#group-1 .list__link--extend'),
    );
  });

  it('says so when a frame cannot be shown', async () => {
    const env = await load();
    await env.startPopup();
    const failure = new Error('gone');
    env.browser.tabs.query.mockRejectedValue(failure);

    element('#group-1 .list__link--extend').click();
    await settle();

    expect(env.error).toHaveBeenCalledWith('[Popup] A frame failed:', failure);
  });

  it('goes to a tab and closes the popup', async () => {
    const env = await load();
    await env.startPopup();
    element('#group-1 .list__link--extend').click();
    await settle();

    element('#aside-frame .list__item--tab:nth-child(2) .list__link').click();
    await settle();

    expect(env.browser.tabs.update).toHaveBeenCalledWith(3, { active: true });
    expect(env.close).toHaveBeenCalledTimes(1);
  });

  it('closes a tab', async () => {
    const env = await load();
    await env.startPopup();
    element('#group-1 .list__link--extend').click();
    await settle();

    element('#aside-frame .list__item--tab .list__close').click();
    await settle();

    expect(env.browser.tabs.remove).toHaveBeenCalledWith(2);
    expect(env.close).not.toHaveBeenCalled();
  });

  it('opens the settings and closes the popup', async () => {
    const env = await load();
    await env.startPopup();

    element('.button-ghost--settings').click();
    await settle();

    expect(env.browser.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
    expect(env.close).toHaveBeenCalledTimes(1);
  });

  it('makes a new group with a tab in it and asks for its name', async () => {
    const env = await load();
    await env.startPopup();

    element('.button-ghost--new').click();
    await settle();

    expect(env.browser.tabs.create).toHaveBeenCalledWith({ active: true });
    expect(await env.sessions.api.sessions.getTabValue(50, 'groupId')).toBe(2);
    expect(element('#aside-frame .group-edit-input input')).toBeInstanceOf(
      HTMLInputElement,
    );
    const groups = await env.sessions.api.sessions.getWindowValue(
      WINDOW,
      'groups',
    );
    expect(
      Array.isArray(groups) ? groups.map(idOf).filter(isUserGroup) : [],
    ).toHaveLength(3);
  });

  it('removes a group after asking', async () => {
    const env = await load();
    await env.startPopup();

    element('#group-0 .list__close').click();
    await settle();

    expect(env.confirm).toHaveBeenCalledTimes(1);
    expect(env.browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deleteGroup', groupId: 0 }),
    );
    expect(document.getElementById('group-0')).toBeNull();
    expect(env.browser.tabs.update).toHaveBeenCalledWith(2, { active: true });
  });

  it('puts the groups in a new order', async () => {
    const env = await load();
    await env.startPopup();
    const zone = document.querySelectorAll('#main-frame .drop-zone')[2];
    const first = element('#group-0');
    const dragEvent = (type: string) => {
      const made = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(made, 'dataTransfer', {
        value: { setData: vi.fn() },
      });
      return made;
    };

    first.dispatchEvent(dragEvent('dragstart'));
    zone?.dispatchEvent(dragEvent('drop'));
    await settle();

    const groups = await env.sessions.api.sessions.getWindowValue(
      WINDOW,
      'groups',
    );
    expect(
      Array.isArray(groups) ? groups.map(idOf).filter(isUserGroup) : [],
    ).toEqual([1, 0]);
  });
});

describe('popup-view/index.ts', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/js/polyfill.js');
    vi.doUnmock('../../../src/popup-view/start.js');
    vi.restoreAllMocks();
  });

  it('starts the popup', async () => {
    vi.resetModules();
    const startPopup = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../../src/js/polyfill.js', () => ({}));
    vi.doMock('../../../src/popup-view/start.js', () => ({ startPopup }));

    await import('../../../src/popup-view/index.js');

    expect(startPopup).toHaveBeenCalledTimes(1);
  });

  it('says so when it cannot', async () => {
    vi.resetModules();
    const failure = new Error('no window');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.doMock('../../../src/js/polyfill.js', () => ({}));
    vi.doMock('../../../src/popup-view/start.js', () => ({
      startPopup: vi.fn().mockRejectedValue(failure),
    }));

    await import('../../../src/popup-view/index.js');
    await settle();

    expect(error).toHaveBeenCalledWith('[Popup] Start-up failed:', failure);
  });
});
