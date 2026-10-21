import * as drag from '../../../src/js/view/drag.js';
import * as tabs from '../../../src/js/view/tabs.js';
import * as groupNodes from '../../../src/js/view/groupNodes.js';
import * as groups from '../../../src/js/view/groups.js';

jest.mock('../../../src/js/view/tabs.js');
jest.mock('../../../src/js/view/groupNodes.js');
jest.mock('../../../src/js/view/groups.js');

describe('view/drag.js', () => {
  let mockEvent;
  let mockElement;

  beforeEach(() => {
    jest.clearAllMocks();

    mockEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {
        setData: jest.fn(),
        setDragImage: jest.fn(),
        effectAllowed: '',
        dropEffect: '',
      },
      clientX: 50,
      clientY: 50,
      target: {
        appendChild: jest.fn(),
      },
    };

    mockElement = {
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        contains: jest.fn().mockReturnValue(false),
      },
      getBoundingClientRect: jest.fn().mockReturnValue({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      }),
      getAttribute: jest.fn().mockReturnValue('1'),
      insertAdjacentElement: jest.fn(),
    };

    global.browser = {
      windows: {
        getCurrent: jest.fn().mockResolvedValue({ id: 1 }),
      },
      tabs: {
        get: jest.fn().mockResolvedValue({ id: 1, index: 1 }),
        move: jest.fn().mockResolvedValue(),
        onMoved: {
          addListener: jest.fn(),
          removeListener: jest.fn(),
        },
      },
    };

    global.window = {
      scrollY: 0,
      innerWidth: 1000,
      innerHeight: 1000,
    };
  });

  describe('createDragIndicator', () => {
    it('creates and returns a drag indicator element', () => {
      const mockDiv = { setAttribute: jest.fn() };
      global.document = {
        createElement: jest.fn().mockReturnValue(mockDiv),
        createTextNode: jest.fn(),
      };

      const indicator = drag.createDragIndicator();
      expect(global.document.createElement).toHaveBeenCalledWith('div');
      expect(mockDiv.setAttribute).toHaveBeenCalledWith(
        'class',
        'drag_indicator',
      );
      expect(indicator).toBe(mockDiv);
    });
  });

  describe('tabMoved', () => {
    it('processes tab move if window matches', async () => {
      groups.getIds.mockReturnValue([1]);
      groups.get.mockReturnValue({ id: 1 });

      await drag.tabMoved(1, { windowId: 1 });

      expect(browser.tabs.get).toHaveBeenCalledWith(1);
      // Wait for the nested promises to resolve
      await new Promise(process.nextTick);
      expect(groupNodes.insertTab).toHaveBeenCalled();
      expect(groupNodes.updateGroupFit).toHaveBeenCalled();
    });

    it('ignores tab move if window does not match', async () => {
      await drag.tabMoved(1, { windowId: 2 });
      expect(browser.tabs.get).not.toHaveBeenCalled();
    });

    it('ignores tab move if group is not found', async () => {
      groups.getIds.mockReturnValue([1]);
      groups.get.mockReturnValue(null);

      await drag.tabMoved(1, { windowId: 1 });

      await new Promise(process.nextTick);
      expect(groupNodes.updateGroupFit).not.toHaveBeenCalled();
    });
  });

  describe('tabDragStart', () => {
    it('prevents default if tab is pinned', () => {
      mockElement.classList.contains.mockReturnValue(true);
      drag.tabDragStart.call(mockElement, mockEvent);
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('sets up drag properties', () => {
      drag.tabDragStart.call(mockElement, mockEvent);
      expect(mockElement.classList.add).toHaveBeenCalledWith('drag');
      expect(mockEvent.dataTransfer.setData).toHaveBeenCalledWith(
        'text/html',
        'pvDragging',
      );
      expect(mockEvent.dataTransfer.setDragImage).toHaveBeenCalledWith(
        mockElement,
        50,
        50,
      );
    });
  });

  describe('tabDragEnter and tabDragLeave', () => {
    beforeEach(() => {
      // Create drag indicator for these tests
      global.document = {
        createElement: jest.fn().mockReturnValue({
          setAttribute: jest.fn(),
          classList: { remove: jest.fn(), add: jest.fn() },
          style: {},
        }),
      };
      drag.createDragIndicator();
    });

    it('handles enter and leave correctly', () => {
      drag.tabDragEnter.call(mockElement, mockEvent);
      expect(mockEvent.preventDefault).toHaveBeenCalled();

      // Enter a different element
      const anotherElement = { ...mockElement };
      drag.tabDragEnter.call(anotherElement, mockEvent);
      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(2);

      drag.tabDragLeave.call(mockElement, mockEvent);
      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(3);

      drag.tabDragLeave.call(anotherElement, mockEvent);
      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(4);
    });
  });

  describe('tabDragOver', () => {
    beforeEach(() => {
      const mockIndicator = {
        setAttribute: jest.fn(),
        classList: { remove: jest.fn(), add: jest.fn() },
        style: {},
      };
      global.document = {
        createElement: jest.fn().mockReturnValue(mockIndicator),
      };
      drag.createDragIndicator();

      drag.tabDragStart.call(
        {
          getBoundingClientRect: jest
            .fn()
            .mockReturnValue({ width: 0, height: 0 }),
          classList: { add: jest.fn(), contains: jest.fn() },
        },
        mockEvent,
      );
    });

    it('calculates drag indicator position (before)', () => {
      drag.tabDragEnter.call(mockElement, mockEvent);
      mockEvent.clientX = 25; // Less than half of 100
      drag.tabDragOver(mockEvent);
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.dataTransfer.dropEffect).toBe('move');
    });

    it('calculates drag indicator position (after)', () => {
      drag.tabDragEnter.call(mockElement, mockEvent);
      mockEvent.clientX = 75; // More than half of 100
      drag.tabDragOver(mockEvent);
    });

    it('does not show indicator if dragTab is dragOverTab', () => {
      drag.tabDragStart.call(mockElement, mockEvent);
      drag.tabDragEnter.call(mockElement, mockEvent);
      const result = drag.tabDragOver(mockEvent);
      expect(result).toBe(false);
    });

    it('does not show indicator if dragOverTab is null', () => {
      drag.tabDragStart.call(mockElement, mockEvent);
      const result = drag.tabDragOver(mockEvent);
      expect(result).toBe(false);
    });
  });

  describe('tabDrop', () => {
    beforeEach(() => {
      const mockIndicator = {
        setAttribute: jest.fn(),
        classList: { remove: jest.fn(), add: jest.fn() },
        style: {},
      };
      global.document = {
        createElement: jest.fn().mockReturnValue(mockIndicator),
      };
      drag.createDragIndicator();
    });

    it('processes drop on a different tab', async () => {
      const draggedEl = {
        ...mockElement,
        getAttribute: jest.fn().mockReturnValue('1'),
      };
      const overEl = {
        ...mockElement,
        getAttribute: jest.fn().mockReturnValue('2'),
        insertAdjacentElement: jest.fn(),
      };

      draggedEl.classList.contains.mockReturnValue(false);
      draggedEl.getBoundingClientRect.mockReturnValue({
        width: 10,
        height: 10,
      });

      drag.tabDragStart.call(draggedEl, mockEvent);
      drag.tabDragEnter.call(overEl, mockEvent);

      tabs.getGroupId.mockResolvedValue(10);
      browser.tabs.get
        .mockResolvedValueOnce({ id: 1, index: 1 })
        .mockResolvedValueOnce({ id: 2, index: 2 });

      groups.forEach.mockImplementation((cb) => cb({})); // mock groups.forEach

      await drag.tabDrop(mockEvent);

      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(tabs.setGroupId).toHaveBeenCalledWith(1, 10);
      expect(browser.tabs.move).toHaveBeenCalled();
    });

    it('handles drop when dragDropBefore is true and tab.index < toTab.index', async () => {
      const draggedEl = {
        ...mockElement,
        getAttribute: jest.fn().mockReturnValue('1'),
      };
      const overEl = {
        ...mockElement,
        getAttribute: jest.fn().mockReturnValue('2'),
        insertAdjacentElement: jest.fn(),
      };
      drag.tabDragStart.call(draggedEl, mockEvent);
      drag.tabDragEnter.call(overEl, mockEvent);

      // Set dragDropBefore to true by calling tabDragOver with clientX < half width
      mockEvent.clientX = 20; // overEl rect is left: 0, width: 100
      drag.tabDragOver(mockEvent);

      tabs.getGroupId.mockResolvedValue(10);
      browser.tabs.get
        .mockResolvedValueOnce({ id: 1, index: 1 })
        .mockResolvedValueOnce({ id: 2, index: 3 });

      groups.forEach.mockImplementation((cb) => cb({}));

      await drag.tabDrop(mockEvent);

      expect(overEl.insertAdjacentElement).toHaveBeenCalledWith(
        'beforebegin',
        draggedEl,
      );
      expect(browser.tabs.move).toHaveBeenCalledWith(1, { index: 2 });
    });

    it('handles drop when dragDropBefore is false and tab.index >= toTab.index', async () => {
      const draggedEl = {
        ...mockElement,
        getAttribute: jest.fn().mockReturnValue('1'),
      };
      const overEl = {
        ...mockElement,
        getAttribute: jest.fn().mockReturnValue('2'),
        insertAdjacentElement: jest.fn(),
      };
      drag.tabDragStart.call(draggedEl, mockEvent);
      drag.tabDragEnter.call(overEl, mockEvent);

      // Set dragDropBefore to false
      mockEvent.clientX = 80;
      drag.tabDragOver(mockEvent);

      tabs.getGroupId.mockResolvedValue(10);
      browser.tabs.get
        .mockResolvedValueOnce({ id: 1, index: 3 })
        .mockResolvedValueOnce({ id: 2, index: 1 });

      groups.forEach.mockImplementation((cb) => cb({}));

      await drag.tabDrop(mockEvent);

      expect(overEl.insertAdjacentElement).toHaveBeenCalledWith(
        'afterend',
        draggedEl,
      );
      expect(browser.tabs.move).toHaveBeenCalledWith(1, { index: 0 });
    });

    it('does nothing if dropped on the same tab', async () => {
      drag.tabDragStart.call(mockElement, mockEvent);
      drag.tabDragEnter.call(mockElement, mockEvent);

      const result = await drag.tabDrop(mockEvent);
      expect(result).toBe(false);
      expect(tabs.setGroupId).not.toHaveBeenCalled();
    });

    it('handles drop when dragDropBefore is true and tab.index >= toTab.index', async () => {
      const draggedEl = {
        ...mockElement,
        getAttribute: jest.fn().mockReturnValue('1'),
      };
      const overEl = {
        ...mockElement,
        getAttribute: jest.fn().mockReturnValue('2'),
        insertAdjacentElement: jest.fn(),
      };
      drag.tabDragStart.call(draggedEl, mockEvent);
      drag.tabDragEnter.call(overEl, mockEvent);

      // Set dragDropBefore to true
      mockEvent.clientX = 20;
      drag.tabDragOver(mockEvent);

      tabs.getGroupId.mockResolvedValue(10);
      browser.tabs.get
        .mockResolvedValueOnce({ id: 1, index: 3 })
        .mockResolvedValueOnce({ id: 2, index: 1 });

      groups.forEach.mockImplementation((cb) => cb({}));

      await drag.tabDrop(mockEvent);

      expect(browser.tabs.move).toHaveBeenCalledWith(1, { index: 1 });
    });
  });

  describe('groupDrop and outsideDrop', () => {
    beforeEach(() => {
      const mockIndicator = {
        setAttribute: jest.fn(),
        classList: { remove: jest.fn(), add: jest.fn() },
        style: {},
      };
      global.document = {
        createElement: jest.fn().mockReturnValue(mockIndicator),
      };
      drag.createDragIndicator();
      drag.tabDragStart.call(mockElement, mockEvent);
    });

    it('handles outsideDrop', async () => {
      const newGroup = { id: 1, rect: {} };
      groups.create.mockResolvedValue(newGroup);
      groupNodes.groupNodes[1] = {
        newtab: { insertAdjacentElement: jest.fn() },
        group: { scrollIntoView: jest.fn() },
      };

      await drag.outsideDrop(mockEvent);

      expect(groups.create).toHaveBeenCalled();
      expect(groupNodes.makeGroupNode).toHaveBeenCalledWith(newGroup);
    });

    it('handles groupDrop', async () => {
      groupNodes.groupNodes[1] = {
        newtab: { insertAdjacentElement: jest.fn() },
      };

      await drag.groupDrop.call(mockElement, mockEvent);
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(tabs.setGroupId).toHaveBeenCalled();
    });
  });

  describe('tabDragEnd', () => {
    it('cleans up drag classes', () => {
      const mockIndicator = {
        setAttribute: jest.fn(),
        classList: { remove: jest.fn(), add: jest.fn() },
        style: {},
      };
      global.document = {
        createElement: jest.fn().mockReturnValue(mockIndicator),
      };
      drag.createDragIndicator();

      drag.tabDragEnd.call(mockElement);
      expect(mockElement.classList.remove).toHaveBeenCalledWith('drag');
      expect(mockIndicator.classList.remove).toHaveBeenCalledWith('show');
    });
  });

  describe('groupDragOver', () => {
    it('prevents default', () => {
      drag.groupDragOver(mockEvent);
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.dataTransfer.dropEffect).toBe('move');
    });
  });
});
