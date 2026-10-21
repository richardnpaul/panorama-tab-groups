/* eslint-disable max-classes-per-file */
import {
  tabNodes,
  getTabNode,
  makeTabNode,
  updateTabNode,
  setActiveTabNode,
  setActiveTabNodeById,
  getActiveTabId,
  deleteTabNode,
  updateThumbnail,
  updateFavicon,
  initTabNodes,
} from '../../../src/js/view/tabNodes.js';
import * as tabs from '../../../src/js/view/tabs.js';

// Mock the drag handlers
jest.mock('../../../src/js/view/drag.js', () => ({
  tabDragStart: jest.fn(),
  tabDragEnter: jest.fn(),
  tabDragOver: jest.fn(),
  tabDragLeave: jest.fn(),
  tabDrop: jest.fn(),
  tabDragEnd: jest.fn(),
}));

// Mock browser APIs
beforeEach(() => {
  jest.clearAllMocks();

  // Clear the tabNodes object
  Object.keys(tabNodes).forEach((key) => delete tabNodes[key]);

  globalThis.browser = {
    tabs: {
      update: jest.fn().mockResolvedValue(),
      remove: jest.fn().mockResolvedValue(),
      getCurrent: jest.fn().mockResolvedValue({ id: 999 }),
      query: jest.fn().mockResolvedValue([]),
    },
    sessions: {
      getTabValue: jest.fn().mockResolvedValue(null),
      setTabValue: jest.fn().mockResolvedValue(),
    },
    i18n: {
      getMessage: jest.fn(() => 'Close'),
    },
  };

  // Mock global document if not using jsdom or just to be safe
  if (typeof document === 'undefined') {
    global.document = {
      createElement: jest.fn().mockImplementation(() => {
        const classes = new Set();
        const listeners = {};
        return {
          parentNode: { removeChild: jest.fn() },
          classList: {
            add: jest.fn((c) => classes.add(c)),
            remove: jest.fn((c) => classes.delete(c)),
            contains: jest.fn((c) => classes.has(c)),
          },
          style: {},
          addEventListener: jest.fn((event, handler) => {
            listeners[event] = listeners[event] || [];
            listeners[event].push(handler);
          }),
          appendChild: jest.fn(),
          removeChild: jest.fn(),
          replaceChildren: jest.fn(),
          setAttribute: jest.fn(),
          dispatchEvent: jest.fn((event) => {
            if (listeners[event.type]) {
              listeners[event.type].forEach((h) => h(event));
            }
          }),
        };
      }),
      createTextNode: jest.fn().mockReturnValue({}),
    };
    global.window = {
      location: { pathname: '/view.html' },
    };
    global.MouseEvent = function MouseEvent(type) {
      this.type = type;
      this.preventDefault = jest.fn();
      this.stopPropagation = jest.fn();
    };
  }

  // Mock testImage behavior
  global.Image = class {
    constructor() {
      setTimeout(() => {
        if (this.src && this.src.includes('good')) {
          if (this.onload) this.onload();
        } else if (this.onerror) this.onerror();
      }, 10);
    }
  };
});

describe('view/tabNodes.js', () => {
  const sampleTab = {
    id: 101,
    title: 'Test Tab',
    discarded: false,
    pinned: false,
    lastAccessed: 1000,
    url: 'https://example.com',
    favIconUrl: 'https://example.com/good-favicon.ico',
  };

  describe('makeTabNode', () => {
    it('creates a tab node and adds event listeners', () => {
      makeTabNode(sampleTab);

      expect(tabNodes[101]).toBeDefined();
      const nodeObj = tabNodes[101];

      expect(nodeObj.tab).toBeDefined();
      expect(nodeObj.inner).toBeDefined();
      expect(nodeObj.thumbnail).toBeDefined();
      expect(nodeObj.favicon).toBeDefined();
      expect(nodeObj.close).toBeDefined();
      expect(nodeObj.name).toBeDefined();

      // We can also test the getTabNode function
      expect(getTabNode(101)).toBe(nodeObj.tab);
    });

    it('handles click events properly', async () => {
      makeTabNode(sampleTab);
      const tabElement = getTabNode(101);

      // Simulate click
      const event = new MouseEvent('click');
      event.stopPropagation = jest.fn();

      // In JSDOM, dispatching event might be async if there's an async listener
      tabElement.dispatchEvent(event);

      // We need to wait a tick for the async listener to finish
      await new Promise(process.nextTick);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(globalThis.browser.tabs.update).toHaveBeenCalledWith(101, {
        active: true,
      });
    });

    it('handles close button click', () => {
      makeTabNode(sampleTab);
      const closeBtn = tabNodes[101].close;

      const event = new MouseEvent('click');
      event.stopPropagation = jest.fn();
      closeBtn.dispatchEvent(event);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(globalThis.browser.tabs.remove).toHaveBeenCalledWith(101);
    });

    it('does not remove view tab if not on view.html, or if tab is missing/throws', async () => {
      // 1. Not view.html
      const origLocation = global.window.location;
      global.window.location = { pathname: '/options.html' };
      makeTabNode(sampleTab);
      let tabElement = getTabNode(101);
      let event = new MouseEvent('click');
      tabElement.dispatchEvent(event);
      await new Promise(process.nextTick);
      expect(globalThis.browser.tabs.remove).not.toHaveBeenCalled();

      // Restore location
      global.window.location = origLocation;

      // 2. getCurrent returns null
      globalThis.browser.tabs.getCurrent.mockResolvedValueOnce(null);
      makeTabNode(sampleTab);
      tabElement = getTabNode(101);
      event = new MouseEvent('click');
      tabElement.dispatchEvent(event);
      await new Promise(process.nextTick);
      expect(globalThis.browser.tabs.remove).not.toHaveBeenCalled();

      // 3. getCurrent throws error
      globalThis.browser.tabs.getCurrent.mockRejectedValueOnce(
        new Error('Rejected'),
      );
      makeTabNode(sampleTab);
      tabElement = getTabNode(101);
      event = new MouseEvent('click');
      tabElement.dispatchEvent(event);
      await new Promise(process.nextTick);
      expect(globalThis.browser.tabs.remove).not.toHaveBeenCalled();
    });

    it('handles auxclick and mousedown events', () => {
      makeTabNode(sampleTab);
      const tabElement = getTabNode(101);

      // Mouse event for mousedown
      const mousedownEvent = {
        type: 'mousedown',
        stopPropagation: jest.fn(),
      };
      tabElement.dispatchEvent(mousedownEvent);
      expect(mousedownEvent.stopPropagation).toHaveBeenCalled();

      // Mouse event for auxclick (non-middle click)
      const auxclickEvent1 = {
        type: 'auxclick',
        button: 0,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      };
      tabElement.dispatchEvent(auxclickEvent1);
      expect(browser.tabs.remove).not.toHaveBeenCalled();

      // Mouse event for auxclick (middle click)
      const auxclickEvent2 = {
        type: 'auxclick',
        button: 1,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      };
      tabElement.dispatchEvent(auxclickEvent2);
      expect(browser.tabs.remove).toHaveBeenCalledWith(101);
    });
  });

  describe('updateTabNode', () => {
    it('updates text and classes for a tab node', () => {
      makeTabNode(sampleTab);

      const updatedTab = {
        ...sampleTab,
        title: 'Updated Title',
        discarded: true,
        pinned: true,
      };
      updateTabNode(updatedTab);

      const nodeObj = tabNodes[101];
      expect(nodeObj.inner.title).toBe('Updated Title');
      expect(nodeObj.tab.classList.contains('inactive')).toBe(true);
      expect(nodeObj.tab.classList.contains('pinned')).toBe(true);
    });

    it('does nothing if node does not exist', () => {
      expect(() => updateTabNode(sampleTab)).not.toThrow();
    });

    it('removes inactive and pinned classes if tab properties change', () => {
      makeTabNode(sampleTab);

      // Start with active & pinned
      updateTabNode({
        ...sampleTab,
        discarded: true,
        pinned: true,
      });
      expect(tabNodes[101].tab.classList.contains('inactive')).toBe(true);
      expect(tabNodes[101].tab.classList.contains('pinned')).toBe(true);

      // Update to not active & not pinned
      updateTabNode({
        ...sampleTab,
        discarded: false,
        pinned: false,
      });
      expect(tabNodes[101].tab.classList.contains('inactive')).toBe(false);
      expect(tabNodes[101].tab.classList.contains('pinned')).toBe(false);
    });
  });

  describe('setActiveTabNode', () => {
    it('sets the most recently accessed tab as active, ignoring the given tabId', async () => {
      makeTabNode(sampleTab); // id 101, lastAccessed 1000
      makeTabNode({ id: 102, lastAccessed: 2000 });
      makeTabNode({ id: 103, lastAccessed: 500 });

      jest.spyOn(tabs, 'forEachTabSync').mockImplementation(async (cb) => {
        cb(sampleTab);
        cb({ id: 102, lastAccessed: 2000 });
        cb({ id: 103, lastAccessed: 500 });
      });

      await setActiveTabNode(101); // 101 is being closed/ignored

      expect(tabNodes[102].tab.classList.contains('selected')).toBe(true);
      expect(tabNodes[101].tab.classList.contains('selected')).toBe(false);
      expect(getActiveTabId()).toBe(102);
    });

    it('handles missing tab nodes and no active tab in setActiveTabNode', async () => {
      // 1. Missing node in tabNodes
      makeTabNode(sampleTab);
      setActiveTabNodeById(101);

      jest.spyOn(tabs, 'forEachTabSync').mockImplementationOnce(async (cb) => {
        cb(sampleTab);
        cb({ id: 999, lastAccessed: 500 });
      });
      await setActiveTabNode(101);
      expect(getActiveTabId()).toBe(101);

      // 2. lastActive is -1
      jest.spyOn(tabs, 'forEachTabSync').mockImplementationOnce(async (cb) => {
        cb(sampleTab);
      });
      await setActiveTabNode(101);
    });
  });

  describe('setActiveTabNodeById', () => {
    it('sets a specific tab as active', () => {
      makeTabNode(sampleTab);
      makeTabNode({ id: 102 });

      setActiveTabNodeById(102);

      expect(tabNodes[102].tab.classList.contains('selected')).toBe(true);
      expect(tabNodes[101].tab.classList.contains('selected')).toBe(false);
      expect(getActiveTabId()).toBe(102);
    });
  });

  describe('deleteTabNode', () => {
    it('removes the node from the DOM and tabNodes object', () => {
      makeTabNode(sampleTab);
      const parent = document.createElement('div');
      tabNodes[101].tab.parentNode = parent; // manually set parentNode to our mock parent
      parent.appendChild(tabNodes[101].tab);

      deleteTabNode(101);

      expect(tabNodes[101]).toBeUndefined();
      expect(parent.removeChild).toHaveBeenCalled();
    });

    it('handles missing node or null parentNode in deleteTabNode', () => {
      deleteTabNode(999);

      makeTabNode(sampleTab);
      tabNodes[101].tab.parentNode = null;
      deleteTabNode(101);
      expect(tabNodes[101]).toBeDefined();
    });
  });

  describe('updateThumbnail', () => {
    it('updates background image with provided thumbnail', async () => {
      makeTabNode(sampleTab);

      await updateThumbnail(101, 'data:image/jpeg;base64,12345');

      expect(tabNodes[101].thumbnail.style.backgroundImage).toBe(
        'url(data:image/jpeg;base64,12345)',
      );
    });

    it('fetches thumbnail from session if not provided', async () => {
      makeTabNode(sampleTab);
      globalThis.browser.sessions.getTabValue.mockResolvedValue({
        thumbnail: 'data:image/jpeg;base64,67890',
      });

      await updateThumbnail(101);

      expect(tabNodes[101].thumbnail.style.backgroundImage).toBe(
        'url(data:image/jpeg;base64,67890)',
      );
    });

    it('clears thumbnail if no thumbnail is available', async () => {
      makeTabNode(sampleTab);
      globalThis.browser.sessions.getTabValue.mockResolvedValueOnce(null);

      await updateThumbnail(101);

      expect(tabNodes[101].thumbnail.style.backgroundImage).toBe('');
    });

    it('ignores updateThumbnail if node does not exist', async () => {
      await expect(updateThumbnail(999)).resolves.not.toThrow();
    });
  });

  describe('updateFavicon', () => {
    it('updates background image on successful load', async () => {
      makeTabNode(sampleTab);

      await updateFavicon(sampleTab); // url has 'good' so it resolves

      expect(tabNodes[101].favicon.style.backgroundImage).toBe(
        `url(${sampleTab.favIconUrl})`,
      );
      expect(tabNodes[101].favicon.classList.contains('visible')).toBe(true);
    });

    it('clears background image on failure', async () => {
      makeTabNode(sampleTab);

      await updateFavicon({
        ...sampleTab,
        favIconUrl: 'https://example.com/bad-favicon.ico',
      }); // url has no 'good'

      expect(tabNodes[101].favicon.style.backgroundImage).toBe('');
      expect(tabNodes[101].favicon.classList.contains('visible')).toBe(false);
    });

    it('ignores chrome:// urls and favicons that match url exactly', async () => {
      makeTabNode(sampleTab);

      await updateFavicon({
        ...sampleTab,
        favIconUrl: 'chrome://mozapps/skin/favicon.ico',
      });
      expect(tabNodes[101].favicon.classList.contains('visible')).toBe(false);

      await updateFavicon({ ...sampleTab, favIconUrl: 'https://example.com' }); // same as url
      expect(tabNodes[101].favicon.classList.contains('visible')).toBe(false);
    });

    it('handles image load abort', async () => {
      const origImage = global.Image;
      global.Image = class {
        constructor() {
          setTimeout(() => {
            if (this.onabort) this.onabort();
          }, 10);
        }
      };

      makeTabNode(sampleTab);
      await updateFavicon({
        ...sampleTab,
        favIconUrl: 'https://example.com/abort-favicon.ico',
      });

      expect(tabNodes[101].favicon.style.backgroundImage).toBe('');
      global.Image = origImage;
    });
  });

  describe('initTabNodes', () => {
    it('initializes tab nodes for all tabs and sets active tab node', async () => {
      const mockTabs = [
        {
          id: 101,
          title: 'Tab 1',
          discarded: false,
          pinned: false,
          lastAccessed: 1000,
          url: 'https://a.com',
        },
        {
          id: 102,
          title: 'Tab 2',
          discarded: false,
          pinned: false,
          lastAccessed: 2000,
          url: 'https://b.com',
        },
      ];

      jest.spyOn(tabs, 'forEachTab').mockImplementation(async (cb) => {
        for (const tab of mockTabs) {
          // eslint-disable-next-line no-await-in-loop
          await cb(tab);
        }
      });
      jest.spyOn(tabs, 'forEachTabSync').mockImplementation(async (cb) => {
        for (const tab of mockTabs) {
          // eslint-disable-next-line no-await-in-loop
          cb(tab);
        }
      });

      await initTabNodes(101);

      expect(tabNodes[101]).toBeDefined();
      expect(tabNodes[102]).toBeDefined();
      expect(tabNodes[102].tab.classList.contains('selected')).toBe(true);
    });
  });

  describe('updateFavicon edge cases', () => {
    it('ignores updateFavicon if node does not exist', async () => {
      await expect(updateFavicon({ id: 999 })).resolves.not.toThrow();
    });
  });
});
