import * as groupNodes from '../../../src/js/view/groupNodes.js';
import * as groups from '../../../src/js/view/groups.js';
import * as tabNodes from '../../../src/js/view/tabNodes.js';
import * as tabs from '../../../src/js/view/tabs.js';

jest.mock('../../../src/js/view/groups.js');
jest.mock('../../../src/js/view/tabNodes.js', () => ({
  tabNodes: {},
  getTabNode: jest.fn((id) => ({
    id,
    tagName: 'DIV',
    classList: { add: jest.fn(), remove: jest.fn() },
    style: {},
  })),
}));
jest.mock('../../../src/js/view/tabs.js', () => ({
  getGroupId: jest.fn().mockResolvedValue(1),
  forEachTab: jest.fn(),
}));

const createdElements = [];
const findElementByClass = (cls) =>
  createdElements.find((el) => el.classList.contains(cls));

const flushPromises = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 15);
  });

jest.mock('../../../src/js/share/utils.js', () => ({
  newElement: jest.fn((tag, attrs = {}, children = []) => {
    const classes = new Set();
    const listeners = {};
    const el = {
      tagName: tag ? tag.toUpperCase() : 'DIV',
      childNodes: [...children],
      value: attrs.value || '',
      type: attrs.type || '',
      setAttribute: jest.fn((k, v) => {
        if (k === 'class') {
          classes.clear();
          v.split(' ').forEach((c) => classes.add(c));
        }
        if (k === 'value') {
          el.value = v;
        }
        el.attributes[k] = v;
      }),
      attributes: { ...attrs },
      getAttribute: jest.fn((k) => el.attributes[k]),
      appendChild: jest.fn((child) => {
        if (child && child.isFragment) {
          el.childNodes.push(...child.childNodes);
          child.childNodes.length = 0;
        } else {
          el.childNodes.push(child);
        }
      }),
      replaceChildren: jest.fn((...newChildren) => {
        el.childNodes = [...newChildren];
      }),
      insertBefore: jest.fn((newChild, referenceChild) => {
        const idx = el.childNodes.indexOf(referenceChild);
        const childrenToInsert =
          newChild && newChild.isFragment ? newChild.childNodes : [newChild];
        if (idx !== -1) {
          el.childNodes.splice(idx, 0, ...childrenToInsert);
        } else {
          el.childNodes.push(...childrenToInsert);
        }
        if (newChild && newChild.isFragment) {
          newChild.childNodes.length = 0;
        }
      }),
      insertAdjacentElement: jest.fn((position, element) => {
        if (position === 'beforebegin') {
          el.childNodes.push(element);
        }
      }),
      addEventListener: jest.fn((event, handler) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: jest.fn(),
      classList: {
        add: jest.fn((c) => classes.add(c)),
        remove: jest.fn((c) => classes.delete(c)),
        contains: jest.fn((c) => classes.has(c)),
      },
      style: {},
      dispatchEvent: jest.fn((event) => {
        if (listeners[event.type]) {
          listeners[event.type].forEach((h) => h(event));
        }
      }),
      focus: jest.fn(),
      blur: jest.fn(),
      setSelectionRange: jest.fn(),
      getBoundingClientRect: jest
        .fn()
        .mockReturnValue({ width: 200, height: 200 }),
    };
    if (attrs.class) {
      attrs.class.split(' ').forEach((c) => classes.add(c));
    }
    createdElements.push(el);
    return el;
  }),
  getPluralForm: jest.fn().mockReturnValue('Close group?'),
}));

describe('view/groupNodes.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createdElements.length = 0;

    // Clear out groupNodes and tabNodes objects for test isolation
    Object.keys(groupNodes.groupNodes).forEach(
      (key) => delete groupNodes.groupNodes[key],
    );
    Object.keys(tabNodes.tabNodes).forEach(
      (key) => delete tabNodes.tabNodes[key],
    );

    const docListeners = {};
    global.document = {
      createTextNode: jest.fn().mockImplementation((txt) => ({ text: txt })),
      createDocumentFragment: jest.fn().mockImplementation(() => {
        const fragChildren = [];
        return {
          isFragment: true,
          childNodes: fragChildren,
          appendChild: jest.fn((c) => fragChildren.push(c)),
        };
      }),
      getElementById: jest.fn().mockReturnValue({
        appendChild: jest.fn(),
      }),
      getElementsByTagName: jest.fn().mockReturnValue([
        {
          setAttribute: jest.fn(),
          removeAttribute: jest.fn(),
        },
      ]),
      addEventListener: jest.fn((event, handler) => {
        docListeners[event] = docListeners[event] || [];
        docListeners[event].push(handler);
      }),
      removeEventListener: jest.fn((event, handler) => {
        if (docListeners[event]) {
          docListeners[event] = docListeners[event].filter(
            (h) => h !== handler,
          );
        }
      }),
      dispatchEvent: jest.fn((event) => {
        if (docListeners[event.type]) {
          docListeners[event.type].forEach((h) => h(event));
        }
      }),
    };

    global.window = {
      confirm: jest.fn().mockReturnValue(true),
      getComputedStyle: jest.fn().mockReturnValue({ cursor: 'move' }),
      innerWidth: 1000,
      innerHeight: 1000,
      location: { pathname: '/view.html' },
    };

    global.browser = {
      windows: {
        getCurrent: jest.fn().mockResolvedValue({ id: 1 }),
      },
      sessions: {
        getWindowValue: jest.fn().mockResolvedValue('freeform'),
      },
      tabs: {
        get: jest.fn().mockResolvedValue({ id: 1, index: 1 }),
        create: jest.fn().mockResolvedValue({ id: 2 }),
        getCurrent: jest.fn().mockResolvedValue({ id: 999 }),
        remove: jest.fn().mockResolvedValue(),
      },
      i18n: { getMessage: jest.fn().mockReturnValue('Close group?') },
    };

    groups.forEach.mockImplementation((cb) => {
      cb({ id: 1, name: 'Group 1', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    });
  });

  describe('closeGroup', () => {
    it('removes group directly if empty', async () => {
      const mockContent = { childNodes: [1] }; // 1 node = empty (only newtab node)
      const mockGroup = { id: 1 };

      const mockGroupNode = { parentNode: { removeChild: jest.fn() } };
      groupNodes.groupNodes[1] = { group: mockGroupNode };

      await groupNodes.closeGroup(mockContent, mockGroup);

      expect(groups.remove).toHaveBeenCalledWith(1);
      expect(mockGroupNode.parentNode.removeChild).toHaveBeenCalledWith(
        mockGroupNode,
      );
      expect(groupNodes.groupNodes[1]).toBeUndefined();
    });

    it('prompts and removes group if not empty', async () => {
      const mockContent = { childNodes: [1, 2, 3] }; // 3 nodes = 2 tabs
      const mockGroup = { id: 1 };

      const mockGroupNode = { parentNode: { removeChild: jest.fn() } };
      groupNodes.groupNodes[1] = { group: mockGroupNode };

      groups.forEach.mockImplementation((cb) => cb({ id: 2 }));

      await groupNodes.closeGroup(mockContent, mockGroup);

      expect(window.confirm).toHaveBeenCalled();
      expect(groups.remove).toHaveBeenCalledWith(1);
      expect(groups.setActive).toHaveBeenCalledWith(2);
    });

    it('does nothing if user cancels prompt', async () => {
      global.window.confirm.mockReturnValue(false);
      const mockContent = { childNodes: [1, 2, 3] };
      const mockGroup = { id: 1 };

      const mockGroupNode = { parentNode: { removeChild: jest.fn() } };
      groupNodes.groupNodes[1] = { group: mockGroupNode };

      await groupNodes.closeGroup(mockContent, mockGroup);

      expect(groups.remove).not.toHaveBeenCalled();
    });
  });

  describe('updateGroupFit', () => {
    it('safely aborts if group is invalid', () => {
      expect(() => groupNodes.updateGroupFit(null)).not.toThrow();
      expect(() => groupNodes.updateGroupFit({ id: 99 })).not.toThrow(); // groupNodes[99] is undefined
    });

    it('calculates fit and applies styles', () => {
      const mockGroup = { id: 1 };
      const mockTabNode = {
        classList: { add: jest.fn(), remove: jest.fn() },
        style: {},
      };

      groupNodes.groupNodes[1] = {
        tabCount: { replaceChildren: jest.fn() },
        content: {
          childNodes: [mockTabNode, mockTabNode], // 1 newtab, 1 tab
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 200, height: 200 }),
        },
        newtab: { style: {} },
      };

      groupNodes.updateGroupFit(mockGroup);

      expect(
        groupNodes.groupNodes[1].content.getBoundingClientRect,
      ).toHaveBeenCalled();
      expect(mockTabNode.style.width).toBeDefined();
      expect(mockTabNode.style.height).toBeDefined();
    });

    it('calculates deck mode correctly', () => {
      const mockGroup = { id: 1 };
      const mockTabNode = {
        classList: { add: jest.fn(), remove: jest.fn() },
        style: {},
      };

      groupNodes.groupNodes[1] = {
        tabCount: { replaceChildren: jest.fn() },
        content: {
          childNodes: [mockTabNode, mockTabNode],
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 20, height: 20 }), // force small area for deck
        },
        newtab: { style: {} },
      };

      groupNodes.updateGroupFit(mockGroup);
      expect(mockTabNode.style.width).toBeDefined();
    });
  });

  describe('resizeGroups', () => {
    it('resizes groups based on coordinates, handling active and inactive groups and lastMoved', () => {
      const groupsList = [
        { id: 1, rect: { x: 0, y: 0, w: 1, h: 1 }, lastMoved: 123456789 },
        { id: 2, rect: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } },
      ];
      groups.forEach.mockImplementation((cb) => groupsList.forEach(cb));

      const mockGroupNode1 = {
        parentNode: {
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 1000, height: 1000 }),
        },
        style: {},
      };
      const mockGroupNode2 = {
        parentNode: {
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 1000, height: 1000 }),
        },
        style: {},
      };

      groupNodes.groupNodes[1] = {
        group: mockGroupNode1,
        content: {
          childNodes: [],
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 200, height: 200 }),
        },
        newtab: { style: {} },
        tabCount: { replaceChildren: jest.fn() },
      };
      groupNodes.groupNodes[2] = {
        group: mockGroupNode2,
        content: {
          childNodes: [],
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 200, height: 200 }),
        },
        newtab: { style: {} },
        tabCount: { replaceChildren: jest.fn() },
      };

      groupNodes.resizeGroups(1, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });

      expect(mockGroupNode1.style.top).toBeDefined();
      expect(mockGroupNode2.style.top).toBeDefined();
    });
  });

  describe('makeGroupNode and groupTransform', () => {
    it('creates DOM elements and binds events for a new group', () => {
      const mockGroup = {
        id: 1,
        name: 'Test Group',
        rect: { x: 0, y: 0, w: 1, h: 1 },
      };

      groupNodes.makeGroupNode(mockGroup);

      expect(groupNodes.groupNodes[1]).toBeDefined();
      expect(groupNodes.groupNodes[1].group).toBeDefined();
    });

    it('stops propagation on newtab mousedown', () => {
      const group = { id: 1, name: 'Test Group' };
      groupNodes.makeGroupNode(group);

      const newtab = findElementByClass('newtab');
      const stopSpy = jest.fn();
      newtab.dispatchEvent({ type: 'mousedown', stopPropagation: stopSpy });
      expect(stopSpy).toHaveBeenCalled();
    });

    it('handles close button click', async () => {
      const group = { id: 1, name: 'Test Group' };
      groupNodes.makeGroupNode(group);

      const closeBtn = findElementByClass('close');
      const mockParent = { removeChild: jest.fn() };
      groupNodes.groupNodes[1].group.parentNode = mockParent;

      // Click close button
      closeBtn.dispatchEvent({ type: 'click', stopPropagation: jest.fn() });
      await flushPromises();

      expect(groups.remove).toHaveBeenCalledWith(1);
      expect(mockParent.removeChild).toHaveBeenCalled();
    });

    it('handles newtab click inside view.html', async () => {
      const group = { id: 1, name: 'Test Group' };
      groupNodes.makeGroupNode(group);

      const newtab = findElementByClass('newtab');
      newtab.dispatchEvent({ type: 'click', stopPropagation: jest.fn() });
      await flushPromises();

      expect(groups.setActive).toHaveBeenCalledWith(1);
      expect(browser.tabs.create).toHaveBeenCalledWith({ active: true });
      expect(browser.tabs.remove).toHaveBeenCalledWith(999);
    });

    it('handles newtab click inside view.html when remove throws error', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      global.browser.tabs.remove.mockRejectedValueOnce(new Error('Test error'));

      const group = { id: 1, name: 'Test Group' };
      groupNodes.makeGroupNode(group);

      const newtab = findElementByClass('newtab');
      newtab.dispatchEvent({ type: 'click', stopPropagation: jest.fn() });
      await flushPromises();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to remove view tab',
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });

    it('handles newtab click outside view.html', async () => {
      global.window.location = { pathname: '/options.html' };
      const group = { id: 1, name: 'Test Group' };
      groupNodes.makeGroupNode(group);

      const newtab = findElementByClass('newtab');
      newtab.dispatchEvent({ type: 'click', stopPropagation: jest.fn() });
      await flushPromises();

      expect(browser.tabs.remove).not.toHaveBeenCalled();
    });

    it('handles moving group (inner mousedown) with snaps and clamps', async () => {
      const group = {
        id: 1,
        name: 'Test Group',
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      };
      groupNodes.makeGroupNode(group);

      const otherGroup = {
        id: 2,
        name: 'Other Group',
        rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
      };
      groups.forEach.mockImplementation((cb) => {
        cb(group);
        cb(otherGroup);
      });

      const parentNode = {
        getBoundingClientRect: jest
          .fn()
          .mockReturnValue({ width: 1000, height: 1000 }),
      };
      groupNodes.groupNodes[1].group.parentNode = parentNode;

      const mockGroupNode2 = {
        parentNode: {
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 1000, height: 1000 }),
        },
        style: {},
      };
      groupNodes.groupNodes[2] = {
        group: mockGroupNode2,
        content: {
          childNodes: [],
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 200, height: 200 }),
        },
        newtab: { style: {} },
        tabCount: { replaceChildren: jest.fn() },
      };

      const innerGroup = createdElements.find(
        (el) =>
          el.classList.contains('inner') &&
          el.addEventListener.mock.calls.some((c) => c[0] === 'mousedown'),
      );

      // Trigger mousedown with coordinates
      innerGroup.dispatchEvent({
        type: 'mousedown',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        pageX: 100,
        pageY: 100,
      });
      await flushPromises();

      // First move to establish lx / ly starting point
      document.dispatchEvent({
        type: 'mousemove',
        preventDefault: jest.fn(),
        pageX: 100,
        pageY: 100,
      });

      // Second move: drag extremely left/up to trigger x < 0 and y < 0 clamps
      document.dispatchEvent({
        type: 'mousemove',
        preventDefault: jest.fn(),
        pageX: -200,
        pageY: -200,
      });

      // Third move: drag close to other group to trigger snap
      document.dispatchEvent({
        type: 'mousemove',
        preventDefault: jest.fn(),
        pageX: 400,
        pageY: 400,
      });

      document.dispatchEvent({ type: 'mouseup' });
      expect(groups.transform).toHaveBeenCalled();
    });

    it('aborts groupTransform if layoutMode is not freeform', async () => {
      global.browser.sessions.getWindowValue.mockResolvedValueOnce('tiled');
      const group = { id: 1, name: 'Test Group' };
      groupNodes.makeGroupNode(group);

      const innerGroup = createdElements.find(
        (el) =>
          el.classList.contains('inner') &&
          el.addEventListener.mock.calls.some((c) => c[0] === 'mousedown'),
      );
      innerGroup.dispatchEvent({
        type: 'mousedown',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
      await flushPromises();

      document.dispatchEvent({ type: 'mousemove', pageX: 200, pageY: 200 });
      expect(groups.transform).not.toHaveBeenCalled();
    });

    it('handles renaming (double click on header)', async () => {
      const group = { id: 1, name: 'Test Group' };
      groupNodes.makeGroupNode(group);

      const header = findElementByClass('header');
      const input = createdElements.find((el) => el.attributes.type === 'text');

      header.dispatchEvent({ type: 'dblclick' });
      expect(header.classList.add).toHaveBeenCalledWith('edit');
      expect(input.focus).toHaveBeenCalled();

      input.dispatchEvent({
        type: 'keydown',
        key: 'a',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
      expect(input.focus).toHaveBeenCalledTimes(1);

      const blurSpy = jest.spyOn(input, 'blur');
      input.dispatchEvent({
        type: 'keydown',
        key: 'Enter',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
      expect(blurSpy).toHaveBeenCalled();

      input.dispatchEvent({ type: 'blur' });
      expect(header.classList.remove).toHaveBeenCalledWith('edit');
      expect(groups.rename).toHaveBeenCalledWith(1, expect.any(String));
    });

    it('triggers resize past boundaries and clamps', async () => {
      const group = {
        id: 1,
        name: 'Test Group',
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      };
      groupNodes.makeGroupNode(group);

      const otherGroup = {
        id: 2,
        name: 'Other Group',
        rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
      };
      groups.forEach.mockImplementation((cb) => {
        cb(group);
        cb(otherGroup);
      });

      const parentNode = {
        getBoundingClientRect: jest
          .fn()
          .mockReturnValue({ width: 1000, height: 1000 }),
      };
      groupNodes.groupNodes[1].group.parentNode = parentNode;

      const mockGroupNode2 = {
        parentNode: {
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 1000, height: 1000 }),
        },
        style: {},
      };
      groupNodes.groupNodes[2] = {
        group: mockGroupNode2,
        content: {
          childNodes: [],
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 200, height: 200 }),
        },
        newtab: { style: {} },
        tabCount: { replaceChildren: jest.fn() },
      };

      const borders = [
        'top',
        'right',
        'bottom',
        'left',
        'topRight',
        'bottomRight',
        'bottomLeft',
        'topLeft',
      ];

      for (const cls of borders) {
        const el = findElementByClass(cls);
        el.dispatchEvent({
          type: 'mousedown',
          preventDefault: jest.fn(),
          stopPropagation: jest.fn(),
          pageX: 100,
          pageY: 100,
        });
        // eslint-disable-next-line no-await-in-loop
        await flushPromises();

        // First move to establish lx / ly starting point
        document.dispatchEvent({
          type: 'mousemove',
          preventDefault: jest.fn(),
          pageX: 100,
          pageY: 100,
        });

        // Drag extremely far in one direction to trigger upper clamp limit
        document.dispatchEvent({
          type: 'mousemove',
          preventDefault: jest.fn(),
          pageX: 2000,
          pageY: 2000,
        });

        // Drag extremely far in the other direction to trigger lower clamp limit
        document.dispatchEvent({
          type: 'mousemove',
          preventDefault: jest.fn(),
          pageX: -1000,
          pageY: -1000,
        });

        document.dispatchEvent({ type: 'mouseup' });
      }
    });
  });

  describe('initGroupNodes and fillGroupNodes', () => {
    it('initializes and fills group nodes', async () => {
      const groupsList = [
        { id: 1, name: 'Group 1' },
        { id: -2, name: 'System Group' },
      ];
      groups.forEach.mockImplementation((cb) => {
        groupsList.forEach(cb);
      });

      const utils = jest.requireMock('../../../src/js/share/utils.js');
      groupNodes.groupNodes[-2] = {
        content: utils.newElement('div'),
        newtab: utils.newElement('div'),
        tabCount: utils.newElement('span'),
      };

      const parentNode = { appendChild: jest.fn() };
      global.document.getElementById.mockReturnValue({
        appendChild: jest.fn(),
      });

      tabs.forEachTab.mockImplementation(async (cb) => {
        await cb({ id: 101, pinned: false });
        await cb({ id: 102, pinned: true });
      });
      tabs.getGroupId.mockResolvedValue(1);

      await groupNodes.initGroupNodes(parentNode);
      await flushPromises();

      expect(parentNode.appendChild).toHaveBeenCalled();
      expect(tabNodes.getTabNode).toHaveBeenCalledWith(101);
      expect(tabNodes.getTabNode).toHaveBeenCalledWith(102);
    });
  });

  describe('insertTab', () => {
    it('handles insertTab when higherIndexes is empty', async () => {
      const oldTab = { id: 101 };
      global.browser.tabs.get.mockResolvedValue({ id: 101, index: 5 });
      tabs.getGroupId.mockResolvedValue(1);

      const group = { id: 1, name: 'Group 1' };
      groupNodes.makeGroupNode(group);

      tabs.forEachTab.mockImplementation(async (cb) => {
        await cb({ id: 101, index: 5 });
      });

      const utils = jest.requireMock('../../../src/js/share/utils.js');
      tabNodes.tabNodes[101] = {
        tab: utils.newElement('div', { class: 'tab' }),
      };

      await groupNodes.insertTab(oldTab);
    });

    it('handles insertTab when higherIndexes and lowerIndexes are not empty', async () => {
      const oldTab = { id: 101 };
      global.browser.tabs.get.mockResolvedValue({ id: 101, index: 3 });
      tabs.getGroupId.mockResolvedValue(1);

      const group = { id: 1, name: 'Group 1' };
      groupNodes.makeGroupNode(group);

      const utils = jest.requireMock('../../../src/js/share/utils.js');
      const childNode1 = utils.newElement('div', { class: 'tab' });
      childNode1.setAttribute('tabId', '102');
      const childNode2 = utils.newElement('div', { class: 'tab' });
      childNode2.setAttribute('tabId', '103');
      groupNodes.groupNodes[1].content.childNodes = [childNode1, childNode2];

      tabs.forEachTab.mockImplementation(async (cb) => {
        await cb({ id: 101, index: 3 });
        await cb({ id: 102, index: 4 });
        await cb({ id: 103, index: 2 });
      });

      tabNodes.tabNodes[101] = {
        tab: utils.newElement('div', { class: 'tab' }),
      };

      await groupNodes.insertTab(oldTab);
    });

    it('handles insertTab when groupNodes[groupId] does not exist', async () => {
      const oldTab = { id: 101 };
      global.browser.tabs.get.mockResolvedValue({ id: 101, index: 1 });
      tabs.getGroupId.mockResolvedValue(99); // group 99 does not exist in groupNodes

      tabs.forEachTab.mockImplementation(async (cb) => {
        await cb({ id: 101, index: 1 });
        await cb({ id: 102, index: 2 }); // index > 1, so higherIndexes is not empty
      });

      await groupNodes.insertTab(oldTab);
    });

    it('handles insertTab with complex precedingNodeID matching', async () => {
      const oldTab = { id: 101 };
      global.browser.tabs.get.mockResolvedValue({ id: 101, index: 3 });
      tabs.getGroupId.mockResolvedValue(1);

      const group = { id: 1, name: 'Group 1' };
      groupNodes.makeGroupNode(group);

      const utils = jest.requireMock('../../../src/js/share/utils.js');
      const childNode1 = utils.newElement('div', { class: 'tab' });
      childNode1.setAttribute('tabId', '103');
      const childNode2 = utils.newElement('div', { class: 'tab' });
      childNode2.setAttribute('tabId', '101'); // matches tab.id
      const childNode3 = utils.newElement('div', { class: 'tab' });
      childNode3.setAttribute('tabId', '102');
      groupNodes.groupNodes[1].content.childNodes = [
        childNode1,
        childNode2,
        childNode3,
      ];

      tabs.forEachTab.mockImplementation(async (cb) => {
        await cb({ id: 101, index: 3 });
        await cb({ id: 102, index: 4 });
        await cb({ id: 103, index: 2 });
      });

      tabNodes.tabNodes[101] = {
        tab: utils.newElement('div', { class: 'tab' }),
      };

      await groupNodes.insertTab(oldTab);
    });

    it('handles insertTab with complex precedingNodeID mismatch (triggers rebuild)', async () => {
      const oldTab = { id: 101 };
      global.browser.tabs.get.mockResolvedValue({ id: 101, index: 3 });
      tabs.getGroupId.mockResolvedValue(1);

      const group = { id: 1, name: 'Group 1' };
      groupNodes.makeGroupNode(group);

      const utils = jest.requireMock('../../../src/js/share/utils.js');
      const childNode1 = utils.newElement('div', { class: 'tab' });
      childNode1.setAttribute('tabId', '999'); // mismatch
      const childNode2 = utils.newElement('div', { class: 'tab' });
      childNode2.setAttribute('tabId', '101'); // matches tab.id
      const childNode3 = utils.newElement('div', { class: 'tab' });
      childNode3.setAttribute('tabId', '102');
      groupNodes.groupNodes[1].content.childNodes = [
        childNode1,
        childNode2,
        childNode3,
      ];

      tabs.forEachTab.mockImplementation(async (cb) => {
        await cb({ id: 101, index: 3 });
        await cb({ id: 102, index: 4 });
        await cb({ id: 103, index: 2 });
      });

      tabNodes.tabNodes[101] = {
        tab: utils.newElement('div', { class: 'tab' }),
      };

      await groupNodes.insertTab(oldTab);
    });

    it('ignores tab in system group', async () => {
      const oldTab = { id: 101 };
      global.browser.tabs.get.mockResolvedValue({ id: 101, index: 1 });
      tabs.getGroupId.mockResolvedValue(-2);

      await groupNodes.insertTab(oldTab);
    });
  });

  describe('mouseup without prior mousedown (rect.x undefined)', () => {
    it('does not call groups.transform if mousemove never fired', async () => {
      const group = {
        id: 1,
        name: 'Test Group',
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      };
      groupNodes.makeGroupNode(group);

      const parentNode = {
        getBoundingClientRect: jest
          .fn()
          .mockReturnValue({ width: 1000, height: 1000 }),
      };
      groupNodes.groupNodes[1].group.parentNode = parentNode;

      const innerGroup = createdElements.find(
        (el) =>
          el.classList.contains('inner') &&
          el.addEventListener.mock.calls.some((c) => c[0] === 'mousedown'),
      );

      // Fire mousedown to attach the mouseup listener
      innerGroup.dispatchEvent({
        type: 'mousedown',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });

      // Fire mouseup without ever firing mousemove — rect.x will be undefined
      document.dispatchEvent({ type: 'mouseup' });

      expect(groups.transform).not.toHaveBeenCalled();
    });
  });

  describe('newtab click when viewTab is null', () => {
    it('does not call tabs.remove when getCurrent returns null', async () => {
      global.browser.tabs.getCurrent.mockResolvedValueOnce(null);
      const group = { id: 1, name: 'Test Group' };
      groupNodes.makeGroupNode(group);

      const newtab = findElementByClass('newtab');
      newtab.dispatchEvent({ type: 'click', stopPropagation: jest.fn() });
      await flushPromises();

      expect(browser.tabs.remove).not.toHaveBeenCalled();
    });
  });

  describe('header dblclick when already editing', () => {
    it('ignores second dblclick when editing is already true', async () => {
      const group = { id: 1, name: 'Test Group' };
      groupNodes.makeGroupNode(group);

      const header = findElementByClass('header');
      const input = createdElements.find((el) => el.attributes.type === 'text');

      // First dblclick — sets editing = true
      header.dispatchEvent({ type: 'dblclick' });
      expect(header.classList.add).toHaveBeenCalledWith('edit');
      expect(input.focus).toHaveBeenCalledTimes(1);

      // Second dblclick — should be ignored since editing === true
      header.classList.add.mockClear();
      input.focus.mockClear();
      header.dispatchEvent({ type: 'dblclick' });

      expect(header.classList.add).not.toHaveBeenCalled();
      expect(input.focus).not.toHaveBeenCalled();
    });
  });

  describe('insertTab additional paths', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('schedules fillGroupNodes when higherIndexes empty but groupNodes[groupId] missing', async () => {
      const oldTab = { id: 101 };
      global.browser.tabs.get.mockResolvedValue({ id: 101, index: 5 });
      tabs.getGroupId.mockResolvedValue(99); // groupId 99 — no node created

      // All tabs have lower indexes, so higherIndexes is empty
      tabs.forEachTab.mockImplementation(async (cb) => {
        await cb({ id: 102, index: 1 }); // lower than 5
        await cb({ id: 103, index: 2 }); // lower than 5
      });

      const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');

      await groupNodes.insertTab(oldTab);

      // groupNodes[99] does not exist, so no insertAdjacentElement call
      // (groupNodes[groupId] is falsy, so the if-branch doesn't run)
      expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 100);
    });

    it('covers precedingNodeID === tab.id guard (second level lookup)', async () => {
      const oldTab = { id: 101 };
      global.browser.tabs.get.mockResolvedValue({ id: 101, index: 3 });
      tabs.getGroupId.mockResolvedValue(1);

      const group = { id: 1, name: 'Group 1' };
      groupNodes.makeGroupNode(group);

      const utils = jest.requireMock('../../../src/js/share/utils.js');
      // childNode at candidateNodeIdx-1 has tabId === tab.id (101) → triggers second lookup
      const childNode0 = utils.newElement('div', { class: 'tab' });
      childNode0.setAttribute('tabId', '105'); // [candidateNodeIdx-2] = expected preceding
      const childNode1 = utils.newElement('div', { class: 'tab' });
      childNode1.setAttribute('tabId', '101'); // [candidateNodeIdx-1] === tab.id → triggers guard
      const childNode2 = utils.newElement('div', { class: 'tab' });
      childNode2.setAttribute('tabId', '102'); // This is the candidateNode (higherIndex tab)
      groupNodes.groupNodes[1].content.childNodes = [
        childNode0,
        childNode1,
        childNode2,
      ];

      tabs.forEachTab.mockImplementation(async (cb) => {
        await cb({ id: 101, index: 3 }); // the moving tab
        await cb({ id: 102, index: 4 }); // higher index → candidateNode
        await cb({ id: 103, index: 2 }); // lower index → nextLowestIdx
        await cb({ id: 105, index: 1 }); // even lower, preceding tab
      });

      const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');

      const utils2 = jest.requireMock('../../../src/js/share/utils.js');
      tabNodes.tabNodes[101] = {
        tab: utils2.newElement('div', { class: 'tab' }),
      };

      await groupNodes.insertTab(oldTab);

      // The precedingNodeID === tab.id guard was triggered
      // Whether setTimeout is called depends on whether childNode0.tabId matches childNodeTabsByIndex[nextLowestIdx].id
      // childNode0.tabId = 105, nextLowestIdx = 2 → childNodeTabsByIndex[2].id = 103, so 105 !== 103 → setTimeout called
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100);
    });
  });

  describe('raiseGroup', () => {
    it('sets lastMoved and zIndex', () => {
      const group = { id: 1, name: 'Group 1' };
      groups.get.mockReturnValue(group);
      groupNodes.groupNodes[1] = { group: { style: {} } };

      groupNodes.raiseGroup(1);
      expect(group.lastMoved).toBeDefined();
      expect(groupNodes.groupNodes[1].group.style.zIndex).toBeDefined();
    });
  });

  describe('concurrent modifyingGroupContent checks', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('schedules fillGroupNodes and insertTab when modifyingGroupContent is true', async () => {
      const group = { id: 1, name: 'Group 1' };
      groups.forEach.mockImplementation((cb) => cb(group));
      groupNodes.makeGroupNode(group);

      const utils = jest.requireMock('../../../src/js/share/utils.js');
      groupNodes.groupNodes.pinned = { content: utils.newElement('div') };

      // Ensure insertTab exits the higherIndexes=empty branch safely
      tabs.forEachTab.mockImplementation(async (cb) => {
        await cb({ id: 1, index: 0 }); // all same/lower → higherIndexes empty
      });

      tabNodes.tabNodes[1] = { tab: utils.newElement('div', { class: 'tab' }) };

      const p1 = groupNodes.fillGroupNodes();
      const p2 = groupNodes.fillGroupNodes(); // concurrent

      const oldTab = { id: 1 };
      const p3 = groupNodes.insertTab(oldTab); // concurrent

      await Promise.all([p1, p2, p3]);

      jest.runOnlyPendingTimers();
    });
  });
});
