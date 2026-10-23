// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryViewTabs } from '../../../src/js/adapters/memory/view-tabs.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { ViewTab } from '../../../src/js/ports/view-tabs.js';
import { createDrag } from '../../../src/js/view/drag.js';

const makeGroup = (id: number): Group => ({
  id,
  name: `G${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

const viewTab = (id: number, index: number): ViewTab => ({
  id,
  windowId: 1,
  index,
  title: `T${String(id)}`,
  url: undefined,
  favIconUrl: undefined,
  pinned: false,
  discarded: false,
  lastAccessed: 0,
});

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

interface FakeTransfer {
  effectAllowed: string;
  dropEffect: string;
  setData: ReturnType<typeof vi.fn>;
  setDragImage: ReturnType<typeof vi.fn>;
}

const transfer = (): FakeTransfer => ({
  effectAllowed: '',
  dropEffect: '',
  setData: vi.fn(),
  setDragImage: vi.fn(),
});

const isDragEvent = (event: MouseEvent): event is DragEvent =>
  'dataTransfer' in event;

/** A drag event of the type, with what is needed of the pointer and the transfer */
function dragEvent(
  type: string,
  options: {
    clientX?: number;
    clientY?: number;
    transfer?: FakeTransfer | null;
  } = {},
): DragEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
  });
  Object.defineProperty(event, 'dataTransfer', {
    value: options.transfer === undefined ? transfer() : options.transfer,
  });
  if (!isDragEvent(event)) {
    throw new Error('Not a drag event');
  }
  return event;
}

const boundsOf =
  (left: number, top: number, width: number, height: number) => () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) satisfies DOMRect;

function setUp() {
  const groupList = [makeGroup(1), makeGroup(2)];
  const created: Group[] = [];
  const groups = {
    getIds: () => groupList.map(({ id }) => id),
    get: (id: number) => groupList.find((each) => each.id === id) ?? null,
    create: vi.fn(() => {
      const next = makeGroup(7);
      created.push(next);
      return Promise.resolve(next);
    }),
  };
  const newTabs = new Map<number, HTMLElement>();
  const groupNodes = {
    make: vi.fn((made: Group) => {
      const element = document.createElement('div');
      element.className = 'group';
      const newtab = document.createElement('div');
      newtab.className = 'newtab';
      element.appendChild(newtab);
      newTabs.set(made.id, newtab);
      return element;
    }),
    newTabOf: (id: number) => newTabs.get(id),
    resize: vi.fn(),
    updateFit: vi.fn<(group: Group | null) => void>(),
    insertTab: vi.fn().mockResolvedValue(undefined),
  };
  const groupState = createMemoryGroupState();
  const tabs = createMemoryViewTabs([
    viewTab(10, 0),
    viewTab(11, 1),
    viewTab(12, 2),
  ]);
  const logger = { error: vi.fn() };
  const drag = createDrag({
    groups,
    groupNodes: () => groupNodes,
    groupState,
    tabs,
    windowId: () => 1,
    logger,
  });

  // Three tabs side by side in group 1, and the button for a new tab
  const content = document.createElement('div');
  content.setAttribute('groupId', '1');
  const elements = [10, 11, 12].map((id) => {
    const element = document.createElement('div');
    element.className = 'tab';
    element.setAttribute('tabId', String(id));
    element.getBoundingClientRect = boundsOf(100 * (id - 10), 20, 80, 60);
    element.addEventListener('dragstart', drag.tab.start);
    element.addEventListener('dragenter', drag.tab.enter);
    element.addEventListener('dragover', drag.tab.over);
    element.addEventListener('dragleave', drag.tab.leave);
    element.addEventListener('drop', drag.tab.drop);
    element.addEventListener('dragend', drag.tab.end);
    return element;
  });
  const newtab = document.createElement('div');
  newtab.className = 'newtab';
  newTabs.set(1, newtab);
  content.append(...elements, newtab);
  content.addEventListener('dragover', drag.group.over);
  content.addEventListener('drop', drag.group.drop);
  const page = document.createElement('div');
  page.append(content, drag.indicator);
  document.body.appendChild(page);
  const [a, b, c] = elements;
  if (a === undefined || b === undefined || c === undefined) {
    throw new Error('No tab elements');
  }

  return {
    drag,
    groups,
    groupNodes,
    groupState,
    tabs,
    logger,
    content,
    newtab,
    page,
    a,
    b,
    c,
    created,
  };
}

type Env = ReturnType<typeof setUp>;

const order = (env: Env): string[] =>
  Array.from(env.content.children).map(
    (child) => child.getAttribute('tabId') ?? child.className,
  );

let scrollIntoView = vi.fn();

describe('view/drag.ts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('the indicator', () => {
    it('is a div of its own, not shown at first', () => {
      const env = setUp();

      expect(env.drag.indicator.tagName).toBe('DIV');
      expect(env.drag.indicator.className).toBe('drag_indicator');
    });
  });

  describe('dragging a tab', () => {
    it('marks the tab as dragged, as a move of the page, with the tab at its middle as the image', () => {
      const env = setUp();
      const data = transfer();

      env.a.dispatchEvent(dragEvent('dragstart', { transfer: data }));

      expect(env.a.classList.contains('drag')).toBe(true);
      expect(data.effectAllowed).toBe('move');
      expect(data.setData).toHaveBeenCalledWith('text/html', 'pvDragging');
      expect(data.setDragImage).toHaveBeenCalledWith(env.a, 40, 30);
    });

    it('does not drag a pinned tab', () => {
      const env = setUp();
      env.a.classList.add('pinned');
      const data = transfer();
      const event = dragEvent('dragstart', { transfer: data });

      env.a.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(env.a.classList.contains('drag')).toBe(false);
      expect(data.setData).not.toHaveBeenCalled();
    });

    it('drags a tab with nothing to carry, and does not drag what is not a tab', () => {
      const env = setUp();

      env.a.dispatchEvent(dragEvent('dragstart', { transfer: null }));
      env.drag.tab.start(dragEvent('dragstart'));

      expect(env.a.classList.contains('drag')).toBe(true);
    });

    it('lets the user drop on another tab: ends with the mark gone and the drag cleared', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('dragenter'));
      env.b.dispatchEvent(dragEvent('dragover', { clientX: 100 + 10 }));
      expect(env.drag.indicator.classList.contains('show')).toBe(true);

      env.a.dispatchEvent(dragEvent('dragend'));

      expect(env.a.classList.contains('drag')).toBe(false);
      expect(env.drag.indicator.classList.contains('show')).toBe(false);
    });

    it('ends a drag when none was started', () => {
      const env = setUp();

      expect(() => {
        env.a.dispatchEvent(dragEvent('dragend'));
      }).not.toThrow();
    });
  });

  describe('dragging over a tab', () => {
    it('shows the mark before the tab when the pointer is in its first half', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      const entered = dragEvent('dragenter');
      env.b.dispatchEvent(entered);
      const data = transfer();

      const over = dragEvent('dragover', { clientX: 120, transfer: data });
      env.b.dispatchEvent(over);

      expect(entered.defaultPrevented).toBe(true);
      expect(over.defaultPrevented).toBe(true);
      expect(data.dropEffect).toBe('move');
      expect(env.drag.indicator.classList.contains('show')).toBe(true);
      expect(env.drag.indicator.style.left).toBe('95px');
      expect(env.drag.indicator.style.top).toBe('20px');
      expect(env.drag.indicator.style.height).toBe('52px');
    });

    it('shows the mark after the tab when the pointer is in its second half', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('dragenter'));

      env.b.dispatchEvent(dragEvent('dragover', { clientX: 150 }));

      expect(env.drag.indicator.style.left).toBe('175px');
    });

    it('adds how far the page is scrolled to the place of the mark', () => {
      const env = setUp();
      Object.defineProperty(window, 'scrollY', {
        value: 300,
        configurable: true,
      });
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('dragenter'));

      env.b.dispatchEvent(dragEvent('dragover', { clientX: 120 }));

      expect(env.drag.indicator.style.top).toBe('320px');
    });

    it('keeps the mark while the parts of the tab it is over are entered', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('dragenter'));
      env.b.dispatchEvent(dragEvent('dragover', { clientX: 120 }));

      env.b.dispatchEvent(dragEvent('dragenter'));

      expect(env.drag.indicator.classList.contains('show')).toBe(true);
    });

    it('takes a mark for another tab off when a tab is entered after a leave', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('dragenter'));
      env.b.dispatchEvent(dragEvent('dragover', { clientX: 120 }));
      env.drag.indicator.classList.add('show');
      env.b.dispatchEvent(dragEvent('dragleave'));
      env.drag.indicator.classList.add('show');

      env.c.dispatchEvent(dragEvent('dragenter'));

      expect(env.drag.indicator.classList.contains('show')).toBe(false);
    });

    it('allows a drop over a tab, as a move, without the group having to', () => {
      const env = setUp();
      const data = transfer();
      const event = dragEvent('dragover', { transfer: data });

      env.drag.tab.over(event);

      expect(event.defaultPrevented).toBe(true);
      expect(data.dropEffect).toBe('move');
    });

    it('shows no mark over the tab that is dragged', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.a.dispatchEvent(dragEvent('dragenter'));

      env.a.dispatchEvent(dragEvent('dragover', { clientX: 10 }));

      expect(env.drag.indicator.classList.contains('show')).toBe(false);
    });

    it('shows no mark when no tab has been entered', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));

      env.b.dispatchEvent(dragEvent('dragover', { clientX: 120 }));

      expect(env.drag.indicator.classList.contains('show')).toBe(false);
    });

    it('is not held up by there being nothing to carry', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('dragenter'));

      expect(() => {
        env.b.dispatchEvent(dragEvent('dragover', { transfer: null }));
      }).not.toThrow();
    });

    it('moves the mark on to the next tab entered, taking it off in between', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('dragenter'));
      env.b.dispatchEvent(dragEvent('dragover', { clientX: 120 }));
      expect(env.drag.indicator.classList.contains('show')).toBe(true);

      env.c.dispatchEvent(dragEvent('dragenter'));

      expect(env.drag.indicator.classList.contains('show')).toBe(false);
      env.c.dispatchEvent(dragEvent('dragover', { clientX: 220 }));
      expect(env.drag.indicator.style.left).toBe('195px');
    });

    it('keeps the tab it is over while its parts are entered and left', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('dragenter'));
      env.b.dispatchEvent(dragEvent('dragenter'));
      env.b.dispatchEvent(dragEvent('dragover', { clientX: 120 }));

      const left = dragEvent('dragleave');
      env.b.dispatchEvent(left);

      expect(left.defaultPrevented).toBe(true);
      expect(env.drag.indicator.classList.contains('show')).toBe(true);
    });

    it('forgets the tab, and takes the mark off, when the last part is left', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('dragenter'));
      env.b.dispatchEvent(dragEvent('dragover', { clientX: 120 }));

      env.b.dispatchEvent(dragEvent('dragleave'));
      env.b.dispatchEvent(dragEvent('dragover', { clientX: 120 }));

      expect(env.drag.indicator.classList.contains('show')).toBe(false);
    });

    it('starts again from no tab entered when a drag ends', () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('dragenter'));
      env.b.dispatchEvent(dragEvent('dragenter'));
      env.a.dispatchEvent(dragEvent('dragend'));

      env.a.dispatchEvent(dragEvent('dragstart'));
      env.c.dispatchEvent(dragEvent('dragenter'));
      env.c.dispatchEvent(dragEvent('dragover', { clientX: 220 }));

      expect(env.drag.indicator.style.left).toBe('195px');
    });

    it('ignores an entered tab that is not an element', () => {
      const env = setUp();

      expect(() => {
        env.drag.tab.enter(dragEvent('dragenter'));
      }).not.toThrow();
    });
  });

  describe('dropping on a tab', () => {
    const dragAndDrop = async (
      env: Env,
      target: HTMLElement,
      clientX: number,
    ) => {
      env.a.dispatchEvent(dragEvent('dragstart'));
      target.dispatchEvent(dragEvent('dragenter'));
      target.dispatchEvent(dragEvent('dragover', { clientX }));
      const drop = dragEvent('drop');
      target.dispatchEvent(drop);
      await settle();
      return drop;
    };

    it('puts the tab after the one it is dropped on when no pointer position was shown', async () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.c.dispatchEvent(dragEvent('dragenter'));

      env.c.dispatchEvent(dragEvent('drop'));
      await settle();

      expect(order(env)).toEqual(['11', '12', '10', 'newtab']);
    });

    it('puts the tab before the one it is dropped on, in its group, at its place in the window', async () => {
      const env = setUp();
      await env.groupState.setTabGroup(11, 1);
      await env.groupState.setTabGroup(10, 5);

      await dragAndDrop(env, env.c, 210);

      expect(order(env)).toEqual(['11', '10', '12', 'newtab']);
      expect(await env.groupState.getTabGroup(10)).toBe(5);
    });

    it('gives the tab the group of the one it is dropped on', async () => {
      const env = setUp();
      await env.groupState.setTabGroup(12, 3);

      await dragAndDrop(env, env.c, 210);

      expect(await env.groupState.getTabGroup(10)).toBe(3);
    });

    it('moves the tab in the window to just before the tab, going forward', async () => {
      const env = setUp();

      await dragAndDrop(env, env.c, 210);

      expect(env.tabs.calls).toEqual(['move 10 to 1']);
    });

    it('moves the tab in the window to just after the tab, going forward', async () => {
      const env = setUp();

      await dragAndDrop(env, env.c, 290);

      expect(env.tabs.calls).toEqual(['move 10 to 2']);
      expect(order(env)).toEqual(['11', '12', '10', 'newtab']);
    });

    it('moves the tab in the window to the tab before, going back', async () => {
      const env = setUp();
      env.c.dispatchEvent(dragEvent('dragstart'));
      env.a.dispatchEvent(dragEvent('dragenter'));
      env.a.dispatchEvent(dragEvent('dragover', { clientX: 10 }));

      env.a.dispatchEvent(dragEvent('drop'));
      await settle();

      expect(env.tabs.calls).toEqual(['move 12 to 0']);
      expect(order(env)).toEqual(['12', '10', '11', 'newtab']);
    });

    it('does not let the drop reach the page', async () => {
      const env = setUp();
      const reached = vi.fn();
      env.page.addEventListener('drop', reached);

      await dragAndDrop(env, env.c, 210);

      expect(reached).not.toHaveBeenCalled();
    });

    it('fits the tabs of every group again', async () => {
      const env = setUp();

      await dragAndDrop(env, env.c, 210);

      expect(
        env.groupNodes.updateFit.mock.calls.map((call) => call[0]?.id),
      ).toEqual([1, 2]);
    });

    it('does nothing when dropped on itself', async () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.a.dispatchEvent(dragEvent('dragenter'));

      env.a.dispatchEvent(dragEvent('drop'));
      await settle();

      expect(env.tabs.calls).toEqual([]);
      expect(order(env)).toEqual(['10', '11', '12', 'newtab']);
    });

    it('does nothing when dropped with no tab dragged or entered', async () => {
      const env = setUp();

      env.b.dispatchEvent(dragEvent('drop'));
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.b.dispatchEvent(dragEvent('drop'));
      await settle();

      expect(env.tabs.calls).toEqual([]);
    });

    it('keeps the group when the one it was dropped on has none', async () => {
      const env = setUp();
      await env.groupState.setTabGroup(10, 5);

      await dragAndDrop(env, env.c, 210);

      expect(await env.groupState.getTabGroup(10)).toBe(5);
    });

    it('says so when it fails', async () => {
      const env = setUp();
      const failure = new Error('gone');
      env.tabs.moveTo = () => Promise.reject(failure);

      await dragAndDrop(env, env.c, 210);

      expect(env.logger.error).toHaveBeenCalledWith(
        '[View] A drag handler failed:',
        failure,
      );
    });
  });

  describe('dropping in a group', () => {
    it('allows a drop over the group', () => {
      const env = setUp();
      const data = transfer();
      const event = dragEvent('dragover', { transfer: data });

      env.content.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(data.dropEffect).toBe('move');
    });

    it('allows a drop over the group with nothing to carry', () => {
      const env = setUp();

      expect(
        env.drag.group.over(dragEvent('dragover', { transfer: null })),
      ).toBe(false);
    });

    it('puts the tab last in the group, gives it the group, and moves it to the end of the window', async () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      const drop = dragEvent('drop');

      env.content.dispatchEvent(drop);
      await settle();

      expect(order(env)).toEqual(['11', '12', '10', 'newtab']);
      expect(await env.groupState.getTabGroup(10)).toBe(1);
      expect(env.tabs.calls).toEqual(['move 10 to -1']);
      expect(env.groupNodes.updateFit).toHaveBeenCalledTimes(2);
    });

    it('does not let the drop reach the page', async () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      const reached = vi.fn();
      env.page.addEventListener('drop', reached);

      env.content.dispatchEvent(dragEvent('drop'));
      await settle();

      expect(reached).not.toHaveBeenCalled();
    });

    it('does nothing when no tab is being dragged', async () => {
      const env = setUp();

      env.content.dispatchEvent(dragEvent('drop'));
      await settle();

      expect(env.tabs.calls).toEqual([]);
    });

    it('does nothing for a group that has no button for a new tab', async () => {
      const env = setUp();
      env.content.setAttribute('groupId', '9');
      env.a.dispatchEvent(dragEvent('dragstart'));

      env.content.dispatchEvent(dragEvent('drop'));
      await settle();

      expect(env.tabs.calls).toEqual([]);
    });

    it('does nothing when the drop is not on an element', async () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));

      env.drag.group.drop(dragEvent('drop'));
      await settle();

      expect(env.tabs.calls).toEqual([]);
    });
  });

  describe('dropping outside the groups', () => {
    it('makes a group for the tab where it was dropped, and puts the tab in it', async () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      const target = document.createElement('div');
      document.body.appendChild(target);
      const drop = dragEvent('drop', { clientX: 275, clientY: 175 });
      Object.defineProperty(drop, 'target', { value: target });

      env.drag.outsideDrop(drop);
      await settle();

      expect(env.groups.create).toHaveBeenCalledTimes(1);
      expect(env.created[0]?.rect.x).toBeCloseTo(200 / window.innerWidth, 10);
      expect(env.created[0]?.rect.y).toBeCloseTo(100 / window.innerHeight, 10);
      expect(env.created[0]?.rect.w).toBeCloseTo(150 / window.innerWidth, 10);
      expect(env.created[0]?.rect.h).toBeCloseTo(150 / window.innerHeight, 10);
      expect(target.querySelector('.group')).not.toBeNull();
      expect(env.groupNodes.resize).toHaveBeenCalledTimes(1);
      expect(await env.groupState.getTabGroup(10)).toBe(7);
      expect(env.tabs.calls).toEqual(['move 10 to -1']);
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
      });
    });

    it('does not let the drop reach the page', async () => {
      const env = setUp();
      const reached = vi.fn();
      env.page.addEventListener('drop', reached);
      const drop = dragEvent('drop');

      env.drag.outsideDrop(drop);
      await settle();

      expect(reached).not.toHaveBeenCalled();
    });

    it('keeps the drop from reaching what the page is in', async () => {
      const env = setUp();
      env.page.addEventListener('drop', env.drag.outsideDrop);
      const reached = vi.fn();
      document.body.addEventListener('drop', reached);

      env.page.dispatchEvent(dragEvent('drop'));
      await settle();

      expect(reached).not.toHaveBeenCalled();
    });

    it('still makes the group when the drop is not on a node', async () => {
      const env = setUp();
      env.a.dispatchEvent(dragEvent('dragstart'));
      const drop = dragEvent('drop');
      Object.defineProperty(drop, 'target', { value: null });

      env.drag.outsideDrop(drop);
      await settle();

      expect(env.groups.create).toHaveBeenCalledTimes(1);
    });

    it('says so when it fails', async () => {
      const env = setUp();
      const failure = new Error('no group');
      env.groups.create.mockRejectedValue(failure);

      env.drag.outsideDrop(dragEvent('drop'));
      await settle();

      expect(env.logger.error).toHaveBeenCalledWith(
        '[View] A drag handler failed:',
        failure,
      );
    });
  });

  describe('tabMoved', () => {
    it('shows a tab the browser moved, and fits every group again', async () => {
      const env = setUp();

      await env.drag.tabMoved(10, { windowId: 1 });

      expect(env.groupNodes.insertTab).toHaveBeenCalledWith(10);
      expect(env.groupNodes.updateFit).toHaveBeenCalledTimes(2);
    });

    it('ignores a tab moved in another window', async () => {
      const env = setUp();

      await env.drag.tabMoved(10, { windowId: 2 });

      expect(env.groupNodes.insertTab).not.toHaveBeenCalled();
    });

    it('ignores the moves it makes itself, and takes notice of later ones', async () => {
      const env = setUp();
      let finish: () => void = () => undefined;
      env.tabs.moveTo = () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        });
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.content.dispatchEvent(dragEvent('drop'));
      await settle();

      await env.drag.tabMoved(10, { windowId: 1 });
      expect(env.groupNodes.insertTab).not.toHaveBeenCalled();
      finish();
      await settle();
      await env.drag.tabMoved(10, { windowId: 1 });

      expect(env.groupNodes.insertTab).toHaveBeenCalledTimes(1);
    });

    it('takes notice of moves again after one of its own failed', async () => {
      const env = setUp();
      env.tabs.moveTo = () => Promise.reject(new Error('no'));
      env.a.dispatchEvent(dragEvent('dragstart'));
      env.content.dispatchEvent(dragEvent('drop'));
      await settle();

      await env.drag.tabMoved(10, { windowId: 1 });

      expect(env.groupNodes.insertTab).toHaveBeenCalledTimes(1);
    });
  });
});
