if (typeof browser === 'undefined') {
  globalThis.browser = chrome;
}

// Polyfill for Firefox-specific sessions API functions
if (globalThis.browser) {
  if (!globalThis.browser.sessions) {
    globalThis.browser.sessions = {};
  }

  if (!globalThis.browser.sessions.setTabValue) {
    globalThis.browser.sessions.setTabValue = async (tabId, key, value) => {
      // eslint-disable-next-line no-underscore-dangle
      const data =
        await globalThis.browser.storage.local.get('__mock_sessions');
      // eslint-disable-next-line no-underscore-dangle
      const sessions = data.__mock_sessions || { tabs: {}, windows: {} };
      if (!sessions.tabs) sessions.tabs = {};
      if (!sessions.tabs[tabId]) sessions.tabs[tabId] = {};
      sessions.tabs[tabId][key] = value;
      // eslint-disable-next-line no-underscore-dangle
      await globalThis.browser.storage.local.set({ __mock_sessions: sessions });
    };
  }

  if (!globalThis.browser.sessions.getTabValue) {
    globalThis.browser.sessions.getTabValue = async (tabId, key) => {
      // eslint-disable-next-line no-underscore-dangle
      const data =
        await globalThis.browser.storage.local.get('__mock_sessions');
      // eslint-disable-next-line no-underscore-dangle
      return data.__mock_sessions?.tabs?.[tabId]?.[key];
    };
  }

  if (!globalThis.browser.sessions.setWindowValue) {
    globalThis.browser.sessions.setWindowValue = async (
      windowId,
      key,
      value,
    ) => {
      // eslint-disable-next-line no-underscore-dangle
      const data =
        await globalThis.browser.storage.local.get('__mock_sessions');
      // eslint-disable-next-line no-underscore-dangle
      const sessions = data.__mock_sessions || { tabs: {}, windows: {} };
      if (!sessions.windows) sessions.windows = {};
      if (!sessions.windows[windowId]) sessions.windows[windowId] = {};
      sessions.windows[windowId][key] = value;
      // eslint-disable-next-line no-underscore-dangle
      await globalThis.browser.storage.local.set({ __mock_sessions: sessions });
    };
  }

  if (!globalThis.browser.sessions.getWindowValue) {
    globalThis.browser.sessions.getWindowValue = async (windowId, key) => {
      // eslint-disable-next-line no-underscore-dangle
      const data =
        await globalThis.browser.storage.local.get('__mock_sessions');
      // eslint-disable-next-line no-underscore-dangle
      return data.__mock_sessions?.windows?.[windowId]?.[key];
    };
  }
}
