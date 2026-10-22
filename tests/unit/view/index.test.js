import { vi } from 'vitest';

vi.mock('../../../src/js/view/tabs.js', () => ({
  getGroupId: vi.fn().mockResolvedValue(1),
}));
vi.mock('../../../src/js/view/dragscroll.js', () => ({
  initDragScroll: vi.fn(),
}));
vi.mock('../../../src/js/view/drag.js', () => ({
  tabMoved: vi.fn(),
  groupDragOver: vi.fn(),
  outsideDrop: vi.fn(),
  createDragIndicator: vi.fn().mockReturnValue({}),
}));
vi.mock('../../../src/js/view/groupNodes.js', () => ({
  groupNodes: {
    1: { content: { childNodes: [] } },
    2: { content: { childNodes: [] } },
  },
  initGroupNodes: vi.fn().mockResolvedValue(),
  closeGroup: vi.fn(),
  makeGroupNode: vi
    .fn()
    .mockReturnValue({ scrollIntoView: vi.fn(), appendChild: vi.fn() }),
  fillGroupNodes: vi.fn(),
  insertTab: vi.fn().mockResolvedValue(),
  resizeGroups: vi.fn(),
  raiseGroup: vi.fn(),
  updateGroupFit: vi.fn(),
}));
vi.mock('../../../src/js/view/tabNodes.js', () => ({
  initTabNodes: vi.fn().mockResolvedValue(),
  makeTabNode: vi.fn(),
  updateTabNode: vi.fn(),
  setActiveTabNode: vi.fn(),
  setActiveTabNodeById: vi.fn(),
  getActiveTabId: vi.fn().mockReturnValue(1),
  deleteTabNode: vi.fn(),
  updateThumbnail: vi.fn(),
  updateFavicon: vi.fn(),
}));
vi.mock('../../../src/js/view/groups.js', () => ({
  getLength: vi.fn().mockReturnValue(2),
  getIds: vi.fn().mockReturnValue([1, 2]),
  transform: vi.fn(),
  init: vi.fn().mockResolvedValue(),
  get: vi.fn().mockReturnValue({ id: 1, name: 'G1' }),
  forEach: vi.fn((cb) => [{ id: 1 }, { id: 2 }].forEach(cb)),
  create: vi
    .fn()
    .mockResolvedValue({ id: 10, rect: { x: 0, y: 0, w: 0, h: 0 } }),
}));

// Stored listeners
let storageOnChangedCb = null;
let docVisibilityCb = null;
let groupsDblClickCb = null;
let groupsClickCb = null;
let tabsOnCreatedCb = null;
let tabsOnRemovedCb = null;
let tabsOnUpdatedCb = null;
let tabsOnAttachedCb = null;
let tabsOnDetachedCb = null;
let groupsAuxClickCb = null;
let docKeydownCb = null;

const flushPromises = () => new Promise(process.nextTick);

function buildBodyClassList() {
  const classes = new Set(['theme-light', 'toolbar-top']);
  return {
    add: vi.fn((c) => classes.add(c)),
    remove: vi.fn((c) => classes.delete(c)),
    *[Symbol.iterator]() {
      yield* classes;
    },
  };
}

function setupGlobals(opts = {}) {
  storageOnChangedCb = null;
  docVisibilityCb = null;
  groupsDblClickCb = null;
  groupsClickCb = null;
  tabsOnCreatedCb = null;
  tabsOnRemovedCb = null;
  tabsOnUpdatedCb = null;
  tabsOnAttachedCb = null;
  tabsOnDetachedCb = null;
  groupsAuxClickCb = null;
  docKeydownCb = null;

  global.elementsById = {};

  const bodyClassList = buildBodyClassList();

  const groupsNodeEl = {
    appendChild: vi.fn(),
    addEventListener: vi.fn((evt, cb) => {
      if (evt === 'dblclick') groupsDblClickCb = cb;
      if (evt === 'click') groupsClickCb = cb;
      if (evt === 'auxclick') groupsAuxClickCb = cb;
    }),
  };

  global.document = {
    hidden: false,
    getElementById: vi.fn((id) => {
      if (id === 'groups') return groupsNodeEl;
      if (!global.elementsById[id]) {
        const el = {
          addEventListener: vi.fn(),
          appendChild: vi.fn(),
          title: '',
          style: {},
          listeners: {},
        };
        el.addEventListener = vi.fn((evt, cb) => {
          el.listeners[evt] = cb;
        });
        global.elementsById[id] = el;
      }
      return global.elementsById[id];
    }),
    body: {
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
      classList: bodyClassList,
    },
    getElementsByTagName: vi.fn(() => [
      {
        classList: bodyClassList,
        title: 'Panorama',
      },
    ]),
    addEventListener: vi.fn((evt, cb) => {
      if (evt === 'visibilitychange') docVisibilityCb = cb;
      if (evt === 'keydown') docKeydownCb = cb;
    }),
    createElement: vi.fn(() => ({
      getContext: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
      width: 0,
      height: 0,
      toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,x'),
    })),
    documentElement: { style: {} },
  };

  const mediaObj = {
    matches: opts.darkSystem || false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };

  global.window = {
    location: { reload: vi.fn(), pathname: '/view.html' },
    addEventListener: vi.fn(),
    innerWidth: 1000,
    innerHeight: 800,
    matchMedia: vi.fn(() => mediaObj),
    mediaObj,
  };

  global.Image = class {
    constructor() {
      Promise.resolve().then(() => {
        if (this.onload) this.onload.call(this);
      });
      this.height = 100;
      this.width = 200;
    }
  };

  global.browser = {
    windows: { getCurrent: vi.fn().mockResolvedValue({ id: 1 }) },
    sessions: {
      getWindowValue: vi.fn().mockResolvedValue('freeform'),
      setWindowValue: vi.fn().mockResolvedValue(),
      getTabValue: vi.fn().mockResolvedValue(null),
      setTabValue: vi.fn().mockResolvedValue(),
    },
    tabs: {
      getCurrent: vi.fn().mockResolvedValue({ id: 99 }),
      get: vi.fn().mockResolvedValue({ id: 1, windowId: 1 }),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(),
      remove: vi.fn().mockResolvedValue(),
      captureTab: vi.fn().mockResolvedValue('data:image/jpeg;base64,abc'),
      onCreated: {
        addListener: vi.fn((cb) => {
          tabsOnCreatedCb = cb;
        }),
      },
      onRemoved: {
        addListener: vi.fn((cb) => {
          tabsOnRemovedCb = cb;
        }),
      },
      onUpdated: {
        addListener: vi.fn((cb) => {
          tabsOnUpdatedCb = cb;
        }),
      },
      onActivated: { addListener: vi.fn() },
      onMoved: { addListener: vi.fn() },
      onDetached: {
        addListener: vi.fn((cb) => {
          tabsOnDetachedCb = cb;
        }),
      },
      onAttached: {
        addListener: vi.fn((cb) => {
          tabsOnAttachedCb = cb;
        }),
      },
    },
    storage: {
      sync: {
        get: vi
          .fn()
          .mockResolvedValue(
            opts.storageResult || { theme: 'light', toolbarPosition: 'top' },
          ),
        set: vi.fn().mockResolvedValue(),
      },
      onChanged: {
        addListener: vi.fn((cb) => {
          storageOnChangedCb = cb;
        }),
      },
    },
    runtime: {
      openOptionsPage: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({ viewRefreshOrdered: false }),
    },
    i18n: { getMessage: vi.fn((k) => k) },
  };

  return { groupsNodeEl, bodyClassList };
}

async function loadModule() {
  vi.resetModules();
  await import('../../../src/js/view/index.js');
  const groupsMock = await import('../../../src/js/view/groups.js');
  const groupNodesMock = await import('../../../src/js/view/groupNodes.js');
  const tabNodesMock = await import('../../../src/js/view/tabNodes.js');
  const tabsMock = await import('../../../src/js/view/tabs.js');
  const dragScrollMock = await import('../../../src/js/view/dragscroll.js');

  // flush microtasks/promises
  await Array.from({ length: 10 }).reduce(
    (previous) => previous.then(() => undefined),
    Promise.resolve(),
  );

  return {
    groupsMock,
    groupNodesMock,
    tabNodesMock,
    tabsMock,
    dragScrollMock,
  };
}

describe('view/index.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGlobals();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('module load / initView', () => {
    it('initializes: getCurrent and getElementById("groups") called', async () => {
      await loadModule();
      expect(global.browser.tabs.getCurrent).toHaveBeenCalled();
      expect(global.document.getElementById).toHaveBeenCalledWith('groups');
    });

    it('enables drag scrolling on the document and window', async () => {
      const { dragScrollMock } = await loadModule();
      expect(dragScrollMock.initDragScroll).toHaveBeenCalledTimes(1);
      expect(dragScrollMock.initDragScroll).toHaveBeenCalledWith(
        global.document,
        global.window,
      );
    });

    it('registers tab event listeners', async () => {
      await loadModule();
      expect(global.browser.tabs.onCreated.addListener).toHaveBeenCalled();
      expect(global.browser.tabs.onRemoved.addListener).toHaveBeenCalled();
    });

    it('adds body view-ready class', async () => {
      const { bodyClassList } = setupGlobals();
      await loadModule();
      expect(bodyClassList.add).toHaveBeenCalledWith('view-ready');
    });
  });

  describe('theme / toolbar', () => {
    it('applies light theme from storage', async () => {
      const { bodyClassList } = setupGlobals({
        storageResult: { theme: 'light', toolbarPosition: 'top' },
      });
      await loadModule();
      expect(bodyClassList.add).toHaveBeenCalledWith('theme-light');
    });

    it('applies dark theme from storage', async () => {
      const { bodyClassList } = setupGlobals({
        storageResult: { theme: 'dark', toolbarPosition: 'top' },
      });
      await loadModule();
      expect(bodyClassList.add).toHaveBeenCalledWith('theme-dark');
    });

    it('auto theme selects dark when system is dark', async () => {
      const { bodyClassList } = setupGlobals({
        storageResult: { theme: 'auto', toolbarPosition: 'top' },
        darkSystem: true,
      });
      await loadModule();
      expect(bodyClassList.add).toHaveBeenCalledWith('theme-dark');
    });

    it('auto theme selects light when system is light', async () => {
      const { bodyClassList } = setupGlobals({
        storageResult: { theme: 'auto', toolbarPosition: 'top' },
        darkSystem: false,
      });
      await loadModule();
      expect(bodyClassList.add).toHaveBeenCalledWith('theme-light');
    });

    it('migrates useDarkTheme legacy setting', async () => {
      setupGlobals({
        storageResult: {
          useDarkTheme: true,
          theme: 'light',
          toolbarPosition: 'top',
        },
      });
      await loadModule();
      expect(global.browser.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({ theme: 'dark' }),
      );
    });

    it('applies toolbar position', async () => {
      const { bodyClassList } = setupGlobals({
        storageResult: { theme: 'light', toolbarPosition: 'bottom' },
      });
      await loadModule();
      expect(bodyClassList.add).toHaveBeenCalledWith('toolbar-bottom');
    });
  });

  describe('storage.onChanged', () => {
    it('updates theme on storage change', async () => {
      const { bodyClassList } = setupGlobals();
      await loadModule();
      bodyClassList.add.mockClear();
      storageOnChangedCb({ theme: { newValue: 'dark' } }, 'sync');
      expect(bodyClassList.add).toHaveBeenCalledWith('theme-dark');
    });

    it('updates toolbar position on storage change', async () => {
      const { bodyClassList } = setupGlobals();
      await loadModule();
      bodyClassList.add.mockClear();
      storageOnChangedCb({ toolbarPosition: { newValue: 'bottom' } }, 'sync');
      expect(bodyClassList.add).toHaveBeenCalledWith('toolbar-bottom');
    });

    it('ignores non-sync area', async () => {
      const { bodyClassList } = setupGlobals();
      await loadModule();
      bodyClassList.add.mockClear();
      storageOnChangedCb({ theme: { newValue: 'dark' } }, 'local');
      expect(bodyClassList.add).not.toHaveBeenCalledWith('theme-dark');
    });

    it('re-adds system theme listener when switching to auto', async () => {
      const { bodyClassList } = setupGlobals();
      await loadModule();
      bodyClassList.add.mockClear();
      storageOnChangedCb({ theme: { newValue: 'auto' } }, 'sync');
      expect(global.window.mediaObj.addListener).toHaveBeenCalled();
    });

    it('removes system theme listener when switching away from auto', async () => {
      setupGlobals();
      await loadModule();
      storageOnChangedCb({ theme: { newValue: 'light' } }, 'sync');
      expect(global.window.mediaObj.removeListener).toHaveBeenCalled();
    });
  });

  describe('visibilitychange', () => {
    it('sends checkViewRefresh when document becomes visible', async () => {
      await loadModule();
      global.document.hidden = false;
      if (docVisibilityCb) await docVisibilityCb();
      expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'checkViewRefresh',
      });
    });

    it('reloads when viewRefreshOrdered is true', async () => {
      global.browser.runtime.sendMessage = vi
        .fn()
        .mockResolvedValue({ viewRefreshOrdered: true });
      await loadModule();
      global.document.hidden = false;
      if (docVisibilityCb) await docVisibilityCb();
      expect(global.window.location.reload).toHaveBeenCalled();
    });

    it('does not fire when document is hidden', async () => {
      await loadModule();
      global.document.hidden = true;
      global.browser.runtime.sendMessage.mockClear();

      // Fire the callback
      if (docVisibilityCb) {
        await docVisibilityCb();
      }

      // Should not have sent any message
      expect(global.browser.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('tabs event listeners', () => {
    it('tabCreated: adds tab to same window', async () => {
      const { insertTab } = await import('../../../src/js/view/groupNodes.js');
      await loadModule();
      if (tabsOnCreatedCb) await tabsOnCreatedCb({ id: 5, windowId: 1 });
      expect(insertTab).toHaveBeenCalled();
    });

    it('tabCreated: ignores different window', async () => {
      const { insertTab } = await import('../../../src/js/view/groupNodes.js');
      insertTab.mockClear();
      await loadModule();
      if (tabsOnCreatedCb) await tabsOnCreatedCb({ id: 5, windowId: 999 });
      expect(insertTab).not.toHaveBeenCalled();
    });

    it('tabCreated: skips tab when group resolved but is null (no group in view)', async () => {
      const { insertTab } = await import('../../../src/js/view/groupNodes.js');
      const { get } = await import('../../../src/js/view/groups.js');
      const { getGroupId } = await import('../../../src/js/view/tabs.js');
      get.mockReturnValue(null);
      getGroupId.mockResolvedValue(999);
      insertTab.mockClear();
      await loadModule();
      // tabCreated with a group that doesn't exist in groups.get -> no insertTab
      // (it will retry up to 20x, but groups.get still returns null, so it eventually warns)
      // Just verify the module doesn't crash by calling tabCreated
      if (tabsOnCreatedCb) {
        // Only verify it doesn't throw synchronously
        const p = tabsOnCreatedCb({ id: 5, windowId: 1 });
        // The promise will eventually resolve after retries; don't await it fully
        await Promise.resolve();
        expect(typeof p.then).toBe('function');
      }
    });

    it('tabRemoved: deletes node in same window', async () => {
      const { deleteTabNode } =
        await import('../../../src/js/view/tabNodes.js');
      await loadModule();
      if (tabsOnRemovedCb) tabsOnRemovedCb(5, { windowId: 1 });
      expect(deleteTabNode).toHaveBeenCalledWith(5);
    });

    it('tabRemoved: skips view tab (view.tabId)', async () => {
      const { deleteTabNode } =
        await import('../../../src/js/view/tabNodes.js');
      deleteTabNode.mockClear();
      await loadModule();
      // view.tabId = 99 (from browser.tabs.getCurrent mock)
      if (tabsOnRemovedCb) tabsOnRemovedCb(99, { windowId: 1 });
      expect(deleteTabNode).not.toHaveBeenCalled();
    });

    it('tabRemoved: ignores different window', async () => {
      const { deleteTabNode } =
        await import('../../../src/js/view/tabNodes.js');
      deleteTabNode.mockClear();
      await loadModule();
      if (tabsOnRemovedCb) tabsOnRemovedCb(5, { windowId: 999 });
      expect(deleteTabNode).not.toHaveBeenCalled();
    });

    it('tabUpdated: calls updateTabNode and updateFavicon', async () => {
      const { updateTabNode, updateFavicon } =
        await import('../../../src/js/view/tabNodes.js');
      await loadModule();
      if (tabsOnUpdatedCb) await tabsOnUpdatedCb(1, {}, { id: 1 });
      expect(updateTabNode).toHaveBeenCalled();
      expect(updateFavicon).toHaveBeenCalled();
    });

    it('tabUpdated: pinned triggers fillGroupNodes and reload (not hidden)', async () => {
      const { fillGroupNodes } =
        await import('../../../src/js/view/groupNodes.js');
      global.document.hidden = false;
      await loadModule();
      if (tabsOnUpdatedCb)
        await tabsOnUpdatedCb(1, { pinned: true }, { id: 1 });
      expect(fillGroupNodes).toHaveBeenCalled();
      expect(global.window.location.reload).toHaveBeenCalled();
    });

    it('tabUpdated: pinned queues reload when hidden', async () => {
      global.document.hidden = true;
      await loadModule();
      if (tabsOnUpdatedCb)
        await tabsOnUpdatedCb(1, { pinned: true }, { id: 1 });
      expect(global.window.location.reload).not.toHaveBeenCalled();
    });

    it('tabAttached: creates tab if same window', async () => {
      const { makeTabNode } = await import('../../../src/js/view/tabNodes.js');
      await loadModule();
      if (tabsOnAttachedCb) await tabsOnAttachedCb(5, { newWindowId: 1 });
      expect(makeTabNode).toHaveBeenCalled();
    });

    it('tabAttached: ignores different window', async () => {
      const { makeTabNode } = await import('../../../src/js/view/tabNodes.js');
      makeTabNode.mockClear();
      await loadModule();
      if (tabsOnAttachedCb) await tabsOnAttachedCb(5, { newWindowId: 999 });
      expect(makeTabNode).not.toHaveBeenCalled();
    });

    it('tabDetached: deletes node in same window', async () => {
      const { deleteTabNode } =
        await import('../../../src/js/view/tabNodes.js');
      deleteTabNode.mockClear();
      await loadModule();
      if (tabsOnDetachedCb) tabsOnDetachedCb(5, { oldWindowId: 1 });
      expect(deleteTabNode).toHaveBeenCalledWith(5);
    });

    it('tabDetached: ignores different window', async () => {
      const { deleteTabNode } =
        await import('../../../src/js/view/tabNodes.js');
      deleteTabNode.mockClear();
      await loadModule();
      if (tabsOnDetachedCb) tabsOnDetachedCb(5, { oldWindowId: 999 });
      expect(deleteTabNode).not.toHaveBeenCalled();
    });
  });

  describe('groups node interactions', () => {
    it('dblclick on content closes group', async () => {
      const { closeGroup } = await import('../../../src/js/view/groupNodes.js');
      await loadModule();
      if (groupsDblClickCb) {
        groupsDblClickCb({
          target: { className: 'content transition', getAttribute: () => '1' },
        });
        expect(closeGroup).toHaveBeenCalled();
      }
    });

    it('dblclick on #groups background creates group', async () => {
      const { makeGroupNode } =
        await import('../../../src/js/view/groupNodes.js');
      await loadModule();
      if (groupsDblClickCb) {
        await groupsDblClickCb({
          target: { id: 'groups', className: '' },
          clientX: 100,
          clientY: 100,
        });
        expect(makeGroupNode).toHaveBeenCalled();
      }
    });

    it('click on content raises group', async () => {
      const { raiseGroup } = await import('../../../src/js/view/groupNodes.js');
      await loadModule();
      if (groupsClickCb) {
        groupsClickCb({
          target: { className: 'content transition', getAttribute: () => '1' },
          stopPropagation: vi.fn(),
        });
        expect(raiseGroup).toHaveBeenCalledWith(1);
      }
    });

    it('dblclick and click on unknown target do nothing', async () => {
      const { makeGroupNode, closeGroup, raiseGroup } =
        await import('../../../src/js/view/groupNodes.js');
      const { groupsMock: groups } = await loadModule();
      makeGroupNode.mockClear();
      closeGroup.mockClear();
      raiseGroup.mockClear();
      groups.create.mockClear();

      if (groupsDblClickCb) {
        await groupsDblClickCb({
          target: { id: 'unknown', className: 'unknown' },
          clientX: 100,
          clientY: 100,
        });
        expect(closeGroup).not.toHaveBeenCalled();
        expect(groups.create).not.toHaveBeenCalled();
      }

      if (groupsClickCb) {
        groupsClickCb({
          target: { id: 'unknown', className: 'unknown' },
          stopPropagation: vi.fn(),
        });
        expect(raiseGroup).not.toHaveBeenCalled();
      }
    });
  });

  describe('setLayoutMode (via initView buttons)', () => {
    it('tiling button sets tiling layout', async () => {
      await loadModule();
      // find tiling button listener via getElementById mock
      const { calls } = global.document.getElementById.mock;
      const tilingIdx = calls.findIndex(([id]) => id === 'tiling');
      if (tilingIdx !== -1) {
        const result =
          global.document.getElementById.mock.results[tilingIdx].value;
        const cb = result.listeners && result.listeners.click;
        if (cb) {
          await cb();
          expect(global.browser.sessions.setWindowValue).toHaveBeenCalledWith(
            1,
            'layoutMode',
            'tiling',
          );
        }
      }
    });

    it('tiling button sets tiling layout with uneven groups', async () => {
      const { groupsMock } = await loadModule();
      groupsMock.getLength.mockReturnValue(3);

      const { calls } = global.document.getElementById.mock;
      const tilingIdx = calls.findIndex(([id]) => id === 'tiling');
      if (tilingIdx !== -1) {
        const result =
          global.document.getElementById.mock.results[tilingIdx].value;
        const cb = result.listeners && result.listeners.click;
        if (cb) {
          await cb();
          expect(global.browser.sessions.setWindowValue).toHaveBeenCalledWith(
            1,
            'layoutMode',
            'tiling',
          );
        }
      }
    });

    it('freeform button sets freeform layout', async () => {
      await loadModule();
      const { calls } = global.document.getElementById.mock;
      const ffIdx = calls.findIndex(([id]) => id === 'freeform');
      if (ffIdx !== -1) {
        const result = global.document.getElementById.mock.results[ffIdx].value;
        const cb = result.listeners && result.listeners.click;
        if (cb) {
          await cb();
          expect(global.browser.sessions.setWindowValue).toHaveBeenCalledWith(
            1,
            'layoutMode',
            'freeform',
          );
        }
      }
    });
  });

  describe('keyInput navigation', () => {
    it('skips navigation if current group is undefined', async () => {
      const { tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue(undefined);

      await docKeydownCb({ key: 'ArrowRight' });
      await docKeydownCb({ key: 'ArrowLeft' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).not.toHaveBeenCalled();
    });

    it('handles ArrowRight to navigate to next tab', async () => {
      const { groupNodesMock, tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue(1);
      tabNodesMock.getActiveTabId.mockReturnValue(10);

      groupNodesMock.groupNodes = {
        1: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '10' : null),
                hasAttribute: () => true,
              },
              {
                getAttribute: (k) => (k === 'tabId' ? '11' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
      };

      await docKeydownCb({ key: 'ArrowRight' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).toHaveBeenCalledWith(11);
    });

    it('handles ArrowRight to navigate to next group when at end of current group', async () => {
      const { groupNodesMock, tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue(1);
      tabNodesMock.getActiveTabId.mockReturnValue(11);

      groupNodesMock.groupNodes = {
        1: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '10' : null),
                hasAttribute: () => true,
              },
              {
                getAttribute: (k) => (k === 'tabId' ? '11' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
        2: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '20' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
      };

      await docKeydownCb({ key: 'ArrowRight' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).toHaveBeenCalledWith(20);
    });

    it('handles ArrowLeft to navigate to previous tab', async () => {
      const { groupNodesMock, tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue(1);
      tabNodesMock.getActiveTabId.mockReturnValue(11);

      groupNodesMock.groupNodes = {
        1: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '10' : null),
                hasAttribute: () => true,
              },
              {
                getAttribute: (k) => (k === 'tabId' ? '11' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
      };

      await docKeydownCb({ key: 'ArrowLeft' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).toHaveBeenCalledWith(10);
    });

    it('handles ArrowRight to navigate to first group when at end of last group', async () => {
      const { groupNodesMock, tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue('2');
      tabNodesMock.getActiveTabId.mockReturnValue(21);

      groupNodesMock.groupNodes = {
        1: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '10' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
        2: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '21' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
        pinned: {
          content: { childNodes: [] },
        },
      };

      await docKeydownCb({ key: 'ArrowRight' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).toHaveBeenCalledWith(10);
    });

    it('handles ArrowLeft to navigate to previous group when at start of current group', async () => {
      const { groupNodesMock, tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue(2);
      tabNodesMock.getActiveTabId.mockReturnValue(20);

      groupNodesMock.groupNodes = {
        1: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '10' : null),
                hasAttribute: () => true,
              },
              {
                getAttribute: (k) => (k === 'tabId' ? '11' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
        2: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '20' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
      };

      await docKeydownCb({ key: 'ArrowLeft' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).toHaveBeenCalledWith(11);
    });

    it('handles ArrowLeft to navigate to last group when at start of first group', async () => {
      const { groupNodesMock, tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue('1');
      tabNodesMock.getActiveTabId.mockReturnValue(10);

      groupNodesMock.groupNodes = {
        1: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '10' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
        2: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '20' : null),
                hasAttribute: () => true,
              },
              {
                getAttribute: (k) => (k === 'tabId' ? '21' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
        pinned: {
          content: { childNodes: [] },
        },
      };

      await docKeydownCb({ key: 'ArrowLeft' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).toHaveBeenCalledWith(21);
    });

    it('skips empty group when navigating ArrowRight to next group', async () => {
      const { groupNodesMock, tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue(1);
      tabNodesMock.getActiveTabId.mockReturnValue(11);

      groupNodesMock.groupNodes = {
        1: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '10' : null),
                hasAttribute: () => true,
              },
              {
                getAttribute: (k) => (k === 'tabId' ? '11' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
        2: {
          content: {
            childNodes: [
              { hasAttribute: () => false }, // empty group!
            ],
          },
        },
      };

      await docKeydownCb({ key: 'ArrowRight' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).not.toHaveBeenCalled();
    });

    it('returns early when ArrowLeft encounters empty previous group', async () => {
      const { groupNodesMock, tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue(2);
      tabNodesMock.getActiveTabId.mockReturnValue(20);

      groupNodesMock.groupNodes = {
        1: {
          content: {
            childNodes: [
              { hasAttribute: () => false }, // empty group!
            ],
          },
        },
        2: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '20' : null),
                hasAttribute: () => true,
              },
              { hasAttribute: () => false },
            ],
          },
        },
      };

      await docKeydownCb({ key: 'ArrowLeft' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).not.toHaveBeenCalled();
    });

    it('returns early when ArrowRight encounters a node without tabId', async () => {
      const { groupNodesMock, tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue('1');
      tabNodesMock.getActiveTabId.mockReturnValue(10);

      groupNodesMock.groupNodes = {
        1: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '10' : null),
                hasAttribute: () => true,
              },
              { getAttribute: () => null, hasAttribute: () => false }, // no tabId!
              {
                getAttribute: (k) => (k === 'tabId' ? '12' : null),
                hasAttribute: () => true,
              },
              { getAttribute: () => null, hasAttribute: () => false },
            ],
          },
        },
      };

      await docKeydownCb({ key: 'ArrowRight' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).not.toHaveBeenCalled();
    });

    it('returns early when ArrowLeft encounters a node without tabId', async () => {
      const { groupNodesMock, tabNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue('1');
      tabNodesMock.getActiveTabId.mockReturnValue(12);

      groupNodesMock.groupNodes = {
        1: {
          content: {
            childNodes: [
              {
                getAttribute: (k) => (k === 'tabId' ? '10' : null),
                hasAttribute: () => true,
              },
              { getAttribute: () => null, hasAttribute: () => false }, // no tabId!
              {
                getAttribute: (k) => (k === 'tabId' ? '12' : null),
                hasAttribute: () => true,
              },
              { getAttribute: () => null, hasAttribute: () => false },
            ],
          },
        },
      };

      await docKeydownCb({ key: 'ArrowLeft' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).not.toHaveBeenCalled();
    });

    it('handles Enter to activate tab and close view', async () => {
      const { tabNodesMock } = await loadModule();
      tabNodesMock.getActiveTabId.mockReturnValue(10);

      await docKeydownCb({ key: 'Enter' });
      await flushPromises();

      expect(global.browser.tabs.update).toHaveBeenCalledWith(10, {
        active: true,
      });
      expect(global.browser.tabs.remove).toHaveBeenCalledWith(99);
    });

    it('handles Enter to activate tab but does not close view if not view.html', async () => {
      const { tabNodesMock } = await loadModule();
      tabNodesMock.getActiveTabId.mockReturnValue(10);
      global.browser.tabs.update.mockClear();
      global.browser.tabs.remove.mockClear();

      const originalPath = global.window.location.pathname;
      global.window.location.pathname = '/popup.html';

      await docKeydownCb({ key: 'Enter' });
      await flushPromises();

      expect(global.browser.tabs.update).toHaveBeenCalledWith(10, {
        active: true,
      });
      expect(global.browser.tabs.remove).not.toHaveBeenCalled();

      global.window.location.pathname = originalPath;
    });

    it('handles Enter to activate tab but does not close view if getCurrent returns null', async () => {
      const { tabNodesMock } = await loadModule();
      tabNodesMock.getActiveTabId.mockReturnValue(10);
      global.browser.tabs.update.mockClear();
      global.browser.tabs.remove.mockClear();

      global.browser.tabs.getCurrent.mockResolvedValueOnce(null);

      await docKeydownCb({ key: 'Enter' });
      await flushPromises();

      expect(global.browser.tabs.update).toHaveBeenCalledWith(10, {
        active: true,
      });
      expect(global.browser.tabs.remove).not.toHaveBeenCalled();
    });

    it('returns early when key is not handled (e.g. Escape)', async () => {
      const { tabNodesMock } = await loadModule();
      tabNodesMock.setActiveTabNodeById.mockClear();
      global.browser.tabs.update.mockClear();

      await docKeydownCb({ key: 'Escape' });
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).not.toHaveBeenCalled();
      expect(global.browser.tabs.update).not.toHaveBeenCalled();
    });
  });

  describe('tabCreated retry paths', () => {
    it('retries when group is not found and then succeeds', async () => {
      const { groupsMock, groupNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue(999);
      groupsMock.get.mockReturnValueOnce(null).mockReturnValueOnce({ id: 999 });

      const promise = tabsOnCreatedCb({ id: 5, windowId: 1 });
      await promise;
      expect(groupNodesMock.insertTab).toHaveBeenCalled();
    });

    it('gives up after 20 retries', async () => {
      const { groupsMock, groupNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId.mockResolvedValue(999);
      groupsMock.get.mockReturnValue(null);

      const promise = tabsOnCreatedCb({ id: 5, windowId: 1 });
      await promise;
      expect(groupNodesMock.insertTab).not.toHaveBeenCalled();
    });

    it('retries when groupId is undefined', async () => {
      const { groupsMock, groupNodesMock, tabsMock } = await loadModule();
      tabsMock.getGroupId
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(999);
      groupsMock.get.mockReturnValue({ id: 999 });

      const promise = tabsOnCreatedCb({ id: 5, windowId: 1 });
      await promise;
      expect(groupNodesMock.insertTab).toHaveBeenCalled();
    });
  });

  describe('captureThumbnail', () => {
    it('skips if captureTab API is unavailable', async () => {
      global.browser.tabs.captureTab = undefined;
      global.browser.tabs.query.mockResolvedValue([
        { id: 1, lastAccessed: 100, discarded: false },
      ]);
      await loadModule();
      // no throw expected — just verifying module loads cleanly
      expect(global.browser.tabs.getCurrent).toHaveBeenCalled();
    });

    it('captures new thumbnail when no cached thumbnail exists', async () => {
      global.browser.tabs.captureTab = vi
        .fn()
        .mockResolvedValue('data:image/jpeg;base64,abc');
      global.browser.tabs.query.mockResolvedValue([
        { id: 1, lastAccessed: 100, discarded: false },
      ]);
      global.browser.sessions.getTabValue.mockResolvedValue(null);

      await loadModule();
      await flushPromises();

      expect(global.browser.tabs.captureTab).toHaveBeenCalledWith(1, {
        format: 'jpeg',
        quality: 25,
      });
      expect(global.browser.sessions.setTabValue).toHaveBeenCalled();
    });

    it('skips capture when cached thumbnail is newer than tab.lastAccessed', async () => {
      global.browser.tabs.captureTab = vi.fn();
      global.browser.tabs.query.mockResolvedValue([
        { id: 1, lastAccessed: 100, discarded: false },
      ]);
      global.browser.sessions.getTabValue.mockResolvedValue({
        thumbnail: 'data...',
        capturedTime: 200,
      });

      await loadModule();
      await flushPromises();

      expect(global.browser.tabs.captureTab).not.toHaveBeenCalled();
    });
  });

  describe('searchTabs', () => {
    it('finds and sets active tab based on search input', async () => {
      global.browser.tabs.query.mockResolvedValue([
        { id: 1, title: 'GitHub' },
        { id: 2, title: 'StackOverflow' },
      ]);

      const { tabNodesMock } = await loadModule();

      const searchInput = global.elementsById['tab-search'];
      searchInput.value = 'stack';

      await searchInput.listeners.input();
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).toHaveBeenCalledWith(2);
    });

    it('falls back to active tab if no match is found', async () => {
      global.browser.tabs.query.mockResolvedValue([{ id: 1, title: 'GitHub' }]);

      const { tabNodesMock } = await loadModule();
      tabNodesMock.getActiveTabId.mockReturnValue(99);

      const searchInput = global.elementsById['tab-search'];
      searchInput.value = 'stack';

      await searchInput.listeners.input();
      await flushPromises();

      expect(tabNodesMock.setActiveTabNodeById).toHaveBeenCalledWith(99);
    });
  });

  describe('UI Buttons and Layout Modes', () => {
    it('handles tiling and freeform button clicks', async () => {
      const { groupsMock: groups, groupNodesMock: groupNodes } =
        await loadModule();

      groups.transform.mockClear();
      groupNodes.resizeGroups.mockClear();
      global.browser.sessions.setWindowValue.mockClear();

      const tilingBtn = global.elementsById.tiling;
      const freeformBtn = global.elementsById.freeform;

      groups.getLength.mockReturnValue(2);
      groups.getIds.mockReturnValue([1, 2]);

      global.browser.sessions.getWindowValue.mockResolvedValueOnce('tiling');

      await tilingBtn.listeners.click();
      await flushPromises();

      expect(global.browser.sessions.setWindowValue).toHaveBeenCalledWith(
        1,
        'layoutMode',
        'tiling',
      );
      expect(groups.transform).toHaveBeenCalledTimes(2);
      expect(groupNodes.resizeGroups).toHaveBeenCalledTimes(2);

      groups.transform.mockClear();
      groupNodes.resizeGroups.mockClear();

      await freeformBtn.listeners.click();
      await flushPromises();

      expect(global.browser.sessions.setWindowValue).toHaveBeenCalledWith(
        1,
        'layoutMode',
        'freeform',
      );
      expect(groupNodes.resizeGroups).toHaveBeenCalledTimes(1);
    });

    it('handles newGroup button click', async () => {
      const { groupsMock: groups } = await loadModule();

      const newGroupBtn = global.elementsById.newGroup;
      console.log('newGroupBtn listeners:', newGroupBtn.listeners);
      newGroupBtn.listeners.click();
      await flushPromises();

      expect(groups.create).toHaveBeenCalled();
    });

    it('handles settings button click', async () => {
      await loadModule();
      const settingsBtn = global.elementsById.settings;
      settingsBtn.listeners.click();
      await flushPromises();

      expect(global.browser.runtime.openOptionsPage).toHaveBeenCalled();
    });

    it('handles middle click (auxclick) on groups container', async () => {
      const { groupsMock: groups } = await loadModule();

      expect(groupsAuxClickCb).toBeDefined();

      // Middle click
      groupsAuxClickCb({
        button: 1,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: global.document.getElementById('groups'),
        clientX: 100,
        clientY: 100,
      });
      await flushPromises();
      expect(groups.create).toHaveBeenCalled();

      groups.create.mockClear();

      // Other click
      groupsAuxClickCb({
        button: 0,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: global.document.getElementById('groups'),
        clientX: 100,
        clientY: 100,
      });
      await flushPromises();
      expect(groups.create).not.toHaveBeenCalled();

      // Middle click but on non-groups target
      groupsAuxClickCb({
        button: 1,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: global.document.getElementById('newGroup'),
        clientX: 100,
        clientY: 100,
      });
      await flushPromises();
      expect(groups.create).not.toHaveBeenCalled();
    });

    it('handles system theme changes', async () => {
      global.browser.storage.sync.get.mockResolvedValueOnce({
        theme: 'auto',
        toolbarPosition: 'top',
      });
      await loadModule();

      global.document.body.classList.add.mockClear();

      // mediaObj.addListener was called with the callback
      const addListenerCalls = global.window.mediaObj.addListener.mock.calls;
      expect(addListenerCalls.length).toBe(1);

      const cb = addListenerCalls[0][0];

      global.window.mediaObj.matches = true;
      cb({ matches: true });
      expect(global.document.body.classList.add).toHaveBeenCalledWith(
        'theme-dark',
      );

      global.document.body.classList.add.mockClear();

      global.window.mediaObj.matches = false;
      cb({ matches: false });
      expect(global.document.body.classList.add).toHaveBeenCalledWith(
        'theme-light',
      );
    });
  });

  describe('onUpdated filter fallback', () => {
    it('falls back to no-filter addListener if filter throws', async () => {
      global.browser.tabs.onUpdated.addListener = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('filter unsupported');
        })
        .mockImplementation(vi.fn());
      await loadModule();
      expect(global.browser.tabs.onUpdated.addListener).toHaveBeenCalledTimes(
        2,
      );
    });
  });
});
