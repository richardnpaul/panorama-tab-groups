// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryViewState } from '../../../src/js/adapters/memory/view-state.js';
import { createMemoryViewTabs } from '../../../src/js/adapters/memory/view-tabs.js';
import type { ViewTab } from '../../../src/js/ports/view-tabs.js';
import { createLeaveView } from '../../../src/js/view/leave-view.js';
import { createTabNodes } from '../../../src/js/view/tab-nodes.js';

const tab = (id: number, overrides: Partial<ViewTab> = {}): ViewTab => ({
  id,
  windowId: 1,
  index: id,
  title: `Tab ${String(id)}`,
  url: `https://site${String(id)}/`,
  favIconUrl: undefined,
  pinned: false,
  discarded: false,
  lastAccessed: id * 10,
  ...overrides,
});

function setUp(initial: ViewTab[] = [tab(1), tab(2), tab(3)]) {
  const tabs = createMemoryViewTabs(initial);
  const viewState = createMemoryViewState();
  const drag = {
    start: vi.fn(),
    enter: vi.fn(),
    over: vi.fn(),
    leave: vi.fn(),
    drop: vi.fn(),
    end: vi.fn(),
  };
  const leaveView = vi.fn().mockResolvedValue(undefined);
  const imageLoads = vi.fn().mockResolvedValue(undefined);
  const logger = { error: vi.fn() };
  const nodes = createTabNodes({
    tabs,
    viewState,
    i18n: { getMessage: (name) => `[${name}]` },
    drag,
    leaveView,
    imageLoads,
    logger,
  });
  return { nodes, tabs, viewState, drag, leaveView, imageLoads, logger };
}

const element = (env: ReturnType<typeof setUp>, id: number): HTMLElement => {
  const found = env.nodes.elementOf(id);
  if (found === undefined) {
    throw new Error(`No node for tab ${String(id)}`);
  }
  return found;
};

const part = (node: HTMLElement, selector: string): HTMLElement => {
  const found = node.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`No ${selector}`);
  }
  return found;
};

// Lets what an event handler started run to its end
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe('view/tab-nodes.ts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('make', () => {
    it('makes a draggable tab node that knows its tab', () => {
      const env = setUp();

      env.nodes.make(tab(7));

      const node = element(env, 7);
      expect(node.className).toBe('tab');
      expect(node.getAttribute('draggable')).toBe('true');
      expect(node.getAttribute('tabId')).toBe('7');
    });

    it('puts a thumbnail, a favicon, a close button and a name in it, in that order', () => {
      const env = setUp();

      env.nodes.make(tab(7));

      const inner = part(element(env, 7), '.inner');
      expect(
        Array.from(inner.children).map((child) => child.className),
      ).toEqual(['thumbnail', 'favicon', 'close', 'name']);
      expect(part(inner, '.close').title).toBe('[closeTab]');
    });

    it('has no node for a tab it has not made one for', () => {
      expect(setUp().nodes.elementOf(7)).toBeUndefined();
    });

    it('is not in the page until it is put there', () => {
      const env = setUp();

      env.nodes.make(tab(7));

      expect(element(env, 7).isConnected).toBe(false);
    });
  });

  describe('clicks', () => {
    it('goes to the tab and then leaves the view', async () => {
      const env = setUp();
      env.nodes.make(tab(7));
      const order: string[] = [];
      env.tabs.activate = (id) => {
        order.push(`activate ${String(id)}`);
        return Promise.resolve();
      };
      env.leaveView.mockImplementation(() => {
        order.push('leave');
        return Promise.resolve();
      });
      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });

      element(env, 7).dispatchEvent(click);
      await settle();

      expect(order).toEqual(['activate 7', 'leave']);
      expect(click.defaultPrevented).toBe(true);
    });

    it('does not let the click reach the group', () => {
      const env = setUp();
      env.nodes.make(tab(7));
      const outer = document.createElement('div');
      const reached = vi.fn();
      outer.addEventListener('click', reached);
      outer.appendChild(element(env, 7));

      element(env, 7).dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(reached).not.toHaveBeenCalled();
    });

    it('does not leave the view when the tab cannot be gone to, and says so', async () => {
      const env = setUp();
      env.nodes.make(tab(7));
      const failure = new Error('gone');
      env.tabs.activate = () => Promise.reject(failure);

      element(env, 7).dispatchEvent(new MouseEvent('click'));
      await settle();

      expect(env.leaveView).not.toHaveBeenCalled();
      expect(env.logger.error).toHaveBeenCalledWith(
        '[View] A tab handler failed:',
        failure,
      );
    });

    it('closes the tab on a click of the middle button, and no other', async () => {
      const env = setUp();
      env.nodes.make(tab(7));
      const node = element(env, 7);

      node.dispatchEvent(new MouseEvent('auxclick', { button: 2 }));
      node.dispatchEvent(new MouseEvent('auxclick', { button: 0 }));
      await settle();
      expect(env.tabs.calls).toEqual([]);

      const middle = new MouseEvent('auxclick', {
        button: 1,
        bubbles: true,
        cancelable: true,
      });
      node.dispatchEvent(middle);
      await settle();

      expect(env.tabs.calls).toEqual(['close 7']);
      expect(middle.defaultPrevented).toBe(true);
    });

    it('does not let an auxiliary click reach the group', () => {
      const env = setUp();
      env.nodes.make(tab(7));
      const outer = document.createElement('div');
      const reached = vi.fn();
      outer.addEventListener('auxclick', reached);
      outer.appendChild(element(env, 7));

      element(env, 7).dispatchEvent(
        new MouseEvent('auxclick', { button: 0, bubbles: true }),
      );

      expect(reached).not.toHaveBeenCalled();
    });

    it('closes the tab with its close button, without going to it', async () => {
      const env = setUp();
      env.nodes.make(tab(7));
      const outer = document.createElement('div');
      const reached = vi.fn();
      outer.addEventListener('click', reached);
      outer.appendChild(element(env, 7));

      part(element(env, 7), '.close').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      await settle();

      expect(env.tabs.calls).toEqual(['close 7']);
      expect(reached).not.toHaveBeenCalled();
      expect(env.leaveView).not.toHaveBeenCalled();
    });

    it('says so when a tab cannot be closed', async () => {
      const env = setUp();
      env.nodes.make(tab(7));

      part(element(env, 7), '.close').dispatchEvent(new MouseEvent('click'));
      await settle();

      expect(env.logger.error).toHaveBeenCalledTimes(1);
    });

    it('says so when a middle click cannot close the tab', async () => {
      const env = setUp();
      env.nodes.make(tab(7));

      element(env, 7).dispatchEvent(new MouseEvent('auxclick', { button: 1 }));
      await settle();

      expect(env.logger.error).toHaveBeenCalledTimes(1);
    });

    it('does not let a press on the tab move the group', () => {
      const env = setUp();
      env.nodes.make(tab(7));
      const outer = document.createElement('div');
      const reached = vi.fn();
      outer.addEventListener('mousedown', reached);
      outer.appendChild(element(env, 7));

      element(env, 7).dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );

      expect(reached).not.toHaveBeenCalled();
    });
  });

  describe('dragging', () => {
    it.each([
      ['dragstart', 'start'],
      ['dragenter', 'enter'],
      ['dragover', 'over'],
      ['dragleave', 'leave'],
      ['drop', 'drop'],
      ['dragend', 'end'],
    ] as const)('hands %s to the %s handler', (type, handler) => {
      const env = setUp();
      env.nodes.make(tab(7));
      const event = new Event(type);

      element(env, 7).dispatchEvent(event);

      expect(env.drag[handler]).toHaveBeenCalledTimes(1);
      expect(env.drag[handler]).toHaveBeenCalledWith(event);
      Object.entries(env.drag)
        .filter(([name]) => name !== handler)
        .forEach(([, other]) => {
          expect(other).not.toHaveBeenCalled();
        });
    });
  });

  describe('update', () => {
    it('shows the title as the name and as the tooltip', () => {
      const env = setUp();
      env.nodes.make(tab(7));

      env.nodes.update(tab(7, { title: 'Hello' }));

      const node = element(env, 7);
      expect(part(node, '.name').textContent).toBe('Hello');
      expect(part(node, '.inner').title).toBe('Hello');
    });

    it('replaces the name rather than adding to it', () => {
      const env = setUp();
      env.nodes.make(tab(7));

      env.nodes.update(tab(7, { title: 'One' }));
      env.nodes.update(tab(7, { title: 'Two' }));

      expect(part(element(env, 7), '.name').childNodes).toHaveLength(1);
      expect(part(element(env, 7), '.name').textContent).toBe('Two');
    });

    it('marks a tab that is not loaded as inactive, and clears it when it is', () => {
      const env = setUp();
      env.nodes.make(tab(7));

      env.nodes.update(tab(7, { discarded: true }));
      expect(element(env, 7).classList.contains('inactive')).toBe(true);
      env.nodes.update(tab(7, { discarded: false }));
      expect(element(env, 7).classList.contains('inactive')).toBe(false);
    });

    it('marks a pinned tab, frees its size, and clears the mark when it is unpinned', () => {
      const env = setUp();
      env.nodes.make(tab(7));
      const node = element(env, 7);
      node.style.width = '50px';
      node.style.height = '30px';

      env.nodes.update(tab(7, { pinned: true }));
      expect(node.classList.contains('pinned')).toBe(true);
      expect(node.style.width).toBe('');
      expect(node.style.height).toBe('');

      node.style.width = '60px';
      env.nodes.update(tab(7, { pinned: false }));
      expect(node.classList.contains('pinned')).toBe(false);
      expect(node.style.width).toBe('60px');
    });

    it('does nothing for a tab it has no node for', () => {
      const env = setUp();

      expect(() => {
        env.nodes.update(tab(9));
      }).not.toThrow();
    });
  });

  describe('updateFavicon', () => {
    const faviconOf = (env: ReturnType<typeof setUp>, id: number) =>
      part(element(env, id), '.favicon');

    it('shows the favicon once it has loaded', async () => {
      const env = setUp();
      env.nodes.make(tab(7));

      await env.nodes.updateFavicon(tab(7, { favIconUrl: 'https://a/i.png' }));

      expect(env.imageLoads).toHaveBeenCalledWith('https://a/i.png');
      expect(faviconOf(env, 7).style.backgroundImage).toBe(
        'url("https://a/i.png")',
      );
      expect(faviconOf(env, 7).classList.contains('visible')).toBe(true);
    });

    it('does not show it before it has loaded', async () => {
      const env = setUp();
      env.nodes.make(tab(7));
      let load: () => void = () => undefined;
      env.imageLoads.mockReturnValue(
        new Promise<void>((resolve) => {
          load = resolve;
        }),
      );

      const updating = env.nodes.updateFavicon(
        tab(7, { favIconUrl: 'https://a/i.png' }),
      );
      expect(faviconOf(env, 7).classList.contains('visible')).toBe(false);
      load();
      await updating;

      expect(faviconOf(env, 7).classList.contains('visible')).toBe(true);
    });

    it('hides it when it cannot be loaded', async () => {
      const env = setUp();
      env.nodes.make(tab(7));
      await env.nodes.updateFavicon(tab(7, { favIconUrl: 'https://a/i.png' }));
      env.imageLoads.mockRejectedValue(new Error('error'));

      await env.nodes.updateFavicon(
        tab(7, { favIconUrl: 'https://a/bad.png' }),
      );

      expect(faviconOf(env, 7).style.backgroundImage).toBe('');
      expect(faviconOf(env, 7).classList.contains('visible')).toBe(false);
    });

    it.each([
      ['no favicon', undefined],
      ['an empty favicon', ''],
      [
        'a picture of Firefox itself',
        'chrome://mozapps/skin/places/defaultFavicon.svg',
      ],
      ['the address of the page itself', 'https://site7/'],
    ])(
      'hides it, without loading anything, for %s',
      async (_name, favIconUrl) => {
        const env = setUp();
        env.nodes.make(tab(7));
        faviconOf(env, 7).classList.add('visible');

        await env.nodes.updateFavicon(tab(7, { favIconUrl }));

        expect(env.imageLoads).not.toHaveBeenCalled();
        expect(faviconOf(env, 7).classList.contains('visible')).toBe(false);
      },
    );

    it('shows a favicon whose address only starts like the skin of Firefox', async () => {
      const env = setUp();
      env.nodes.make(tab(7));

      await env.nodes.updateFavicon(
        tab(7, { favIconUrl: 'chrome://mozapps/other' }),
      );

      expect(env.imageLoads).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a tab it has no node for', async () => {
      const env = setUp();

      await env.nodes.updateFavicon(tab(9, { favIconUrl: 'https://a/i.png' }));

      expect(env.imageLoads).not.toHaveBeenCalled();
    });
  });

  describe('updateThumbnail', () => {
    const thumbnailOf = (env: ReturnType<typeof setUp>, id: number) =>
      part(element(env, id), '.thumbnail');

    it('shows the thumbnail given', async () => {
      const env = setUp();
      env.nodes.make(tab(7));

      await env.nodes.updateThumbnail(7, 'data:image/jpeg;base64,a');

      expect(thumbnailOf(env, 7).style.backgroundImage).toBe(
        'url("data:image/jpeg;base64,a")',
      );
    });

    it('shows the one that was kept when none is given', async () => {
      const env = setUp();
      env.nodes.make(tab(7));
      await env.viewState.setThumbnail(7, {
        image: 'data:kept',
        capturedAt: 1,
      });

      await env.nodes.updateThumbnail(7);

      expect(thumbnailOf(env, 7).style.backgroundImage).toBe(
        'url("data:kept")',
      );
    });

    it('does not look for a kept one when one is given', async () => {
      const env = setUp();
      env.nodes.make(tab(7));
      const thumbnail = vi.spyOn(env.viewState, 'thumbnail');

      await env.nodes.updateThumbnail(7, 'data:given');

      expect(thumbnail).not.toHaveBeenCalled();
    });

    it('shows none when none was kept, clearing what was shown', async () => {
      const env = setUp();
      env.nodes.make(tab(7));
      await env.nodes.updateThumbnail(7, 'data:old');

      await env.nodes.updateThumbnail(7);

      expect(thumbnailOf(env, 7).style.backgroundImage).toBe('');
    });

    it('shows none for an empty thumbnail', async () => {
      const env = setUp();
      env.nodes.make(tab(7));
      await env.nodes.updateThumbnail(7, 'data:old');

      await env.nodes.updateThumbnail(7, '');

      expect(thumbnailOf(env, 7).style.backgroundImage).toBe('');
    });

    it('does nothing for a tab it has no node for', async () => {
      const env = setUp();
      const thumbnail = vi.spyOn(env.viewState, 'thumbnail');

      await env.nodes.updateThumbnail(9);

      expect(thumbnail).not.toHaveBeenCalled();
    });
  });

  describe('selecting', () => {
    it('is none at first', () => {
      expect(setUp().nodes.selectedId()).toBe(-1);
    });

    it('marks one node as selected, and no other', () => {
      const env = setUp();
      [1, 2, 3].forEach((id) => {
        env.nodes.make(tab(id));
      });

      env.nodes.select(1);
      env.nodes.select(3);

      expect(env.nodes.selectedId()).toBe(3);
      expect(element(env, 1).classList.contains('selected')).toBe(false);
      expect(element(env, 2).classList.contains('selected')).toBe(false);
      expect(element(env, 3).classList.contains('selected')).toBe(true);
    });

    it('leaves the selection alone for a tab it has no node for', () => {
      const env = setUp();
      env.nodes.make(tab(1));
      env.nodes.select(1);

      env.nodes.select(9);

      expect(env.nodes.selectedId()).toBe(1);
      expect(element(env, 1).classList.contains('selected')).toBe(true);
    });

    it('selects the tab used most recently, other than the one given', async () => {
      const env = setUp();
      [1, 2, 3].forEach((id) => {
        env.nodes.make(tab(id));
      });

      await env.nodes.selectMostRecent(3);

      expect(env.nodes.selectedId()).toBe(2);
      expect(element(env, 2).classList.contains('selected')).toBe(true);
      expect(element(env, 3).classList.contains('selected')).toBe(false);
    });

    it('takes the first of tabs used at the same time', async () => {
      const env = setUp([
        tab(1, { lastAccessed: 5 }),
        tab(2, { lastAccessed: 5 }),
        tab(9, { lastAccessed: 50 }),
      ]);
      [1, 2, 9].forEach((id) => {
        env.nodes.make(tab(id));
      });

      await env.nodes.selectMostRecent(9);

      expect(env.nodes.selectedId()).toBe(1);
    });

    it('takes a tab that has no time, as the only one there is', async () => {
      const env = setUp([
        tab(1, { lastAccessed: 0 }),
        tab(9, { lastAccessed: 50 }),
      ]);
      [1, 9].forEach((id) => {
        env.nodes.make(tab(id));
      });

      await env.nodes.selectMostRecent(9);

      expect(env.nodes.selectedId()).toBe(1);
    });

    it('clears the mark from the tabs there are, even when none can be selected', async () => {
      const env = setUp([tab(1), tab(2)]);
      [1, 2].forEach((id) => {
        env.nodes.make(tab(id));
      });
      element(env, 1).classList.add('selected');
      element(env, 2).classList.add('selected');

      await env.nodes.selectMostRecent(1);
      await env.nodes.selectMostRecent(2);

      expect(element(env, 1).classList.contains('selected')).toBe(true);
      expect(element(env, 2).classList.contains('selected')).toBe(false);
    });

    it('selects nothing when the only tab is the one given', async () => {
      const env = setUp([tab(1)]);
      env.nodes.make(tab(1));

      await env.nodes.selectMostRecent(1);

      expect(env.nodes.selectedId()).toBe(-1);
      expect(element(env, 1).classList.contains('selected')).toBe(false);
    });

    it('selects nothing when the tab used most recently has no node', async () => {
      const env = setUp([tab(1), tab(2)]);
      env.nodes.make(tab(1));

      await env.nodes.selectMostRecent(9);

      expect(env.nodes.selectedId()).toBe(-1);
    });
  });

  describe('remove', () => {
    it('takes the node out of its place and forgets it', () => {
      const env = setUp();
      env.nodes.make(tab(7));
      const parent = document.createElement('div');
      parent.appendChild(element(env, 7));

      env.nodes.remove(7);

      expect(parent.children).toHaveLength(0);
      expect(env.nodes.elementOf(7)).toBeUndefined();
    });

    it('forgets a node that was never put anywhere', () => {
      const env = setUp();
      env.nodes.make(tab(7));

      env.nodes.remove(7);

      expect(env.nodes.elementOf(7)).toBeUndefined();
    });

    it('does nothing for a tab it has no node for', () => {
      const env = setUp();

      expect(() => {
        env.nodes.remove(9);
      }).not.toThrow();
    });

    it('can make the node again', () => {
      const env = setUp();
      env.nodes.make(tab(7));
      env.nodes.remove(7);

      env.nodes.make(tab(7));

      expect(env.nodes.elementOf(7)).toBeDefined();
    });
  });

  describe('init', () => {
    it('makes and fills in the node of every tab, and selects the one used last other than the view', async () => {
      const env = setUp([
        tab(1, {
          title: 'One',
          lastAccessed: 10,
          favIconUrl: 'https://a/i.png',
        }),
        tab(2, { title: 'Two', lastAccessed: 20, pinned: true }),
        tab(3, { title: 'View', lastAccessed: 30, discarded: true }),
      ]);
      await env.viewState.setThumbnail(1, { image: 'data:one', capturedAt: 1 });

      await env.nodes.init(3);

      expect(part(element(env, 1), '.name').textContent).toBe('One');
      expect(part(element(env, 2), '.name').textContent).toBe('Two');
      expect(element(env, 2).classList.contains('pinned')).toBe(true);
      expect(element(env, 3).classList.contains('inactive')).toBe(true);
      expect(
        part(element(env, 1), '.favicon').classList.contains('visible'),
      ).toBe(true);
      expect(part(element(env, 1), '.thumbnail').style.backgroundImage).toBe(
        'url("data:one")',
      );
      expect(env.nodes.selectedId()).toBe(2);
    });

    it('makes nothing for a window without tabs', async () => {
      const env = setUp([]);

      await env.nodes.init(1);

      expect(env.nodes.selectedId()).toBe(-1);
    });
  });
});

describe('view/leave-view.ts', () => {
  const setUpLeave = (pathname: string) => {
    const tabs = createMemoryViewTabs([tab(7)]);
    tabs.currentTabId = 7;
    const logger = { debug: vi.fn() };
    return {
      leave: createLeaveView({ tabs, pathname: () => pathname, logger }),
      tabs,
      logger,
    };
  };

  it('closes the tab the page is in, when the page is the view', async () => {
    const { leave, tabs } = setUpLeave('/view.html');

    await leave();

    expect(tabs.calls).toEqual(['close 7']);
  });

  it('closes it when the path has more in it than the view', async () => {
    const { leave, tabs } = setUpLeave('/ext/view.html/x');

    await leave();

    expect(tabs.calls).toEqual(['close 7']);
  });

  it('closes nothing when the page is another, such as the popup', async () => {
    const { leave, tabs } = setUpLeave('/popup-view/index.html');

    await leave();

    expect(tabs.calls).toEqual([]);
  });

  it('carries on, saying so, when the tab cannot be closed', async () => {
    const { leave, tabs, logger } = setUpLeave('/view.html');
    const failure = new Error('gone');
    tabs.close = () => Promise.reject(failure);

    await expect(leave()).resolves.toBeUndefined();

    expect(logger.debug).toHaveBeenCalledWith(
      'Could not close the view tab:',
      failure,
    );
  });
});
