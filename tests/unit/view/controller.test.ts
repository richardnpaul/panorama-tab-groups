// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMessaging } from '../../../src/js/adapters/memory/messaging.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import { createMemoryViewState } from '../../../src/js/adapters/memory/view-state.js';
import { createMemoryViewTabs } from '../../../src/js/adapters/memory/view-tabs.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { ViewTab } from '../../../src/js/ports/view-tabs.js';
import { createViewController } from '../../../src/js/view/controller.js';

const WINDOW = 1;
const VIEW_TAB = 99;

const group = (id: number): Group => ({
  id,
  name: `G${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

const tab = (id: number, overrides: Partial<ViewTab> = {}): ViewTab => ({
  id,
  windowId: WINDOW,
  index: id,
  title: `Tab ${String(id)}`,
  url: undefined,
  favIconUrl: undefined,
  pinned: false,
  discarded: false,
  lastAccessed: 100,
  ...overrides,
});

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

interface Options {
  groups?: Group[];
  tabs?: ViewTab[];
  tabGroups?: Record<number, number>;
  hidden?: boolean;
  searchText?: string;
  viewport?: { width: number; height: number };
}

async function setUp({
  groups: initial = [group(1), group(2), group(3)],
  tabs: listed = [],
  tabGroups = {},
  hidden = false,
  searchText = '',
  viewport = { width: 1000, height: 500 },
}: Options = {}) {
  const groupList = initial;
  const groupCalls: string[] = [];
  const groups = {
    getIds: () => groupList.map(({ id }) => id),
    get: (id: number) => groupList.find((each) => each.id === id) ?? null,
    create: vi.fn(() => {
      const created = group(9);
      groupList.push(created);
      return Promise.resolve(created);
    }),
    transform: vi.fn((id: number, rect: Group['rect']) => {
      groupCalls.push(`transform ${String(id)} ${JSON.stringify(rect)}`);
      return Promise.resolve();
    }),
  };
  const shown: Record<number, number[]> = { 1: [10, 11], 2: [], 3: [30] };
  const content = (id: number) => shown[id] ?? [];
  const groupNodes = {
    make: vi.fn(() => document.createElement('div')),
    resize: vi.fn(),
    updateFit: vi.fn(),
    raise: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    insertTab: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    tabIdsOf: vi.fn((id: number) => content(id)),
  };
  let selected = -1;
  const tabNodes = {
    make: vi.fn(),
    update: vi.fn(),
    updateFavicon: vi.fn().mockResolvedValue(undefined),
    updateThumbnail: vi.fn().mockResolvedValue(undefined),
    select: vi.fn((id: number) => {
      selected = id;
    }),
    selectMostRecent: vi.fn().mockResolvedValue(undefined),
    selectedId: vi.fn(() => selected),
    remove: vi.fn(),
  };
  const viewTabs = createMemoryViewTabs(listed);
  const viewState = createMemoryViewState();
  const messaging = createMemoryMessaging();
  const groupState = createMemoryGroupState();
  await Promise.all(
    Object.entries(tabGroups).map(([id, groupId]) =>
      groupState.setTabGroup(Number(id), groupId),
    ),
  );
  const scheduler = createMemoryScheduler();
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const leaveView = vi.fn().mockResolvedValue(undefined);
  const shrinkImage = vi.fn((picture: string) =>
    Promise.resolve(`small:${picture}`),
  );
  const state = { hidden, searchText };
  const page = {
    isHidden: () => state.hidden,
    reload: vi.fn(),
    viewportSize: () => viewport,
    searchText: () => state.searchText,
  };
  const groupsNode = document.createElement('div');
  const controller = createViewController({
    tabs: viewTabs,
    viewState,
    messaging,
    groupState,
    groups,
    groupNodes,
    tabNodes,
    leaveView,
    shrinkImage,
    scheduler,
    clock: createMemoryClock(5000),
    logger,
    windowId: WINDOW,
    viewTabId: VIEW_TAB,
    groupsNode,
    page,
  });
  return {
    controller,
    groups,
    groupCalls,
    groupNodes,
    tabNodes,
    viewTabs,
    viewState,
    messaging,
    groupState,
    scheduler,
    logger,
    leaveView,
    shrinkImage,
    page,
    state,
    groupsNode,
    select: (id: number) => {
      selected = id;
    },
  };
}

type Env = Awaited<ReturnType<typeof setUp>>;

let scrollIntoView = vi.fn();

describe('view/controller.ts', () => {
  beforeEach(() => {
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('setLayoutMode', () => {
    it('stores the layout mode of the window', async () => {
      const env = await setUp();

      await env.controller.setLayoutMode('tiling');

      expect(await env.viewState.layoutMode(WINDOW)).toBe('tiling');
    });

    it('places the groups as they are, for the free layout', async () => {
      const env = await setUp();

      await env.controller.setLayoutMode('freeform');

      expect(await env.viewState.layoutMode(WINDOW)).toBe('freeform');
      expect(env.groupNodes.resize).toHaveBeenCalledTimes(1);
      expect(env.groupNodes.resize).toHaveBeenCalledWith();
      expect(env.groups.transform).not.toHaveBeenCalled();
    });

    it('tiles the groups, storing and showing the rect of each', async () => {
      const env = await setUp();

      await env.controller.setLayoutMode('tiling');

      expect(env.groupCalls).toEqual([
        `transform 1 ${JSON.stringify({ x: 0, y: 0, w: 0.5, h: 0.5 })}`,
        `transform 2 ${JSON.stringify({ x: 0.5, y: 0, w: 0.5, h: 0.5 })}`,
        `transform 3 ${JSON.stringify({ x: 0, y: 0.5, w: 1, h: 0.5 })}`,
      ]);
      expect(env.groupNodes.resize).toHaveBeenCalledTimes(3);
      expect(env.groupNodes.resize).toHaveBeenCalledWith(2, {
        x: 0.5,
        y: 0,
        w: 0.5,
        h: 0.5,
      });
    });

    it('stores the mode before it places anything', async () => {
      const env = await setUp();
      const order: string[] = [];
      const set = env.viewState.setLayoutMode.bind(env.viewState);
      env.viewState.setLayoutMode = async (windowId, mode) => {
        order.push('mode');
        await set(windowId, mode);
      };
      env.groups.transform.mockImplementation(() => {
        order.push('transform');
        return Promise.resolve();
      });

      await env.controller.setLayoutMode('tiling');

      expect(order[0]).toBe('mode');
    });

    it('tiles nothing for a window with no groups', async () => {
      const env = await setUp({ groups: [] });

      await env.controller.setLayoutMode('tiling');

      expect(env.groups.transform).not.toHaveBeenCalled();
    });
  });

  describe('captureThumbnails', () => {
    it('takes a picture of a tab that has none, shrinks it, shows it and keeps it with the time', async () => {
      const env = await setUp({ tabs: [tab(10)] });
      env.viewTabs.captures.set(10, 'data:big');

      await env.controller.captureThumbnails();

      expect(env.shrinkImage).toHaveBeenCalledWith('data:big');
      expect(env.tabNodes.updateThumbnail).toHaveBeenCalledWith(
        10,
        'small:data:big',
      );
      expect(await env.viewState.thumbnail(10)).toEqual({
        image: 'small:data:big',
        capturedAt: 5000,
      });
    });

    it('takes a new picture when the tab was used since the last', async () => {
      const env = await setUp({ tabs: [tab(10, { lastAccessed: 200 })] });
      await env.viewState.setThumbnail(10, { image: 'old', capturedAt: 100 });
      env.viewTabs.captures.set(10, 'data:new');

      await env.controller.captureThumbnails();

      expect((await env.viewState.thumbnail(10))?.image).toBe('small:data:new');
    });

    it('keeps the picture when it was taken after the tab was last used, or at that time', async () => {
      const env = await setUp({
        tabs: [tab(10, { lastAccessed: 100 }), tab(11, { lastAccessed: 100 })],
      });
      await env.viewState.setThumbnail(10, { image: 'a', capturedAt: 100 });
      await env.viewState.setThumbnail(11, { image: 'b', capturedAt: 300 });
      env.viewTabs.captures.set(10, 'data:x');
      env.viewTabs.captures.set(11, 'data:y');

      await env.controller.captureThumbnails();

      expect(env.shrinkImage).not.toHaveBeenCalled();
      expect((await env.viewState.thumbnail(10))?.image).toBe('a');
    });

    it('takes a new picture when the old one has no time', async () => {
      const env = await setUp({ tabs: [tab(10, { lastAccessed: 0 })] });
      await env.viewState.setThumbnail(10, {
        image: 'old',
        capturedAt: undefined,
      });
      env.viewTabs.captures.set(10, 'data:new');

      await env.controller.captureThumbnails();

      expect((await env.viewState.thumbnail(10))?.image).toBe('small:data:new');
    });

    it('does nothing for a tab the browser cannot take a picture of', async () => {
      const env = await setUp({ tabs: [tab(10)] });

      await env.controller.captureThumbnails();

      expect(env.shrinkImage).not.toHaveBeenCalled();
      expect(await env.viewState.thumbnail(10)).toBeUndefined();
    });

    it('does every tab of the window', async () => {
      const env = await setUp({ tabs: [tab(10), tab(11), tab(12)] });
      [10, 11, 12].forEach((id) => {
        env.viewTabs.captures.set(id, `data:${String(id)}`);
      });

      await env.controller.captureThumbnails();

      expect(env.shrinkImage).toHaveBeenCalledTimes(3);
    });
  });

  describe('createGroup', () => {
    it('makes a group 150 pixels square at the corner by default, and shows it', async () => {
      const env = await setUp();

      await env.controller.createGroup();

      const created = env.groups.create.mock.results.length;
      expect(created).toBe(1);
      const made = env.groupNodes.make.mock.calls[0];
      expect(made).toBeDefined();
      expect(env.groupsNode.children).toHaveLength(1);
      expect(env.groupNodes.resize).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
      });
    });

    it('puts the group where it is asked, as fractions of the window', async () => {
      const env = await setUp({ viewport: { width: 1000, height: 500 } });

      await env.controller.createGroup({ x: 275, y: 175 });

      const [made] = env.groups.getIds().slice(-1);
      expect(made).toBe(9);
      expect(env.groups.get(9)?.rect).toEqual({
        x: 0.2,
        y: 0.2,
        w: 0.15,
        h: 0.3,
      });
    });

    it('puts the first group at 75 pixels from the corner unless told otherwise', async () => {
      const env = await setUp({ viewport: { width: 1000, height: 500 } });

      await env.controller.createGroup();

      expect(env.groups.get(9)?.rect).toEqual({ x: 0, y: 0, w: 0.15, h: 0.3 });
    });
  });

  describe('search', () => {
    it('selects the last tab that has the text in its title', async () => {
      const env = await setUp({
        tabs: [
          tab(10, { title: 'Alpha' }),
          tab(11, { title: 'alpha two' }),
          tab(12, { title: 'Beta' }),
        ],
        searchText: 'ALPHA',
      });

      await env.controller.search();

      expect(env.tabNodes.select).toHaveBeenCalledWith(11);
    });

    it('keeps the selection when nothing matches', async () => {
      const env = await setUp({
        tabs: [tab(10, { title: 'Alpha' })],
        searchText: 'zzz',
      });
      env.select(10);

      await env.controller.search();

      expect(env.tabNodes.select).toHaveBeenCalledWith(10);
    });
  });

  describe('keyDown', () => {
    it('moves the selection to the next tab with the right arrow', async () => {
      const env = await setUp();
      env.select(10);

      await env.controller.keyDown({ key: 'ArrowRight' });

      expect(env.tabNodes.select).toHaveBeenCalledWith(11);
    });

    it('goes to the next group that has tabs, past the end of a group', async () => {
      const env = await setUp();
      env.select(11);

      await env.controller.keyDown({ key: 'ArrowRight' });

      expect(env.tabNodes.select).toHaveBeenCalledWith(30);
    });

    it('moves the selection to the previous tab with the left arrow', async () => {
      const env = await setUp();
      env.select(11);

      await env.controller.keyDown({ key: 'ArrowLeft' });

      expect(env.tabNodes.select).toHaveBeenCalledWith(10);
    });

    it('goes round to the last tab from the first', async () => {
      const env = await setUp();
      env.select(10);

      await env.controller.keyDown({ key: 'ArrowLeft' });

      expect(env.tabNodes.select).toHaveBeenCalledWith(30);
    });

    it('does not move when the selected tab is in no group', async () => {
      const env = await setUp();
      env.select(77);

      await env.controller.keyDown({ key: 'ArrowRight' });

      expect(env.tabNodes.select).not.toHaveBeenCalled();
    });

    it('goes to the selected tab with Enter, and leaves the view', async () => {
      const env = await setUp();
      env.select(10);
      const order: string[] = [];
      env.viewTabs.activate = (id) => {
        order.push(`activate ${String(id)}`);
        return Promise.resolve();
      };
      env.leaveView.mockImplementation(() => {
        order.push('leave');
        return Promise.resolve();
      });

      await env.controller.keyDown({ key: 'Enter' });

      expect(order).toEqual(['activate 10', 'leave']);
    });

    it('goes to the tab 0 with Enter', async () => {
      const env = await setUp();
      env.select(0);

      await env.controller.keyDown({ key: 'Enter' });

      expect(env.viewTabs.calls).toEqual(['activate 0']);
    });

    it('does nothing with Enter when no tab is selected', async () => {
      const env = await setUp();

      await env.controller.keyDown({ key: 'Enter' });

      expect(env.viewTabs.calls).toEqual([]);
      expect(env.leaveView).not.toHaveBeenCalled();
    });

    it('does nothing for other keys', async () => {
      const env = await setUp();
      env.select(10);

      await env.controller.keyDown({ key: 'a' });
      await env.controller.keyDown({ key: 'ArrowUp' });

      expect(env.tabNodes.select).not.toHaveBeenCalled();
      expect(env.viewTabs.calls).toEqual([]);
    });
  });

  describe('tabCreated', () => {
    it('makes and fills in the node of a tab of the window, and puts it in its group', async () => {
      const env = await setUp({ tabGroups: { 20: 1 } });

      await env.controller.tabCreated(tab(20));

      expect(env.tabNodes.make).toHaveBeenCalledWith(tab(20));
      expect(env.tabNodes.update).toHaveBeenCalledWith(tab(20));
      expect(env.tabNodes.updateFavicon).toHaveBeenCalledWith(tab(20));
      expect(env.groupNodes.insertTab).toHaveBeenCalledWith(20);
      expect(env.groupNodes.updateFit).toHaveBeenCalledWith(group(1));
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[View] tabCreated: Adding tab 20 to group 1 in view',
      );
    });

    it('ignores a tab of another window', async () => {
      const env = await setUp({ tabGroups: { 20: 1 } });

      await env.controller.tabCreated(tab(20, { windowId: 2 }));

      expect(env.tabNodes.make).not.toHaveBeenCalled();
      expect(env.groupNodes.insertTab).not.toHaveBeenCalled();
    });

    it('waits for the background to give the tab a group, looking again every tenth of a second', async () => {
      const env = await setUp();
      const created = env.controller.tabCreated(tab(20));
      await settle();

      expect(env.groupNodes.insertTab).not.toHaveBeenCalled();
      await env.groupState.setTabGroup(20, 2);
      env.scheduler.advance(100);
      await created;

      expect(env.groupNodes.insertTab).toHaveBeenCalledWith(20);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[View] tabCreated: No group yet for tab 20, retrying (attempt 1/20)...',
      );
    });

    it('waits for a group the view does not have yet', async () => {
      const env = await setUp({ tabGroups: { 20: 8 } });
      const created = env.controller.tabCreated(tab(20));
      await settle();

      env.scheduler.advance(100);
      await settle();
      expect(env.groupNodes.insertTab).not.toHaveBeenCalled();
      env.groups.getIds();
      await env.groupState.setTabGroup(20, 3);
      env.scheduler.advance(100);
      await created;

      expect(env.groupNodes.insertTab).toHaveBeenCalledWith(20);
    });

    it('gives up after twenty lookups, with a warning', async () => {
      const env = await setUp({ tabGroups: { 20: 8 } });
      const created = env.controller.tabCreated(tab(20));
      await settle();

      await Array.from({ length: 20 }).reduce<Promise<void>>(
        async (previous) => {
          await previous;
          env.scheduler.advance(100);
          await settle();
        },
        Promise.resolve(),
      );
      await created;

      expect(env.groupNodes.insertTab).not.toHaveBeenCalled();
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[View] tabCreated: Skipping tab 20 - its group 8 not found in view',
      );
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[View] tabCreated: No group yet for tab 20, retrying (attempt 20/20)...',
      );
      expect(env.scheduler.pending()).toBe(0);
    });

    it('makes the node once, however long it waits', async () => {
      const env = await setUp({ tabGroups: { 20: 8 } });
      const created = env.controller.tabCreated(tab(20));
      await settle();
      env.scheduler.advance(300);
      await settle();
      await env.groupState.setTabGroup(20, 1);
      env.scheduler.advance(100);
      await settle();
      env.scheduler.advance(100);
      await created;

      expect(env.tabNodes.make).toHaveBeenCalledTimes(1);
    });
  });

  describe('tabRemoved', () => {
    it('takes away the node of a tab of the window, and fits every group again', async () => {
      const env = await setUp();

      env.controller.tabRemoved(20, { windowId: WINDOW });

      expect(env.tabNodes.remove).toHaveBeenCalledWith(20);
      expect(env.groupNodes.updateFit).toHaveBeenCalledTimes(3);
    });

    it('ignores a tab of another window', async () => {
      const env = await setUp();

      env.controller.tabRemoved(20, { windowId: 2 });

      expect(env.tabNodes.remove).not.toHaveBeenCalled();
    });

    it('ignores the tab the view is in', async () => {
      const env = await setUp();

      env.controller.tabRemoved(VIEW_TAB, { windowId: WINDOW });

      expect(env.tabNodes.remove).not.toHaveBeenCalled();
    });
  });

  describe('tabUpdated', () => {
    it('updates the node and the favicon', async () => {
      const env = await setUp();

      await env.controller.tabUpdated(20, { title: 'x' }, tab(20));

      expect(env.tabNodes.update).toHaveBeenCalledWith(tab(20));
      expect(env.tabNodes.updateFavicon).toHaveBeenCalledWith(tab(20));
      expect(env.page.reload).not.toHaveBeenCalled();
      expect(env.groupNodes.fill).not.toHaveBeenCalled();
    });

    it('reloads the page when a tab was pinned or unpinned, after filling the groups again', async () => {
      const env = await setUp();

      await env.controller.tabUpdated(
        20,
        { pinned: true },
        tab(20, { pinned: true }),
      );

      expect(env.page.reload).toHaveBeenCalledTimes(1);
      expect(env.groupNodes.fill).toHaveBeenCalledTimes(1);
      expect(env.tabNodes.update).toHaveBeenCalledTimes(2);
    });

    it('reloads the page when the pinned tab was unpinned, as it says pinned: false', async () => {
      const env = await setUp();

      await env.controller.tabUpdated(20, { pinned: false }, tab(20));

      expect(env.page.reload).toHaveBeenCalledTimes(1);
    });

    it('waits to reload the page until it is shown again, while it is hidden', async () => {
      const env = await setUp({ hidden: true });
      env.messaging.reply({});

      await env.controller.tabUpdated(20, { pinned: true }, tab(20));
      expect(env.page.reload).not.toHaveBeenCalled();
      expect(env.groupNodes.fill).toHaveBeenCalledTimes(1);

      env.state.hidden = false;
      await env.controller.visibilityChanged();

      expect(env.page.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('tabAttached and tabDetached', () => {
    it('shows a tab moved into the window like a new one', async () => {
      const env = await setUp({ tabs: [tab(20)], tabGroups: { 20: 1 } });

      await env.controller.tabAttached(20, { newWindowId: WINDOW });

      expect(env.tabNodes.make).toHaveBeenCalledWith(tab(20));
      expect(env.groupNodes.insertTab).toHaveBeenCalledWith(20);
    });

    it('ignores a tab moved into another window', async () => {
      const env = await setUp({ tabs: [tab(20)] });

      await env.controller.tabAttached(20, { newWindowId: 2 });

      expect(env.tabNodes.make).not.toHaveBeenCalled();
    });

    it('takes away the node of a tab moved out of the window, and fits every group again', async () => {
      const env = await setUp();

      env.controller.tabDetached(20, { oldWindowId: WINDOW });

      expect(env.tabNodes.remove).toHaveBeenCalledWith(20);
      expect(env.groupNodes.updateFit).toHaveBeenCalledTimes(3);
    });

    it('ignores a tab moved out of another window', async () => {
      const env = await setUp();

      env.controller.tabDetached(20, { oldWindowId: 2 });

      expect(env.tabNodes.remove).not.toHaveBeenCalled();
    });
  });

  describe('clicks on the groups', () => {
    const contentElement = (groupId: number): HTMLElement => {
      const element = document.createElement('div');
      element.className = 'content transition';
      element.setAttribute('groupId', String(groupId));
      return element;
    };

    const click = (
      type: string,
      target: HTMLElement,
      options: MouseEventInit = {},
    ): MouseEvent => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        ...options,
      });
      target.dispatchEvent(event);
      return event;
    };

    it('closes a group that is double clicked in its content', async () => {
      const env = await setUp();
      const target = contentElement(2);
      let seen: MouseEvent | undefined;
      target.addEventListener('dblclick', (event) => {
        if (event instanceof MouseEvent) {
          seen = event;
        }
      });
      click('dblclick', target);

      await env.controller.doubleClick(seen ?? new MouseEvent('dblclick'));

      expect(env.groupNodes.close).toHaveBeenCalledWith(group(2));
    });

    it('does nothing for a double click in the content of a group that is gone', async () => {
      const env = await setUp();
      const target = contentElement(8);
      let seen: MouseEvent | undefined;
      target.addEventListener('dblclick', (event) => {
        if (event instanceof MouseEvent) {
          seen = event;
        }
      });
      click('dblclick', target);

      await env.controller.doubleClick(seen ?? new MouseEvent('dblclick'));

      expect(env.groupNodes.close).not.toHaveBeenCalled();
    });

    it('makes a group where the page behind the groups is double clicked', async () => {
      const env = await setUp({ viewport: { width: 1000, height: 500 } });
      const target = document.createElement('div');
      target.id = 'groups';
      let seen: MouseEvent | undefined;
      target.addEventListener('dblclick', (event) => {
        if (event instanceof MouseEvent) {
          seen = event;
        }
      });
      click('dblclick', target, { clientX: 275, clientY: 175 });

      await env.controller.doubleClick(seen ?? new MouseEvent('dblclick'));

      expect(env.groups.get(9)?.rect).toEqual({
        x: 0.2,
        y: 0.2,
        w: 0.15,
        h: 0.3,
      });
    });

    it('does nothing for a double click elsewhere', async () => {
      const env = await setUp();
      const target = document.createElement('div');
      let seen: MouseEvent | undefined;
      target.addEventListener('dblclick', (event) => {
        if (event instanceof MouseEvent) {
          seen = event;
        }
      });
      click('dblclick', target);

      await env.controller.doubleClick(seen ?? new MouseEvent('dblclick'));

      expect(env.groupNodes.close).not.toHaveBeenCalled();
      expect(env.groups.create).not.toHaveBeenCalled();
    });

    it('does nothing for a double click that is on no element', async () => {
      const env = await setUp();

      await env.controller.doubleClick(new MouseEvent('dblclick'));

      expect(env.groupNodes.close).not.toHaveBeenCalled();
      expect(env.groups.create).not.toHaveBeenCalled();
    });

    it('does not take an element that only has one of the classes of the content', async () => {
      const env = await setUp();
      const target = contentElement(2);
      target.className = 'content';
      let seen: MouseEvent | undefined;
      target.addEventListener('dblclick', (event) => {
        if (event instanceof MouseEvent) {
          seen = event;
        }
      });
      click('dblclick', target);

      await env.controller.doubleClick(seen ?? new MouseEvent('dblclick'));

      expect(env.groupNodes.close).not.toHaveBeenCalled();
    });

    it('brings a group in front when its content is clicked', async () => {
      const env = await setUp();
      const target = contentElement(3);
      const outer = document.createElement('div');
      const reached = vi.fn();
      outer.addEventListener('click', reached);
      outer.appendChild(target);
      target.addEventListener('click', (event) => {
        env.controller.singleClick(
          event instanceof MouseEvent ? event : new MouseEvent('click'),
        );
      });

      click('click', target);

      expect(env.groupNodes.raise).toHaveBeenCalledWith(3);
      expect(reached).not.toHaveBeenCalled();
    });

    it('does not bring a group in front when something else is clicked, but still stops the click', async () => {
      const env = await setUp();
      const target = document.createElement('div');
      const outer = document.createElement('div');
      const reached = vi.fn();
      outer.addEventListener('click', reached);
      outer.appendChild(target);
      target.addEventListener('click', (event) => {
        env.controller.singleClick(
          event instanceof MouseEvent ? event : new MouseEvent('click'),
        );
      });

      click('click', target);

      expect(env.groupNodes.raise).not.toHaveBeenCalled();
      expect(reached).not.toHaveBeenCalled();
    });
  });

  describe('visibilityChanged', () => {
    const answer = (env: Env, value: unknown) => {
      env.messaging.reply(value);
    };

    it('does nothing while the page is hidden', async () => {
      const env = await setUp({ hidden: true });

      await env.controller.visibilityChanged();

      expect(env.messaging.sent).toEqual([]);
    });

    it('reloads the page when the background says the view is out of date, and says it has', async () => {
      const env = await setUp();
      answer(env, { viewRefreshOrdered: true });

      await env.controller.visibilityChanged();

      expect(env.messaging.sent).toEqual([
        { action: 'checkViewRefresh' },
        { action: 'clearViewRefresh' },
      ]);
      expect(env.page.reload).toHaveBeenCalledTimes(1);
      expect(env.tabNodes.selectMostRecent).not.toHaveBeenCalled();
    });

    it.each([
      [{}],
      [{ viewRefreshOrdered: false }],
      [{ viewRefreshOrdered: 'yes' }],
      [undefined],
      [null],
      ['no'],
    ])('does not reload the page for the answer %j', async (value) => {
      const env = await setUp();
      answer(env, value);

      await env.controller.visibilityChanged();

      expect(env.page.reload).not.toHaveBeenCalled();
      expect(env.messaging.sent).toEqual([{ action: 'checkViewRefresh' }]);
    });

    it('selects the tab used last and takes pictures of the tabs, when nothing is out of date', async () => {
      const env = await setUp({ tabs: [tab(10)] });
      env.viewTabs.captures.set(10, 'data:x');
      answer(env, {});

      await env.controller.visibilityChanged();

      expect(env.tabNodes.selectMostRecent).toHaveBeenCalledWith(VIEW_TAB);
      expect(env.shrinkImage).toHaveBeenCalledTimes(1);
    });
  });
});
