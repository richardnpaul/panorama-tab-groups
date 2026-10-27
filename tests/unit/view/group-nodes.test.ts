// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExclusively } from '../../../src/js/adapters/browser/exclusive.js';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryViewTabs } from '../../../src/js/adapters/memory/view-tabs.js';
import type { Group, Rect } from '../../../src/js/ports/group-state.js';
import type { LayoutMode } from '../../../src/js/ports/view-state.js';
import type { ViewTab } from '../../../src/js/ports/view-tabs.js';
import {
  createGroupNodes,
  type GroupsApi,
} from '../../../src/js/view/group-nodes.js';

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

const group = (id: number, overrides: Partial<Group> = {}): Group => ({
  id,
  name: `Group ${String(id)}`,
  containerId: 'firefox-default',
  rect: rect(0.2, 0.2, 0.4, 0.4),
  ...overrides,
});

const tab = (id: number, overrides: Partial<ViewTab> = {}): ViewTab => ({
  id,
  windowId: 1,
  index: id,
  title: `Tab ${String(id)}`,
  url: undefined,
  favIconUrl: undefined,
  pinned: false,
  discarded: false,
  lastAccessed: 0,
  ...overrides,
});

const boundsOf = (width: number, height: number) => () =>
  ({
    width,
    height,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) satisfies DOMRect;

function fakeGroups(initial: Group[]) {
  const list = initial;
  const calls: string[] = [];
  const api: GroupsApi & { calls: string[]; list: Group[] } = {
    calls,
    list,
    getIds: () => list.map(({ id }) => id),
    get: (id) => list.find((each) => each.id === id) ?? null,
    forEach: (callback) => {
      list.forEach(callback);
    },
    remove: (id) => {
      calls.push(`remove ${String(id)}`);
      const index = list.findIndex((each) => each.id === id);
      if (index !== -1) {
        list.splice(index, 1);
      }
      return Promise.resolve();
    },
    rename: (id, name) => {
      calls.push(`rename ${String(id)} ${name}`);
      return Promise.resolve();
    },
    transform: (id, next) => {
      calls.push(`transform ${String(id)} ${JSON.stringify(next)}`);
      return Promise.resolve();
    },
    setActive: (id) => {
      calls.push(`setActive ${String(id)}`);
      return Promise.resolve();
    },
  };
  return api;
}

interface Options {
  groups?: Group[];
  tabs?: ViewTab[];
  tabGroups?: Record<number, number>;
  layoutMode?: LayoutMode | undefined;
  confirmed?: boolean;
  pluralRule?: string;
  // What the question before closing a group says, in all its forms
  question?: string;
}

async function setUp({
  groups: initial = [group(1), group(2)],
  tabs: listed = [],
  tabGroups = {},
  confirmed = true,
  pluralRule = '0',
  question,
  ...rest
}: Options = {}) {
  // Given as undefined, the layout mode means it was never stored
  const layoutMode = 'layoutMode' in rest ? rest.layoutMode : 'freeform';
  const groups = fakeGroups(initial);
  const viewTabs = createMemoryViewTabs(listed);
  const groupState = createMemoryGroupState();
  await Promise.all(
    Object.entries(tabGroups).map(([id, groupId]) =>
      groupState.setTabGroup(Number(id), groupId),
    ),
  );
  const elements = new Map<number, HTMLElement>();
  listed.forEach((each) => {
    const element = document.createElement('div');
    element.className = 'tab';
    element.setAttribute('tabId', String(each.id));
    elements.set(each.id, element);
  });
  const drag = {
    over: vi.fn().mockReturnValue(false),
    drop: vi.fn(),
  };
  const confirm = vi.fn().mockReturnValue(confirmed);
  const leaveView = vi.fn().mockResolvedValue(undefined);
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const getMessage = vi.fn(
    (name: string, substitutions?: readonly string[]) => {
      if (name === 'pluralRule') {
        return pluralRule;
      }
      if (name === 'closeGroupWarning' && question !== undefined) {
        return question;
      }
      return `[${name}${substitutions ? `:${substitutions.join(',')}` : ''}]`;
    },
  );
  const nodes = createGroupNodes({
    groups,
    tabs: viewTabs,
    groupState,
    tabNodes: { elementOf: (id) => elements.get(id) },
    drag,
    i18n: { getMessage },
    clock: createMemoryClock(1_700_000_123_456),
    confirm,
    leaveView,
    layoutMode: () => Promise.resolve(layoutMode),
    exclusively: createExclusively(undefined),
    logger,
  });

  const groupsNode = document.createElement('div');
  groupsNode.getBoundingClientRect = boundsOf(1000, 500);
  const pinned = document.createElement('div');
  document.body.append(groupsNode, pinned);

  return {
    nodes,
    groups,
    groupState,
    viewTabs,
    drag,
    confirm,
    leaveView,
    logger,
    elements,
    groupsNode,
    pinned,
    getMessage,
  };
}

type Env = Awaited<ReturnType<typeof setUp>>;

const part = (root: Element, selector: string): HTMLElement => {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`No ${selector}`);
  }
  return found;
};

const inputOf = (root: Element): HTMLInputElement => {
  const found = root.querySelector('input');
  if (!(found instanceof HTMLInputElement)) {
    throw new Error('No input');
  }
  return found;
};

// The rect a `transform` call was made with
const storedRect = (call: string | undefined): Rect => {
  const parsed: unknown = JSON.parse(
    (call ?? '').replace(/^transform \d+ /u, ''),
  );
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('x' in parsed && 'y' in parsed && 'w' in parsed && 'h' in parsed) ||
    typeof parsed.x !== 'number' ||
    typeof parsed.y !== 'number' ||
    typeof parsed.w !== 'number' ||
    typeof parsed.h !== 'number'
  ) {
    throw new Error(`Not a rect: ${call ?? 'nothing'}`);
  }
  return { x: parsed.x, y: parsed.y, w: parsed.w, h: parsed.h };
};

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

// A tab by its id, and the button for a new tab as 'newtab'
const labelOf = (child: Element): string =>
  child.classList.contains('newtab')
    ? 'newtab'
    : (child.getAttribute('tabId') ?? '?');

const dragEvent = (type: string): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: null });
  return event;
};

describe('view/group-nodes.ts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute('style');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('make', () => {
    it('makes a group node with an inner part of edges, corners, a header and a content', async () => {
      const env = await setUp();

      const node = env.nodes.make(group(1));

      expect(node.className).toBe('group');
      const inner = part(node, ':scope > .inner');
      expect(
        Array.from(inner.children).map((child) => child.className),
      ).toEqual([
        'top',
        'right',
        'bottom',
        'left',
        'topRight',
        'bottomRight',
        'bottomLeft',
        'topLeft',
        'header',
        'content transition',
      ]);
    });

    it('puts the name, an input, a spacer, the number, the count and a close button in the header', async () => {
      const env = await setUp();

      const node = env.nodes.make(group(4, { name: 'Work' }));

      const header = part(node, '.header');
      expect(header.title).toBe('[dragGroup]');
      expect(
        Array.from(header.children).map(
          (child) => child.className || child.tagName,
        ),
      ).toEqual(['name', 'INPUT', 'spacer', 'group_id', 'tab_count', 'close']);
      expect(part(header, '.name').textContent).toBe('Work');
      expect(inputOf(header).value).toBe('Work');
      expect(inputOf(header).getAttribute('type')).toBe('text');
      expect(part(header, '.group_id').textContent).toBe('4');
      expect(part(header, '.close').title).toBe('[closeGroup]');
    });

    it('puts the button for a new tab in the content, which knows its group', async () => {
      const env = await setUp();

      const node = env.nodes.make(group(4));

      const content = part(node, '.content');
      expect(content.getAttribute('groupId')).toBe('4');
      expect(
        Array.from(content.children).map((child) => child.className),
      ).toEqual(['newtab']);
      expect(part(content, '.newtab > .inner')).toBeInstanceOf(HTMLElement);
      expect(env.nodes.contentOf(4)).toBe(content);
      expect(env.nodes.newTabOf(4)).toBe(part(content, '.newtab'));
    });

    it('has no content for a group it has not made', async () => {
      const env = await setUp();

      expect(env.nodes.contentOf(9)).toBeUndefined();
      expect(env.nodes.newTabOf(9)).toBeUndefined();
    });
  });

  describe('dragging over and onto the content', () => {
    it('hands a drag over and a drop to the drag handlers', async () => {
      const env = await setUp();
      const content = part(env.nodes.make(group(1)), '.content');
      const over = dragEvent('dragover');
      const drop = dragEvent('drop');

      content.dispatchEvent(over);
      content.dispatchEvent(drop);

      expect(env.drag.over).toHaveBeenCalledWith(over);
      expect(env.drag.drop).toHaveBeenCalledWith(drop);
    });

    it('ignores events that are not drags', async () => {
      const env = await setUp();
      const content = part(env.nodes.make(group(1)), '.content');

      content.dispatchEvent(new Event('dragover'));
      content.dispatchEvent(new Event('drop'));

      expect(env.drag.over).not.toHaveBeenCalled();
      expect(env.drag.drop).not.toHaveBeenCalled();
    });
  });

  describe('closing a group', () => {
    const closeIt = async (_env: Env, node: HTMLElement) => {
      part(node, '.header .close').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      await settle();
    };

    it('deletes a group with no tabs at once, and takes its node away', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1));
      env.groupsNode.appendChild(node);

      await closeIt(env, node);

      expect(env.confirm).not.toHaveBeenCalled();
      expect(env.groups.calls).toEqual(['remove 1']);
      expect(node.isConnected).toBe(false);
      expect(env.nodes.contentOf(1)).toBeUndefined();
    });

    it('asks first for a group with tabs, with their number in the question', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1));
      const content = part(node, '.content');
      content.insertBefore(document.createElement('div'), content.firstChild);
      content.insertBefore(document.createElement('div'), content.firstChild);

      await closeIt(env, node);

      expect(env.getMessage).toHaveBeenCalledWith('closeGroupWarning', ['2']);
      expect(env.confirm).toHaveBeenCalledWith('[closeGroupWarning:2]');
    });

    it('asks the form of the question that goes with the number of tabs', async () => {
      const env = await setUp({
        pluralRule: '1',
        question: 'Close the tab?|Close the tabs?',
      });
      const node = env.nodes.make(group(1));
      const content = part(node, '.content');
      content.insertBefore(document.createElement('div'), content.firstChild);
      content.insertBefore(document.createElement('div'), content.firstChild);

      await closeIt(env, node);

      expect(env.confirm).toHaveBeenCalledWith('Close the tabs?');
    });

    it('asks an empty question where the message has no form for the number', async () => {
      const env = await setUp({ pluralRule: '7', question: 'one|few' });
      const node = env.nodes.make(group(1));
      const content = part(node, '.content');
      [1, 2, 3, 4, 5].forEach(() => {
        content.insertBefore(document.createElement('div'), content.firstChild);
      });

      await closeIt(env, node);

      expect(env.confirm).toHaveBeenCalledWith('');
    });

    it('deletes it when the user agrees, and makes the first group of those left the active one', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1));
      env.groupsNode.appendChild(node);
      part(node, '.content').insertBefore(
        document.createElement('div'),
        part(node, '.newtab'),
      );

      await closeIt(env, node);

      expect(env.groups.calls).toEqual(['remove 1', 'setActive 2']);
      expect(node.isConnected).toBe(false);
    });

    it('keeps it when the user does not agree', async () => {
      const env = await setUp({ confirmed: false });
      const node = env.nodes.make(group(1));
      env.groupsNode.appendChild(node);
      part(node, '.content').insertBefore(
        document.createElement('div'),
        part(node, '.newtab'),
      );

      await closeIt(env, node);

      expect(env.groups.calls).toEqual([]);
      expect(node.isConnected).toBe(true);
    });

    it('does not make a group the active one when none is left', async () => {
      const env = await setUp({ groups: [group(1)] });
      const node = env.nodes.make(group(1));
      part(node, '.content').insertBefore(
        document.createElement('div'),
        part(node, '.newtab'),
      );

      await closeIt(env, node);

      expect(env.groups.calls).toEqual(['remove 1']);
    });

    it('does not make a group the active one after one with no tabs was deleted', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1));

      await closeIt(env, node);

      expect(env.groups.calls).toEqual(['remove 1']);
    });

    it('closes by group, as it is asked directly', async () => {
      const env = await setUp();
      env.groupsNode.appendChild(env.nodes.make(group(2)));

      await env.nodes.close(group(2));

      expect(env.groups.calls).toEqual(['remove 2']);
    });

    it('closes a group that has no node, with no tabs to ask about', async () => {
      const env = await setUp();

      await env.nodes.close(group(9));

      expect(env.confirm).not.toHaveBeenCalled();
      expect(env.groups.calls).toEqual(['remove 9']);
    });

    it('does not let the click reach the page', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1));
      env.groupsNode.appendChild(node);
      const reached = vi.fn();
      env.groupsNode.addEventListener('click', reached);

      await closeIt(env, node);

      expect(reached).not.toHaveBeenCalled();
    });

    it('says so when the group cannot be deleted', async () => {
      const env = await setUp();
      const failure = new Error('no');
      env.groups.remove = () => Promise.reject(failure);
      const node = env.nodes.make(group(1));

      await closeIt(env, node);

      expect(env.logger.error).toHaveBeenCalledWith(
        '[View] A group handler failed:',
        failure,
      );
    });
  });

  describe('the button for a new tab', () => {
    it('makes the group the active one, opens a new tab, and then leaves the view', async () => {
      const env = await setUp();
      const order: string[] = [];
      env.groups.setActive = (id) => {
        order.push(`setActive ${String(id)}`);
        return Promise.resolve();
      };
      env.viewTabs.openNew = () => {
        order.push('open');
        return Promise.resolve(7);
      };
      env.leaveView.mockImplementation(() => {
        order.push('leave');
        return Promise.resolve();
      });
      const node = env.nodes.make(group(2));

      part(node, '.newtab').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      await settle();

      expect(order).toEqual(['setActive 2', 'open', 'leave']);
    });

    it('does not let the click or the press reach the group', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(2));
      env.groupsNode.appendChild(node);
      const clicked = vi.fn();
      const pressed = vi.fn();
      env.groupsNode.addEventListener('click', clicked);
      env.groupsNode.addEventListener('mousedown', pressed);

      part(node, '.newtab').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      part(node, '.newtab').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
      await settle();

      expect(clicked).not.toHaveBeenCalled();
      expect(pressed).not.toHaveBeenCalled();
    });

    it('does not start moving the group when the button is pressed', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(2));
      env.groupsNode.appendChild(node);

      part(node, '.newtab').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
      await settle();

      expect(document.body.hasAttribute('style')).toBe(false);
    });

    it('does not leave the view when no tab could be opened, and says so', async () => {
      const env = await setUp();
      const failure = new Error('no');
      env.viewTabs.openNew = () => Promise.reject(failure);
      const node = env.nodes.make(group(2));

      part(node, '.newtab').dispatchEvent(new MouseEvent('click'));
      await settle();

      expect(env.leaveView).not.toHaveBeenCalled();
      expect(env.logger.error).toHaveBeenCalledWith(
        '[View] A group handler failed:',
        failure,
      );
    });
  });

  describe('renaming', () => {
    it('lets the user edit the name by double clicking the header', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1, { name: 'Work' }));
      env.groupsNode.appendChild(node);
      const header = part(node, '.header');
      const input = inputOf(header);

      header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

      expect(header.classList.contains('edit')).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(4);
    });

    it('does not start again while the name is being edited', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1, { name: 'Work' }));
      env.groupsNode.appendChild(node);
      const header = part(node, '.header');
      const input = inputOf(header);
      header.dispatchEvent(new MouseEvent('dblclick'));
      input.setSelectionRange(1, 2);

      header.dispatchEvent(new MouseEvent('dblclick'));

      expect(input.selectionStart).toBe(1);
    });

    it('finishes on Enter, which only ends the edit', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1, { name: 'Work' }));
      env.groupsNode.appendChild(node);
      const header = part(node, '.header');
      const input = inputOf(header);
      header.dispatchEvent(new MouseEvent('dblclick'));
      input.value = 'Play';
      const reached = vi.fn();
      env.groupsNode.addEventListener('keydown', reached);
      const enter = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });

      input.dispatchEvent(enter);
      await settle();

      expect(enter.defaultPrevented).toBe(true);
      expect(reached).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(input);
      expect(header.classList.contains('edit')).toBe(false);
      expect(part(header, '.name').textContent).toBe('Play');
      expect(env.groups.calls).toEqual(['rename 1 Play']);
    });

    it('goes on with other keys', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1, { name: 'Work' }));
      env.groupsNode.appendChild(node);
      const header = part(node, '.header');
      const input = inputOf(header);
      header.dispatchEvent(new MouseEvent('dblclick'));
      const key = new KeyboardEvent('keydown', {
        key: 'a',
        bubbles: true,
        cancelable: true,
      });

      input.dispatchEvent(key);

      expect(key.defaultPrevented).toBe(false);
      expect(header.classList.contains('edit')).toBe(true);
    });

    it('finishes when the input loses focus', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1, { name: 'Work' }));
      env.groupsNode.appendChild(node);
      const header = part(node, '.header');
      const input = inputOf(header);
      header.dispatchEvent(new MouseEvent('dblclick'));
      input.value = 'Other';

      input.dispatchEvent(new FocusEvent('blur'));

      expect(part(header, '.name').textContent).toBe('Other');
      expect(env.groups.calls).toEqual(['rename 1 Other']);
      expect(input.selectionEnd).toBe(0);
    });

    it('can be edited again once finished', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1, { name: 'Work' }));
      env.groupsNode.appendChild(node);
      const header = part(node, '.header');
      const input = inputOf(header);
      header.dispatchEvent(new MouseEvent('dblclick'));
      input.dispatchEvent(new FocusEvent('blur'));

      header.dispatchEvent(new MouseEvent('dblclick'));

      expect(header.classList.contains('edit')).toBe(true);
    });

    it('does not move the group by a press while the name is being edited', async () => {
      const env = await setUp();
      const layoutMode = vi.fn().mockResolvedValue('freeform');
      env.nodes.make(group(1));
      const node = env.nodes.make(group(1));
      env.groupsNode.appendChild(node);
      const header = part(node, '.header');
      header.dispatchEvent(new MouseEvent('dblclick'));

      header.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 1 }),
      );
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 3 }));
      await settle();

      expect(layoutMode).not.toHaveBeenCalled();
      expect(document.body.hasAttribute('style')).toBe(false);
    });

    it('says so when the group cannot be renamed', async () => {
      const env = await setUp();
      const failure = new Error('no');
      env.groups.rename = () => Promise.reject(failure);
      const node = env.nodes.make(group(1));
      const header = part(node, '.header');
      header.dispatchEvent(new MouseEvent('dblclick'));

      inputOf(header).dispatchEvent(new FocusEvent('blur'));
      await settle();

      expect(env.logger.error).toHaveBeenCalledWith(
        '[View] A group handler failed:',
        failure,
      );
    });
  });

  describe('moving and resizing', () => {
    // The page the groups are in is 1000 by 500 pixels
    const start = async (options: Options = {}) => {
      const env = await setUp({
        groups: [group(1), group(2, { rect: rect(0.7, 0.7, 0.2, 0.2) })],
        ...options,
      });
      const first = env.nodes.make(group(1));
      const second = env.nodes.make(group(2));
      env.groupsNode.append(first, second);
      return { env, first, second };
    };

    const press = async (target: Element) => {
      target.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
      await settle();
    };

    const first = (x: number, y: number) => {
      const event = new MouseEvent('mousemove', { cancelable: true });
      Object.defineProperty(event, 'pageX', { value: x });
      Object.defineProperty(event, 'pageY', { value: y });
      document.dispatchEvent(event);
      return event;
    };

    it('does nothing when the groups are tiled', async () => {
      const { env, first: node } = await start({ layoutMode: 'tiling' });

      await press(part(node, '.right'));
      first(500, 250);
      first(600, 250);

      expect(env.groups.calls).toEqual([]);
      expect(document.body.hasAttribute('style')).toBe(false);
    });

    it('does nothing when the mode is not known', async () => {
      const { env, first: node } = await start({ layoutMode: undefined });

      await press(part(node, '.right'));
      first(500, 250);

      expect(env.groups.calls).toEqual([]);
    });

    it('shows the cursor of the handle while it is dragged', async () => {
      const { first: node } = await start();
      const handle = part(node, '.right');
      handle.style.cursor = 'e-resize';

      await press(handle);

      expect(document.body.getAttribute('style')).toBe('cursor: e-resize');
    });

    it('stores the group first as it was, when the pointer first moves', async () => {
      const { env, first: node } = await start();

      await press(part(node, '.right'));
      first(500, 250);

      expect(env.groups.calls).toEqual([
        `transform 1 ${JSON.stringify(rect(0.2, 0.2, 0.4, 0.4))}`,
      ]);
    });

    it('places the group as it is dragged, without storing it', async () => {
      const { env, first: node } = await start();

      await press(part(node, '.right'));
      first(500, 250);
      first(600, 250);

      expect(env.groups.calls).toHaveLength(1);
      // The right edge moved a tenth of the page to the right: 0.7 of 1000
      expect(node.style.right).toBe('300px');
      expect(node.style.left).toBe('200px');
    });

    it('stores where the group ended up when the pointer is let go, and stops following it', async () => {
      const { env, first: node } = await start();

      await press(part(node, '.right'));
      first(500, 250);
      first(600, 250);
      document.dispatchEvent(new MouseEvent('mouseup'));
      await settle();

      expect(env.groups.calls).toHaveLength(2);
      const stored = env.groups.calls[1] ?? '';
      expect(stored.startsWith('transform 1 ')).toBe(true);
      const final = storedRect(stored);
      expect(final.x).toBeCloseTo(0.2, 10);
      expect(final.w).toBeCloseTo(0.5, 10);
      expect(document.body.hasAttribute('style')).toBe(false);

      first(900, 250);
      expect(node.style.right).toBe('300px');
    });

    it('stores nothing when the pointer is let go without having moved', async () => {
      const { env, first: node } = await start();

      await press(part(node, '.right'));
      document.dispatchEvent(new MouseEvent('mouseup'));
      await settle();

      expect(env.groups.calls).toEqual([]);
      expect(document.body.hasAttribute('style')).toBe(false);
    });

    it('does not handle a later let go as the end of an earlier drag', async () => {
      const { env, first: node } = await start();
      await press(part(node, '.right'));
      first(500, 250);
      document.dispatchEvent(new MouseEvent('mouseup'));
      await settle();
      const stored = env.groups.calls.length;

      document.dispatchEvent(new MouseEvent('mouseup'));
      await settle();

      expect(env.groups.calls).toHaveLength(stored);
    });

    it.each([
      ['top', rect(0.2, 0.1, 0.4, 0.5)],
      ['right', rect(0.2, 0.2, 0.5, 0.4)],
      ['bottom', rect(0.2, 0.2, 0.4, 0.5)],
      ['left', rect(0.1, 0.2, 0.5, 0.4)],
      ['topRight', rect(0.2, 0.1, 0.5, 0.5)],
      ['bottomRight', rect(0.2, 0.2, 0.5, 0.5)],
      ['bottomLeft', rect(0.1, 0.2, 0.5, 0.5)],
      ['topLeft', rect(0.1, 0.1, 0.5, 0.5)],
    ])(
      'follows the pointer by the %s edges of the %s handle',
      async (name, expected) => {
        const { env, first: node } = await start();

        await press(part(node, `:scope > .inner > .${name}`));
        first(500, 250);
        // Up and to the left for the top and left edges, down and right for the others
        first(
          name.includes('left') || name.includes('Left') ? 400 : 600,
          name.includes('top') || name.includes('Top') ? 200 : 300,
        );
        document.dispatchEvent(new MouseEvent('mouseup'));
        await settle();

        const stored = env.groups.calls.at(-1) ?? '';
        const final = storedRect(stored);
        expect(final.x).toBeCloseTo(expected.x, 10);
        expect(final.y).toBeCloseTo(expected.y, 10);
        expect(final.w).toBeCloseTo(expected.w, 10);
        expect(final.h).toBeCloseTo(expected.h, 10);
      },
    );

    it('moves the whole group when it is pressed anywhere in it', async () => {
      const { env, first: node } = await start();

      await press(part(node, '.header'));
      first(500, 250);
      first(600, 300);
      document.dispatchEvent(new MouseEvent('mouseup'));
      await settle();

      const final = storedRect(env.groups.calls.at(-1));
      expect(final.x).toBeCloseTo(0.3, 10);
      expect(final.y).toBeCloseTo(0.3, 10);
      expect(final.w).toBeCloseTo(0.4, 10);
      expect(final.h).toBeCloseTo(0.4, 10);
    });

    it('sticks to the other groups as it is moved', async () => {
      const { env, first: node } = await start();

      await press(part(node, '.header'));
      first(500, 250);
      // 0.2 + 0.2998 is within 5 pixels of the left edge of the other group
      first(500 + 299.8 + 0, 250);
      document.dispatchEvent(new MouseEvent('mouseup'));
      await settle();

      const final = storedRect(env.groups.calls.at(-1));
      expect(final.x).toBeCloseTo(0.5, 10);
    });

    it('does not let the press reach the page, and keeps the browser from selecting text', async () => {
      const { env, first: node } = await start();
      const pressed = vi.fn();
      env.groupsNode.addEventListener('mousedown', pressed);
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });

      part(node, '.right').dispatchEvent(event);
      await settle();

      expect(pressed).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not let a press in the group reach the page, or select text', async () => {
      const { env, first: node } = await start();
      const pressed = vi.fn();
      env.groupsNode.addEventListener('mousedown', pressed);
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });

      part(node, '.header').dispatchEvent(event);
      await settle();

      expect(pressed).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not stick the group to itself as it is moved a little', async () => {
      const { env, first: node } = await start();

      await press(part(node, '.header'));
      first(500, 250);
      first(503, 250);
      document.dispatchEvent(new MouseEvent('mouseup'));
      await settle();

      const final = storedRect(env.groups.calls.at(-1));
      expect(final.x).toBeCloseTo(0.203, 10);
    });

    it('only drags the group once however it is pressed', async () => {
      const { env, first: node } = await start();

      await press(part(node, '.right'));
      first(500, 250);
      first(600, 250);
      document.dispatchEvent(new MouseEvent('mouseup'));
      await settle();

      expect(env.groups.calls).toHaveLength(2);
    });

    it('does not let a drag of the pointer select text', async () => {
      const { first: node } = await start();
      await press(part(node, '.header'));

      const event = first(500, 250);

      expect(event.defaultPrevented).toBe(true);
    });

    it('says so when the group cannot be stored', async () => {
      const { env, first: node } = await start();
      const failure = new Error('no');
      env.groups.transform = () => Promise.reject(failure);

      await press(part(node, '.right'));
      first(500, 250);
      await settle();

      expect(env.logger.error).toHaveBeenCalledWith(
        '[View] A group handler failed:',
        failure,
      );
    });

    it('does nothing for a group that is not in the page', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1));

      await press(part(node, '.right'));
      first(500, 250);

      expect(env.groups.calls).toEqual([]);
    });
  });

  describe('updateFit', () => {
    const withSize = (env: Env, id: number, width: number, height: number) => {
      const content = env.nodes.contentOf(id);
      if (content === undefined) {
        throw new Error('no content');
      }
      content.getBoundingClientRect = boundsOf(width, height);
      return content;
    };

    const addTabs = (content: HTMLElement, count: number) => {
      const newtab = part(content, '.newtab');
      Array.from({ length: count }, () => {
        const element = document.createElement('div');
        content.insertBefore(element, newtab);
        return element;
      });
    };

    it('shows the number of tabs, not counting the button for a new tab', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1));
      env.groupsNode.appendChild(node);
      addTabs(part(node, '.content'), 3);

      env.nodes.updateFit(group(1));

      expect(part(node, '.tab_count').textContent).toBe('3');
    });

    it('sizes and places each child, the button included, in rows', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1));
      env.groupsNode.appendChild(node);
      const content = withSize(env, 1, 800, 600);
      addTabs(content, 3);

      env.nodes.updateFit(group(1));

      const children = Array.from(content.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      expect(children.map((child) => child.style.width)).toEqual([
        '250px',
        '250px',
        '250px',
        '250px',
      ]);
      expect(children.map((child) => child.style.height)).toEqual([
        '170px',
        '170px',
        '170px',
        '170px',
      ]);
      expect(children.map((child) => child.style.left)).toEqual([
        '0px',
        '250px',
        '500px',
        '0px',
      ]);
      expect(children.map((child) => child.style.top)).toEqual([
        '0px',
        '0px',
        '0px',
        '170px',
      ]);
      expect(children.map((child) => child.style.zIndex)).toEqual([
        '0',
        '1',
        '2',
        '3',
      ]);
      expect(
        children.every((child) => !child.classList.contains('small')),
      ).toBe(true);
      expect(part(content, '.newtab').style.display).toBe('block');
    });

    it('marks small tiles as small, and clears the mark when they are not', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1));
      env.groupsNode.appendChild(node);
      const content = withSize(env, 1, 300, 200);
      addTabs(content, 19);

      env.nodes.updateFit(group(1));
      expect(content.firstElementChild?.classList.contains('small')).toBe(true);

      content.getBoundingClientRect = boundsOf(800, 600);
      env.nodes.updateFit(group(1));
      expect(content.firstElementChild?.classList.contains('small')).toBe(
        false,
      );
    });

    it('stacks the tiles of a deck in the corner and hides the button for a new tab', async () => {
      const env = await setUp();
      const node = env.nodes.make(group(1));
      env.groupsNode.appendChild(node);
      const content = withSize(env, 1, 150, 150);
      addTabs(content, 199);

      env.nodes.updateFit(group(1));

      const [firstChild] = Array.from(content.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      expect(firstChild?.style.left).toBe('0px');
      expect(firstChild?.style.top).toBe('0px');
      expect(part(content, '.newtab').style.display).toBe('none');
    });

    it('does nothing for a group that is not there, or has no node', async () => {
      const env = await setUp();
      env.nodes.make(group(1));

      expect(() => {
        env.nodes.updateFit(null);
        env.nodes.updateFit(group(9));
      }).not.toThrow();
    });
  });

  describe('resize', () => {
    it('puts every group where its rect says, in pixels from the edges of the page', async () => {
      const env = await setUp({
        groups: [
          group(1, { rect: rect(0.1, 0.2, 0.5, 0.4) }),
          group(2, { rect: rect(0, 0, 1, 1) }),
        ],
      });
      const first = env.nodes.make(group(1));
      const second = env.nodes.make(group(2));
      env.groupsNode.append(first, second);

      env.nodes.resize();

      expect(first.style.top).toBe('100px');
      expect(first.style.left).toBe('100px');
      expect(Number.parseFloat(first.style.right)).toBeCloseTo(400, 6);
      expect(Number.parseFloat(first.style.bottom)).toBeCloseTo(200, 6);
      expect(second.style.top).toBe('0px');
      expect(second.style.right).toBe('0px');
    });

    it('stacks a group that has never been moved by its number, and one that has by when', async () => {
      const env = await setUp({
        groups: [group(3), group(4, { lastMoved: 1_700_000_123_456 })],
      });
      const first = env.nodes.make(group(3));
      const second = env.nodes.make(group(4));
      env.groupsNode.append(first, second);

      env.nodes.resize();

      expect(first.style.zIndex).toBe('3');
      expect(second.style.zIndex).toBe('123456');
    });

    it('uses the rect given for the group being dragged, and the stored one for the others', async () => {
      const env = await setUp({
        groups: [group(1), group(2, { rect: rect(0.5, 0.5, 0.2, 0.2) })],
      });
      const first = env.nodes.make(group(1));
      const second = env.nodes.make(group(2));
      env.groupsNode.append(first, second);

      env.nodes.resize(1, rect(0, 0, 0.3, 0.3));

      expect(first.style.left).toBe('0px');
      expect(second.style.left).toBe('500px');
    });

    it('uses the stored rect when no group is given a new one', async () => {
      const env = await setUp({ groups: [group(1)] });
      const first = env.nodes.make(group(1));
      env.groupsNode.append(first);

      env.nodes.resize(1);

      expect(first.style.left).toBe('200px');
    });

    it('lays out the tabs of each group', async () => {
      const env = await setUp({ groups: [group(1)] });
      const first = env.nodes.make(group(1));
      env.groupsNode.append(first);
      part(first, '.content').getBoundingClientRect = boundsOf(800, 600);

      env.nodes.resize();

      expect(part(first, '.newtab').style.width).toBe('250px');
    });

    it('leaves out a group that has no node or is not in the page', async () => {
      const env = await setUp({ groups: [group(1), group(2)] });
      const loose = env.nodes.make(group(2));

      expect(() => {
        env.nodes.resize();
      }).not.toThrow();
      expect(loose.style.top).toBe('');
    });
  });

  describe('raise', () => {
    it('stacks the group in front of the others by when it was raised, and remembers when', async () => {
      const env = await setUp({ groups: [group(1)] });
      const node = env.nodes.make(group(1));

      env.nodes.raise(1);

      expect(node.style.zIndex).toBe('123456');
      expect(env.groups.list[0]?.lastMoved).toBe(1_700_000_123_456);
    });

    it('does nothing for a group that is not there or has no node', async () => {
      const env = await setUp({ groups: [group(1)] });

      expect(() => {
        env.nodes.raise(1);
        env.nodes.raise(9);
      }).not.toThrow();
    });
  });

  describe('init', () => {
    it('makes a node for every group of the user, in order, and skips the system groups', async () => {
      const env = await setUp({
        groups: [group(0), group(3), group(-2, { name: 'Ungrouped Tabs' })],
      });

      await env.nodes.init(env.groupsNode, env.pinned);

      expect(
        Array.from(env.groupsNode.children).map(
          (child) => part(child, '.group_id').textContent,
        ),
      ).toEqual(['0', '3']);
      expect(env.nodes.contentOf(-2)).toBeUndefined();
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[View] Skipping system group -2 (Ungrouped Tabs) from UI',
      );
    });

    it('puts the tabs in their groups and the pinned ones among the pinned tabs', async () => {
      const env = await setUp({
        groups: [group(1), group(2)],
        tabs: [tab(10), tab(11, { pinned: true }), tab(12), tab(13)],
        tabGroups: { 10: 1, 11: 1, 12: 2, 13: 1 },
      });

      await env.nodes.init(env.groupsNode, env.pinned);

      const idsIn = (element: Element | undefined) =>
        Array.from(element?.children ?? []).map(labelOf);
      expect(idsIn(env.nodes.contentOf(1))).toEqual(['10', '13', 'newtab']);
      expect(idsIn(env.nodes.contentOf(2))).toEqual(['12', 'newtab']);
      expect(idsIn(env.pinned)).toEqual(['11']);
    });

    it('lays out and counts the tabs of each group', async () => {
      const env = await setUp({
        groups: [group(1)],
        tabs: [tab(10), tab(11)],
        tabGroups: { 10: 1, 11: 1 },
      });

      await env.nodes.init(env.groupsNode, env.pinned);

      const node = env.groupsNode.firstElementChild;
      expect(part(node ?? env.groupsNode, '.tab_count').textContent).toBe('2');
    });

    it('does not show a tab that has no group, is in the view or in a group that is not shown', async () => {
      const env = await setUp({
        groups: [group(1)],
        tabs: [tab(10), tab(11), tab(12), tab(13)],
        tabGroups: { 11: -1, 12: -2, 13: 9 },
      });

      await env.nodes.init(env.groupsNode, env.pinned);

      expect(env.nodes.contentOf(1)?.children).toHaveLength(1);
      expect(env.pinned.children).toHaveLength(0);
    });

    it('does not show a tab it has no node for', async () => {
      const env = await setUp({
        groups: [group(1)],
        tabs: [tab(10), tab(11)],
        tabGroups: { 10: 1, 11: 1 },
      });
      env.elements.delete(11);

      await env.nodes.init(env.groupsNode, env.pinned);

      expect(env.nodes.contentOf(1)?.children).toHaveLength(2);
    });

    it('puts the tabs in the order of the window, whichever group they are found for first', async () => {
      const env = await setUp({
        groups: [group(1)],
        tabs: [tab(10), tab(11), tab(12)],
        tabGroups: { 10: 1, 11: 1, 12: 1 },
      });
      const getTabGroup = env.groupState.getTabGroup.bind(env.groupState);
      // The group of the first tab is read last
      env.groupState.getTabGroup = async (tabId) => {
        await settle();
        if (tabId !== 10) {
          return getTabGroup(tabId);
        }
        await settle();
        return getTabGroup(tabId);
      };

      await env.nodes.init(env.groupsNode, env.pinned);

      expect(
        Array.from(env.nodes.contentOf(1)?.children ?? []).map(labelOf),
      ).toEqual(['10', '11', '12', 'newtab']);
    });

    it('moves the tabs to where they are now when it fills again', async () => {
      const env = await setUp({
        groups: [group(1), group(2)],
        tabs: [tab(10)],
        tabGroups: { 10: 1 },
      });
      await env.nodes.init(env.groupsNode, env.pinned);
      await env.groupState.setTabGroup(10, 2);

      await env.nodes.fill();

      expect(
        Array.from(env.nodes.contentOf(1)?.children ?? []).map(labelOf),
      ).toEqual(['newtab']);
      expect(
        Array.from(env.nodes.contentOf(2)?.children ?? []).map(labelOf),
      ).toEqual(['10', 'newtab']);
    });
  });

  describe('insertTab', () => {
    const shownGroup = async (
      tabIndexes: [number, number][],
      tabGroups: Record<number, number>,
    ) => {
      const tabs = tabIndexes.map(([id, index]) => tab(id, { index }));
      const env = await setUp({
        groups: [group(1), group(2)],
        tabs,
        tabGroups,
      });
      await env.nodes.init(env.groupsNode, env.pinned);
      return env;
    };

    const tabIdsIn = (env: Env, groupId: number) =>
      Array.from(env.nodes.contentOf(groupId)?.children ?? []).map(labelOf);

    it('puts a tab before the one that comes next in the window', async () => {
      const env = await shownGroup(
        [
          [10, 0],
          [11, 2],
          [12, 1],
        ],
        { 10: 1, 11: 1, 12: 1 },
      );
      // Tab 12 sits last in the group, though it is second in the window
      const content = env.nodes.contentOf(1);
      const element = env.elements.get(12);
      if (content && element) {
        content.insertBefore(element, part(content, '.newtab'));
      }

      await env.nodes.insertTab(12);

      expect(tabIdsIn(env, 1)).toEqual(['10', '12', '11', 'newtab']);
    });

    it('goes by the tabs of its own group, not those of other groups', async () => {
      const env = await shownGroup(
        [
          [10, 0],
          [11, 3],
          [12, 5],
          [13, 1],
        ],
        { 10: 1, 11: 2, 12: 1, 13: 1 },
      );
      // The tab 13 was put last in its group, but is second in the window
      const content = env.nodes.contentOf(1);
      const element = env.elements.get(13);
      if (content && element) {
        content.insertBefore(element, part(content, '.newtab'));
      }

      await env.nodes.insertTab(13);

      expect(tabIdsIn(env, 1)).toEqual(['10', '13', '12', 'newtab']);
      expect(tabIdsIn(env, 2)).toEqual(['11', 'newtab']);
    });

    it('does not take a tab that has no node for one that is shown', async () => {
      const env = await shownGroup(
        [
          [10, 0],
          [11, 2],
          [12, 4],
        ],
        { 10: 1, 11: 1, 12: 1 },
      );
      env.elements.delete(11);

      await env.nodes.insertTab(10);

      // Tab 11 is not known to be shown, so tab 10 goes before the next one that is
      expect(tabIdsIn(env, 1)).toEqual(['11', '10', '12', 'newtab']);
    });

    it('puts a tab last when none comes after it', async () => {
      const env = await shownGroup(
        [
          [10, 0],
          [11, 1],
        ],
        { 10: 1, 11: 1 },
      );
      const content = env.nodes.contentOf(1);
      const element = env.elements.get(10);
      if (content && element) {
        // The tab that comes first is last in the group at present
        content.insertBefore(element, part(content, '.newtab'));
      }

      await env.nodes.insertTab(11);

      expect(tabIdsIn(env, 1)).toEqual(['10', '11', 'newtab']);
    });

    it('moves a tab to its group when its group changed', async () => {
      const env = await shownGroup(
        [
          [10, 0],
          [11, 1],
        ],
        { 10: 1, 11: 1 },
      );
      await env.groupState.setTabGroup(11, 2);

      await env.nodes.insertTab(11);

      expect(tabIdsIn(env, 1)).toEqual(['10', 'newtab']);
      expect(tabIdsIn(env, 2)).toEqual(['11', 'newtab']);
    });

    it.each([
      ['has no group', {}],
      ['is in the view', { 10: -1 }],
      ['is in a system group', { 10: -2 }],
      ['is in a group that is not shown', { 10: 9 }],
    ])('does nothing for a tab that %s', async (_name, tabGroups) => {
      const env = await setUp({
        groups: [group(1)],
        tabs: [tab(10)],
        tabGroups,
      });
      await env.nodes.init(env.groupsNode, env.pinned);

      await env.nodes.insertTab(10);

      expect(env.nodes.contentOf(1)?.children).toHaveLength(1);
    });

    it('does nothing for a tab it has no node for', async () => {
      const env = await setUp({
        groups: [group(1)],
        tabs: [tab(10)],
        tabGroups: { 10: 1 },
      });
      await env.nodes.init(env.groupsNode, env.pinned);
      env.elements.delete(10);

      await env.nodes.insertTab(10);

      expect(tabIdsIn(env, 1)).toEqual(['10', 'newtab']);
    });

    it('fails for a tab that is gone', async () => {
      const env = await setUp({ groups: [group(1)] });

      await expect(env.nodes.insertTab(99)).rejects.toThrow(
        'Invalid tab ID: 99',
      );
    });

    it('takes turns with filling', async () => {
      const env = await setUp({
        groups: [group(1)],
        tabs: [tab(10)],
        tabGroups: { 10: 1 },
      });
      await env.nodes.init(env.groupsNode, env.pinned);
      const order: string[] = [];
      const list = env.viewTabs.list.bind(env.viewTabs);
      env.viewTabs.list = async () => {
        order.push('list start');
        const result = await list();
        order.push('list end');
        return result;
      };

      await Promise.all([env.nodes.fill(), env.nodes.insertTab(10)]);

      expect(order.slice(0, 2)).toEqual(['list start', 'list end']);
    });
  });
});

describe('view/group-nodes.ts: tabIdsOf', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('gives the tabs shown in a group in order, and not the button for a new tab', async () => {
    const env = await setUp({
      groups: [group(1)],
      tabs: [tab(10), tab(11), tab(12)],
      tabGroups: { 10: 1, 11: 1, 12: 1 },
    });
    await env.nodes.init(env.groupsNode, env.pinned);

    expect(env.nodes.tabIdsOf(1)).toEqual([10, 11, 12]);
  });

  it('gives the tab 0 too', async () => {
    const env = await setUp({
      groups: [group(1)],
      tabs: [tab(0)],
      tabGroups: { 0: 1 },
    });
    await env.nodes.init(env.groupsNode, env.pinned);

    expect(env.nodes.tabIdsOf(1)).toEqual([0]);
  });

  it('gives none for a group that has no node', async () => {
    const env = await setUp();

    expect(env.nodes.tabIdsOf(9)).toEqual([]);
  });
});
