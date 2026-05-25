if (typeof browser === 'undefined') {
  globalThis.browser = chrome;
}

// Polyfill for Chromium which uses contextMenus instead of menus
if (
  globalThis.browser &&
  !globalThis.browser.menus &&
  globalThis.browser.contextMenus
) {
  globalThis.browser.menus = new Proxy(globalThis.browser.contextMenus, {
    get(target, prop) {
      if (prop === 'create') {
        return function (createProperties, callback) {
          if (createProperties && createProperties.contexts) {
            createProperties.contexts = createProperties.contexts.map((c) =>
              c === 'tab' ? 'all' : c,
            );
          }
          return target.create(createProperties, callback);
        };
      }
      if (prop === 'update') {
        return function (id, updateProperties, callback) {
          if (updateProperties && updateProperties.contexts) {
            updateProperties.contexts = updateProperties.contexts.map((c) =>
              c === 'tab' ? 'all' : c,
            );
          }
          return target.update(id, updateProperties, callback);
        };
      }
      if (typeof target[prop] === 'function') {
        return target[prop].bind(target);
      }
      return target[prop];
    },
  });
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

// Polyfill for Chromium missing windowId support in browser.action
if (globalThis.browser && globalThis.browser.action) {
  const originalSetTitle = globalThis.browser.action.setTitle.bind(
    globalThis.browser.action,
  );
  globalThis.browser.action.setTitle = async (details) => {
    try {
      return await originalSetTitle(details);
    } catch (e) {
      if (details && details.windowId !== undefined) {
        const { windowId, ...rest } = details;
        return originalSetTitle(rest);
      }
      throw e;
    }
  };

  const originalSetBadgeText = globalThis.browser.action.setBadgeText.bind(
    globalThis.browser.action,
  );
  globalThis.browser.action.setBadgeText = async (details) => {
    try {
      return await originalSetBadgeText(details);
    } catch (e) {
      if (details && details.windowId !== undefined) {
        const { windowId, ...rest } = details;
        return originalSetBadgeText(rest);
      }
      throw e;
    }
  };
}
