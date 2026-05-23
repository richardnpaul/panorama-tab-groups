if (typeof browser === 'undefined') {
  globalThis.browser = chrome;
}

// Polyfill for Firefox-specific sessions API functions
if (globalThis.browser) {
  if (!globalThis.browser.sessions) {
    globalThis.browser.sessions = {};
  }

  let sessionsLock = Promise.resolve();

  if (!globalThis.browser.sessions.setTabValue) {
    globalThis.browser.sessions.setTabValue = (tabId, key, value) => {
      sessionsLock = sessionsLock.then(async () => {
        // eslint-disable-next-line no-underscore-dangle
        const data =
          await globalThis.browser.storage.local.get('__mock_sessions');
        // eslint-disable-next-line no-underscore-dangle
        const sessions = data.__mock_sessions || { tabs: {}, windows: {} };
        if (!sessions.tabs) sessions.tabs = {};
        if (!sessions.tabs[tabId]) sessions.tabs[tabId] = {};
        sessions.tabs[tabId][key] = value;
        // eslint-disable-next-line no-underscore-dangle
        await globalThis.browser.storage.local.set({
          __mock_sessions: sessions,
        });
      });
      return sessionsLock;
    };
  }

  if (!globalThis.browser.sessions.getTabValue) {
    globalThis.browser.sessions.getTabValue = (tabId, key) => {
      sessionsLock = sessionsLock.then(async () => {
        // eslint-disable-next-line no-underscore-dangle
        const data =
          await globalThis.browser.storage.local.get('__mock_sessions');
        // eslint-disable-next-line no-underscore-dangle
        return data.__mock_sessions?.tabs?.[tabId]?.[key];
      });
      return sessionsLock;
    };
  }

  if (!globalThis.browser.sessions.setWindowValue) {
    globalThis.browser.sessions.setWindowValue = (windowId, key, value) => {
      sessionsLock = sessionsLock.then(async () => {
        // eslint-disable-next-line no-underscore-dangle
        const data =
          await globalThis.browser.storage.local.get('__mock_sessions');
        // eslint-disable-next-line no-underscore-dangle
        const sessions = data.__mock_sessions || { tabs: {}, windows: {} };
        if (!sessions.windows) sessions.windows = {};
        if (!sessions.windows[windowId]) sessions.windows[windowId] = {};
        sessions.windows[windowId][key] = value;
        // eslint-disable-next-line no-underscore-dangle
        await globalThis.browser.storage.local.set({
          __mock_sessions: sessions,
        });
      });
      return sessionsLock;
    };
  }

  if (!globalThis.browser.sessions.getWindowValue) {
    globalThis.browser.sessions.getWindowValue = (windowId, key) => {
      sessionsLock = sessionsLock.then(async () => {
        // eslint-disable-next-line no-underscore-dangle
        const data =
          await globalThis.browser.storage.local.get('__mock_sessions');
        // eslint-disable-next-line no-underscore-dangle
        return data.__mock_sessions?.windows?.[windowId]?.[key];
      });
      return sessionsLock;
    };
  }
}
