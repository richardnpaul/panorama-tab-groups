globalThis.browser = {
  runtime: {
    getManifest: () => ({ version: '0.9.0' }),
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    onMessageExternal: { addListener: () => {} },
    getURL: () => '',
  },
  i18n: {
    getMessage: () => '',
  },
  tabs: {
    onActivated: { addListener: () => {} },
    onCreated: { addListener: () => {} },
    onAttached: { addListener: () => {} },
    onDetached: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    onMoved: { addListener: () => {} },
    get: async (id) => ({ id, windowId: 1 }),
    query: async () => [],
  },
  windows: {
    onCreated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    onFocusChanged: { addListener: () => {} },
    getAll: async () => [],
    getCurrent: async () => ({ id: 1 }),
  },
  contextMenus: {
    onClicked: { addListener: () => {} },
    removeAll: async () => {},
    create: () => {},
  },
  commands: {
    onCommand: { addListener: () => {} },
  },
  sessions: {
    removeTabValue: async () => {},
    getTabValue: async () => undefined,
    setTabValue: async () => {},
    getWindowValue: async () => undefined,
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
    sync: {
      get: async () => ({}),
      set: async () => {},
    },
    onChanged: { addListener: () => {} },
  },
  action: {
    onClicked: { addListener: () => {} },
    setTitle: async () => {},
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
    setPopup: async () => {},
  },
  tabGroups: {
    onUpdated: { addListener: () => {} },
    onCreated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    onMoved: { addListener: () => {} },
    query: async () => [],
  },
};
