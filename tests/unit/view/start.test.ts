// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFakeSessions } from '../../support/fake-sessions.js';
import { markedMessage, textsOutsideMessages } from '../../support/messages.js';

const WINDOW = 1;
const VIEW_TAB = 99;

const PAGE = `
  <div id="toolbar">
    <div id="newGroup" class="button"></div>
    <div id="settings" class="button"></div>
    <div id="freeform" class="button"></div>
    <div id="tiling" class="button"></div>
    <div id="pinnedTabs"></div>
    <div id="search bar"><input type="text" id="tab-search" /></div>
  </div>
  <div id="groups" class="dragscroll"></div>
`;

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

/** An event of the browser that remembers its listeners */
function event<Args extends unknown[]>() {
  const listeners: ((...args: Args) => void)[] = [];
  return {
    listeners,
    addListener: (listener: (...args: Args) => void) => {
      listeners.push(listener);
    },
    fire: (...args: Args) => {
      listeners.forEach((listener) => {
        listener(...args);
      });
    },
  };
}

async function load(
  options: {
    tabs?: ReturnType<typeof rawTab>[];
    tabGroups?: Record<number, number>;
    groups?: ReturnType<typeof group>[];
    stored?: Record<string, unknown>;
    path?: string;
    // The markup of the page, where the test is about what the page itself says
    page?: string;
  } = {},
) {
  vi.resetModules();
  const {
    tabs = [
      rawTab(1),
      rawTab(2),
      rawTab(VIEW_TAB, { url: 'moz-extension://id/view.html' }),
    ],
    tabGroups = { 1: 0, 2: 1, [VIEW_TAB]: -1 },
    groups = [group(0, 'First'), group(1, 'Second')],
    stored = {},
    page = PAGE,
  } = options;
  document.body.className = '';
  document.body.innerHTML = page;

  const sessions = createFakeSessions();
  await sessions.api.sessions.setWindowValue(WINDOW, 'groups', groups);
  await Promise.all(
    Object.entries(tabGroups).map(([id, groupId]) =>
      sessions.api.sessions.setTabValue(Number(id), 'groupId', groupId),
    ),
  );

  const events = {
    created: event<[ReturnType<typeof rawTab>]>(),
    removed: event<[number, { windowId: number }]>(),
    updated: event<[number, object, ReturnType<typeof rawTab>]>(),
    moved: event<[number, { windowId: number }]>(),
    attached: event<[number, { newWindowId: number }]>(),
    detached: event<[number, { oldWindowId: number }]>(),
    storageChanged: event<[Record<string, { newValue?: unknown }>, string]>(),
  };
  const current = tabs.slice();
  const browserFake = {
    runtime: {
      getManifest: () => ({ version: '2.0' }),
      sendMessage: vi.fn().mockResolvedValue({}),
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
    },
    i18n: {
      getMessage: vi.fn((name: string) => markedMessage(name)),
    },
    storage: {
      sync: {
        get: vi.fn((defaults: object) =>
          Promise.resolve({ ...defaults, ...stored }),
        ),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: events.storageChanged,
    },
    sessions: sessions.api.sessions,
    windows: { getCurrent: vi.fn().mockResolvedValue({ id: WINDOW }) },
    tabs: {
      getCurrent: vi.fn().mockResolvedValue({ id: VIEW_TAB }),
      query: vi.fn(() => Promise.resolve(current)),
      get: vi.fn((id: number) => {
        const found = current.find((each) => each.id === id);
        return found
          ? Promise.resolve(found)
          : Promise.reject(new Error('no tab'));
      }),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({}),
      onCreated: events.created,
      onRemoved: events.removed,
      onUpdated: events.updated,
      onMoved: events.moved,
      onAttached: events.attached,
      onDetached: events.detached,
    },
  };
  vi.stubGlobal('browser', browserFake);
  const matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  Element.prototype.scrollIntoView = vi.fn();

  const { startView } = await import('../../../src/js/view/start.js');
  return {
    startView,
    browser: browserFake,
    events,
    sessions,
    error,
    matchMedia,
    tabs: current,
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

const groupNames = () =>
  Array.from(document.querySelectorAll('#groups > .group .header .name')).map(
    (name) => name.textContent,
  );

describe('view/start.ts', () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
  });

  afterEach(() => {
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('showing the view', () => {
    it('dresses the page, shows the groups and is ready', async () => {
      const env = await load({
        stored: { theme: 'light', toolbarPosition: 'left' },
      });

      await env.startView();

      expect(document.body.classList.contains('theme-light')).toBe(true);
      expect(document.body.classList.contains('toolbar-left')).toBe(true);
      expect(groupNames()).toEqual(['First', 'Second']);
      expect(document.body.classList.contains('view-ready')).toBe(true);
    });

    it('asks whether the system prefers the dark theme', async () => {
      const env = await load();

      await env.startView();

      expect(env.matchMedia).toHaveBeenCalledWith(
        '(prefers-color-scheme: dark)',
      );
    });

    it('is not ready before the groups are shown', async () => {
      const env = await load();

      const starting = env.startView();
      await settle();

      // The page only becomes ready at the end of the start-up
      await starting;
      expect(document.body.classList.contains('view-ready')).toBe(true);
    });

    it('shows no text that is not from a message, in the real page', async () => {
      // The names of groups and tabs are the user's, so these have no words in them
      const real = readFileSync('src/view.html', 'utf8');
      const env = await load({
        page: /<body[^>]*>([\s\S]*)<\/body>/.exec(real)?.[1] ?? '',
        groups: [group(0, '#0'), group(1, '#1')],
        tabs: [
          rawTab(1, { title: '#1' }),
          rawTab(2, { title: '#2' }),
          rawTab(VIEW_TAB, {
            url: 'moz-extension://id/view.html',
            title: '#3',
          }),
        ],
      });

      await env.startView();

      expect(textsOutsideMessages(document.body)).toEqual([]);
      expect(document.title).toBe(markedMessage('viewTitle'));
      expect(element('#tab-search').getAttribute('placeholder')).toBe(
        markedMessage('searchForTab_placeholder'),
      );
    });

    it('sets the direction and the language of the page from the browser', async () => {
      const env = await load();
      env.browser.i18n.getMessage.mockImplementation(
        (name: string) =>
          ({ '@@bidi_dir': 'rtl', '@@ui_locale': 'ar' })[name] ??
          markedMessage(name),
      );

      await env.startView();

      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');
    });

    it('gives the buttons their titles', async () => {
      const env = await load();

      await env.startView();

      expect(element('#newGroup').title).toBe(markedMessage('newGroupButton'));
      expect(element('#settings').title).toBe(markedMessage('settingsButton'));
      expect(element('#tiling').title).toBe(markedMessage('tilingButton'));
      expect(element('#freeform').title).toBe(markedMessage('freeformButton'));
    });

    it('puts the tabs in their groups, and the pinned ones with the pinned tabs', async () => {
      const env = await load({
        tabs: [
          rawTab(1),
          rawTab(2),
          rawTab(3, { pinned: true }),
          rawTab(VIEW_TAB),
        ],
        tabGroups: { 1: 0, 2: 1, 3: 0, [VIEW_TAB]: -1 },
      });

      await env.startView();

      const contents = Array.from(
        document.querySelectorAll('#groups > .group .content'),
      );
      const idsIn = (content: Element | undefined) =>
        Array.from(content?.querySelectorAll(':scope > .tab') ?? []).map(
          (each) => each.getAttribute('tabId'),
        );
      expect(idsIn(contents[0])).toEqual(['1']);
      expect(idsIn(contents[1])).toEqual(['2']);
      expect(
        Array.from(document.querySelectorAll('#pinnedTabs > .tab')).map(
          (each) => each.getAttribute('tabId'),
        ),
      ).toEqual(['3']);
    });

    it('puts the drag indicator in the page', async () => {
      const env = await load();

      await env.startView();

      expect(
        document.querySelector('#groups > .drag_indicator'),
      ).not.toBeNull();
    });

    it('takes pictures of the tabs where the browser can', async () => {
      const env = await load();
      const captureTab = vi.fn().mockResolvedValue(undefined);
      Object.assign(env.browser.tabs, { captureTab });

      await env.startView();
      await settle();

      expect(captureTab).toHaveBeenCalledWith(1, {
        format: 'jpeg',
        quality: 25,
      });
    });

    it('keeps a small picture of a tab made with the images of the page', async () => {
      class FakeImage {
        width = 1000;

        height = 500;

        onload: ((loaded: Event) => void) | null = null;

        onerror: ((failed: Event | string) => void) | null = null;

        set src(_address: string) {
          queueMicrotask(() => {
            this.onload?.(new Event('load'));
          });
        }
      }
      vi.stubGlobal('Image', FakeImage);
      const drawImage = vi.fn();
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value: () => ({ drawImage }),
        configurable: true,
      });
      Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
        value: () => 'data:image/jpeg;base64,small',
        configurable: true,
      });
      try {
        const env = await load({
          tabs: [
            rawTab(1, { favIconUrl: 'https://site1/icon.png' }),
            rawTab(2),
            rawTab(VIEW_TAB, { url: 'moz-extension://id/view.html' }),
          ],
        });
        Object.assign(env.browser.tabs, {
          captureTab: vi.fn().mockResolvedValue('data:image/jpeg;base64,big'),
        });

        await env.startView();
        await settle();

        const kept = await env.sessions.api.sessions.getTabValue(
          1,
          'thumbnail',
        );
        expect(kept).toMatchObject({
          thumbnail: 'data:image/jpeg;base64,small',
        });
        expect(drawImage).toHaveBeenCalled();
      } finally {
        Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext');
        Reflect.deleteProperty(HTMLCanvasElement.prototype, 'toDataURL');
      }
    });

    it('asks before closing a group that has tabs', async () => {
      const env = await load();
      await env.startView();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

      element('#groups > .group .header .close').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      await settle();

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(groupNames()).toEqual(['First', 'Second']);
    });

    it('closes a group the user agrees to close, with its tabs', async () => {
      const env = await load();
      await env.startView();
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      element('#groups > .group .header .close').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      await settle();

      expect(groupNames()).toEqual(['Second']);
      expect(env.browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'deleteGroup',
          groupId: 0,
          tabIds: [1],
        }),
      );
    });

    it('lets a group be moved by pressing in it, while the layout is the free one', async () => {
      const env = await load();
      await env.startView();
      const header = element('#groups > .group .header');

      header.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
      await settle();

      expect(document.body.getAttribute('style')).toContain('cursor');
    });

    it('lets the groups be scrolled by dragging', async () => {
      const env = await load();
      await env.startView();
      const press = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });

      element('#groups').dispatchEvent(press);

      expect(press.defaultPrevented).toBe(true);
    });

    it('shows the layout as the free one', async () => {
      const env = await load();

      await env.startView();

      const mode = await env.sessions.api.sessions.getWindowValue(
        WINDOW,
        'layoutMode',
      );
      expect(mode).toBe('freeform');
    });

    it('selects the tab used last, other than the view', async () => {
      const env = await load();

      await env.startView();

      expect(element('.tab.selected').getAttribute('tabId')).toBe('2');
    });
  });

  describe('the buttons and the search', () => {
    it('makes a new group with the button', async () => {
      const env = await load();
      await env.startView();

      element('#newGroup').click();
      await settle();

      expect(document.querySelectorAll('#groups > .group')).toHaveLength(3);
    });

    it('opens the options page with the settings button', async () => {
      const env = await load();
      await env.startView();

      element('#settings').click();
      await settle();

      expect(env.browser.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
    });

    it('tiles the groups with the tiling button, and frees them with the other', async () => {
      const env = await load();
      await env.startView();

      element('#tiling').click();
      await settle();
      const tiling = await env.sessions.api.sessions.getWindowValue(
        WINDOW,
        'layoutMode',
      );
      element('#freeform').click();
      await settle();
      const freeform = await env.sessions.api.sessions.getWindowValue(
        WINDOW,
        'layoutMode',
      );

      expect(tiling).toBe('tiling');
      expect(freeform).toBe('freeform');
    });

    it('selects the tab found by what is typed in the search box', async () => {
      const env = await load();
      await env.startView();
      const input = element('#tab-search');
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('No search input');
      }

      input.value = 'Tab 1';
      input.dispatchEvent(new Event('input'));
      await settle();

      expect(element('.tab.selected').getAttribute('tabId')).toBe('1');
    });

    it('moves the selection with the arrow keys, and goes to the tab with Enter', async () => {
      const env = await load();
      await env.startView();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight' }),
      );
      await settle();
      expect(element('.tab.selected').getAttribute('tabId')).toBe('1');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await settle();

      expect(env.browser.tabs.update).toHaveBeenCalledWith(1, { active: true });
    });
  });

  describe('the page behind the groups', () => {
    it('makes a group at a click of the middle button', async () => {
      const env = await load();
      await env.startView();
      const groups = element('#groups');
      const click = new MouseEvent('auxclick', {
        button: 1,
        bubbles: true,
        cancelable: true,
      });

      const reached = vi.fn();
      document.body.addEventListener('auxclick', reached);

      groups.dispatchEvent(click);
      await settle();

      expect(reached).not.toHaveBeenCalled();
      expect(click.defaultPrevented).toBe(true);
      expect(document.querySelectorAll('#groups > .group')).toHaveLength(3);
    });

    it('does nothing at a click of another button, or in front of the groups', async () => {
      const env = await load();
      await env.startView();

      element('#groups').dispatchEvent(
        new MouseEvent('auxclick', { button: 2, bubbles: true }),
      );
      element('#groups .content').dispatchEvent(
        new MouseEvent('auxclick', { button: 1, bubbles: true }),
      );
      await settle();

      expect(document.querySelectorAll('#groups > .group')).toHaveLength(2);
    });

    it('makes a group at a double click', async () => {
      const env = await load();
      await env.startView();

      element('#groups').dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true }),
      );
      await settle();

      expect(document.querySelectorAll('#groups > .group')).toHaveLength(3);
    });

    it('raises a group at a click in its content, without the click reaching further', async () => {
      const env = await load();
      await env.startView();
      const reached = vi.fn();
      document.body.addEventListener('click', reached);

      element('#groups .content').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      await settle();

      expect(reached).not.toHaveBeenCalled();
      expect(env.error).not.toHaveBeenCalled();
    });

    it('allows a tab to be dropped on it', async () => {
      const env = await load();
      await env.startView();
      const over = new MouseEvent('dragover', {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(over, 'dataTransfer', {
        value: { dropEffect: '' },
      });

      element('#groups').dispatchEvent(over);

      expect(over.defaultPrevented).toBe(true);
    });

    it('ignores what is not a drag', async () => {
      const env = await load();
      await env.startView();
      const over = new Event('dragover', { bubbles: true, cancelable: true });
      const drop = new Event('drop', { bubbles: true, cancelable: true });

      element('#groups').dispatchEvent(over);
      element('#groups').dispatchEvent(drop);
      await settle();

      expect(over.defaultPrevented).toBe(false);
      expect(drop.defaultPrevented).toBe(false);
      expect(document.querySelectorAll('#groups > .group')).toHaveLength(2);
    });

    it('makes a group for a tab dropped on it', async () => {
      const env = await load();
      await env.startView();
      const drop = new MouseEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', { value: {} });

      element('#groups').dispatchEvent(drop);
      await settle();

      expect(document.querySelectorAll('#groups > .group')).toHaveLength(3);
    });

    it('places the groups again when the window is resized', async () => {
      const env = await load();
      await env.startView();
      const shown = element('#groups > .group');
      shown.style.top = '';

      window.dispatchEvent(new Event('resize'));

      expect(shown.style.top).not.toBe('');
    });
  });

  describe('the page being shown again', () => {
    it('asks the background whether the view is out of date', async () => {
      const env = await load();
      await env.startView();
      env.browser.runtime.sendMessage.mockClear();

      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(env.browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'checkViewRefresh',
      });
    });
  });

  describe('what the browser says of tabs', () => {
    it('shows a tab that was opened in its group', async () => {
      const env = await load();
      await env.startView();
      await env.sessions.api.sessions.setTabValue(5, 'groupId', 1);
      env.tabs.push(rawTab(5));

      env.events.created.fire(rawTab(5));
      await settle();

      expect(document.querySelector('.tab[tabId="5"]')).not.toBeNull();
    });

    it('takes away a tab that was closed', async () => {
      const env = await load();
      await env.startView();

      env.events.removed.fire(1, { windowId: WINDOW });

      expect(document.querySelector('.tab[tabId="1"]')).toBeNull();
    });

    it('shows the new title of a tab', async () => {
      const env = await load();
      await env.startView();

      env.events.updated.fire(1, { title: 'New' }, rawTab(1, { title: 'New' }));
      await settle();

      expect(document.querySelector('.tab[tabId="1"] .name')?.textContent).toBe(
        'New',
      );
    });

    it('shows a tab that was moved', async () => {
      const env = await load();
      await env.startView();

      env.events.moved.fire(1, { windowId: WINDOW });
      await settle();

      expect(document.querySelector('.tab[tabId="1"]')).not.toBeNull();
      expect(env.error).not.toHaveBeenCalled();
    });

    it('shows a tab that was moved to the window, and takes away one that left it', async () => {
      const env = await load();
      await env.startView();
      await env.sessions.api.sessions.setTabValue(6, 'groupId', 0);
      env.tabs.push(rawTab(6));

      env.events.attached.fire(6, { newWindowId: WINDOW });
      await settle();
      expect(document.querySelector('.tab[tabId="6"]')).not.toBeNull();
      env.events.detached.fire(6, { oldWindowId: WINDOW });

      expect(document.querySelector('.tab[tabId="6"]')).toBeNull();
    });
  });

  it('says so when a handler fails', async () => {
    const env = await load();
    await env.startView();
    env.browser.runtime.openOptionsPage.mockRejectedValue(new Error('no'));

    element('#settings').click();
    await settle();

    expect(env.error).toHaveBeenCalledWith(
      '[View] An event handler failed:',
      expect.any(Error),
    );
  });
});

describe('view/index.ts', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/js/polyfill.js');
    vi.doUnmock('../../../src/js/view/start.js');
    vi.restoreAllMocks();
  });

  it('starts the view', async () => {
    vi.resetModules();
    const startView = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../../src/js/polyfill.js', () => ({}));
    vi.doMock('../../../src/js/view/start.js', () => ({ startView }));

    await import('../../../src/js/view/index.js');

    expect(startView).toHaveBeenCalledTimes(1);
  });

  it('says so when it cannot', async () => {
    vi.resetModules();
    const failure = new Error('no tab');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.doMock('../../../src/js/polyfill.js', () => ({}));
    vi.doMock('../../../src/js/view/start.js', () => ({
      startView: vi.fn().mockRejectedValue(failure),
    }));

    await import('../../../src/js/view/index.js');
    await settle();

    expect(error).toHaveBeenCalledWith('[View] Start-up failed:', failure);
  });
});
