describe('polyfill.js', () => {
  beforeEach(() => {
    // Reset global environment
    delete globalThis.browser;
    delete globalThis.chrome;
    jest.resetModules();
  });

  describe('browser alias', () => {
    it('sets browser to chrome if undefined', () => {
      globalThis.chrome = { runtime: {} };
      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');
      expect(globalThis.browser).toBe(globalThis.chrome);
    });

    it('does not crash if browser and chrome are undefined', () => {
      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');
      expect(globalThis.browser).toBeUndefined();
    });
  });

  describe('menus polyfill', () => {
    it('polyfills menus using contextMenus proxy', () => {
      const mockContextMenus = {
        create: jest.fn().mockReturnValue(1),
        update: jest.fn().mockReturnValue(true),
        remove: jest.fn(),
      };

      globalThis.browser = {
        contextMenus: mockContextMenus,
      };

      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');

      expect(globalThis.browser.menus).toBeDefined();

      // Test create rewriting context 'tab' -> 'all'
      globalThis.browser.menus.create({ contexts: ['tab', 'page'] }, () => {});
      expect(mockContextMenus.create).toHaveBeenCalledWith(
        { contexts: ['all', 'page'] },
        expect.any(Function),
      );

      // Test update rewriting context 'tab' -> 'all'
      globalThis.browser.menus.update(
        'id',
        { contexts: ['tab', 'page'] },
        () => {},
      );
      expect(mockContextMenus.update).toHaveBeenCalledWith(
        'id',
        { contexts: ['all', 'page'] },
        expect.any(Function),
      );

      // Test bound function
      globalThis.browser.menus.remove('id');
      expect(mockContextMenus.remove).toHaveBeenCalledWith('id');

      // Test non-function property fallback (line 45 in polyfill.js)
      mockContextMenus.someStaticProperty = 'static-value';
      expect(globalThis.browser.menus.someStaticProperty).toBe('static-value');

      // Test create and update without properties (lines 24 and 34 in polyfill.js)
      globalThis.browser.menus.create();
      expect(mockContextMenus.create).toHaveBeenLastCalledWith(
        undefined,
        undefined,
      );

      globalThis.browser.menus.update('id');
      expect(mockContextMenus.update).toHaveBeenLastCalledWith(
        'id',
        undefined,
        undefined,
      );
    });

    it('directly aliases menus if proxy polyfill not needed or previously executed', () => {
      globalThis.chrome = {
        contextMenus: {},
      };
      globalThis.browser = undefined; // Trigger `typeof browser === 'undefined'` block

      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');
      expect(globalThis.browser.menus).toBe(globalThis.browser.contextMenus);
    });
  });

  describe('sessions polyfill', () => {
    let mockStorageGet;
    let mockStorageSet;

    beforeEach(() => {
      mockStorageGet = jest.fn().mockResolvedValue({});
      mockStorageSet = jest.fn().mockResolvedValue();

      globalThis.browser = {
        storage: {
          local: {
            get: mockStorageGet,
            set: mockStorageSet,
          },
        },
      };
    });

    it('polyfills setTabValue and getTabValue', async () => {
      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');

      expect(globalThis.browser.sessions).toBeDefined();

      // Test setTabValue
      await globalThis.browser.sessions.setTabValue(1, 'key', 'value');
      expect(mockStorageGet).toHaveBeenCalledWith('__mock_sessions');
      expect(mockStorageSet).toHaveBeenCalledWith({
        __mock_sessions: { tabs: { 1: { key: 'value' } }, windows: {} },
      });

      // Test getTabValue
      mockStorageGet.mockResolvedValueOnce({
        __mock_sessions: { tabs: { 1: { key: 'value' } } },
      });
      const val = await globalThis.browser.sessions.getTabValue(1, 'key');
      expect(val).toBe('value');
    });

    it('polyfills setWindowValue and getWindowValue', async () => {
      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');

      // Test setWindowValue
      await globalThis.browser.sessions.setWindowValue(1, 'key', 'value');
      expect(mockStorageGet).toHaveBeenCalledWith('__mock_sessions');
      expect(mockStorageSet).toHaveBeenCalledWith({
        __mock_sessions: { tabs: {}, windows: { 1: { key: 'value' } } },
      });

      // Test getWindowValue
      mockStorageGet.mockResolvedValueOnce({
        __mock_sessions: { windows: { 1: { key: 'value' } } },
      });
      const val = await globalThis.browser.sessions.getWindowValue(1, 'key');
      expect(val).toBe('value');
    });

    it('covers all branch paths of sessions storage', async () => {
      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');

      // 1. Storage returns mock sessions with no tabs
      mockStorageGet.mockResolvedValueOnce({
        __mock_sessions: { windows: {} },
      });
      await globalThis.browser.sessions.setTabValue(1, 'key', 'value');
      expect(mockStorageSet).toHaveBeenLastCalledWith({
        __mock_sessions: { tabs: { 1: { key: 'value' } }, windows: {} },
      });

      // 2. Storage returns mock sessions with tabs but not for this tab
      mockStorageGet.mockResolvedValueOnce({
        __mock_sessions: { tabs: { 2: { otherKey: 'val2' } }, windows: {} },
      });
      await globalThis.browser.sessions.setTabValue(1, 'key', 'value');
      expect(mockStorageSet).toHaveBeenLastCalledWith({
        __mock_sessions: {
          tabs: { 2: { otherKey: 'val2' }, 1: { key: 'value' } },
          windows: {},
        },
      });

      // 2b. Storage returns mock sessions with tab already defined (line 67 else branch)
      mockStorageGet.mockResolvedValueOnce({
        __mock_sessions: { tabs: { 1: { key: 'old-value' } }, windows: {} },
      });
      await globalThis.browser.sessions.setTabValue(1, 'key', 'value');
      expect(mockStorageSet).toHaveBeenLastCalledWith({
        __mock_sessions: { tabs: { 1: { key: 'value' } }, windows: {} },
      });

      // 3. Storage returns mock sessions with windows but no windows object in mock
      mockStorageGet.mockResolvedValueOnce({
        __mock_sessions: { tabs: {} },
      });
      await globalThis.browser.sessions.setWindowValue(1, 'key', 'value');
      expect(mockStorageSet).toHaveBeenLastCalledWith({
        __mock_sessions: { tabs: {}, windows: { 1: { key: 'value' } } },
      });

      // 4. Storage returns mock sessions with windows but not for this window
      mockStorageGet.mockResolvedValueOnce({
        __mock_sessions: { tabs: {}, windows: { 2: { otherKey: 'val2' } } },
      });
      await globalThis.browser.sessions.setWindowValue(1, 'key', 'value');
      expect(mockStorageSet).toHaveBeenLastCalledWith({
        __mock_sessions: {
          tabs: {},
          windows: { 2: { otherKey: 'val2' }, 1: { key: 'value' } },
        },
      });

      // 4b. Storage returns mock sessions with window already defined (line 100 else branch)
      mockStorageGet.mockResolvedValueOnce({
        __mock_sessions: { tabs: {}, windows: { 1: { key: 'old-value' } } },
      });
      await globalThis.browser.sessions.setWindowValue(1, 'key', 'value');
      expect(mockStorageSet).toHaveBeenLastCalledWith({
        __mock_sessions: { tabs: {}, windows: { 1: { key: 'value' } } },
      });
    });

    it('does not overwrite sessions methods if they already exist', () => {
      const existingSetTabValue = jest.fn();
      globalThis.browser = {
        sessions: {
          setTabValue: existingSetTabValue,
        },
      };

      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');

      expect(globalThis.browser.sessions.setTabValue).toBe(existingSetTabValue);
    });
  });

  describe('action polyfill', () => {
    it('strips windowId from action methods if throwing', async () => {
      const mockSetTitle = jest
        .fn()
        .mockRejectedValueOnce(new Error('Invalid property'))
        .mockResolvedValueOnce(true);
      const mockSetBadgeText = jest
        .fn()
        .mockRejectedValueOnce(new Error('Invalid property'))
        .mockResolvedValueOnce(true);

      globalThis.browser = {
        action: {
          setTitle: mockSetTitle,
          setBadgeText: mockSetBadgeText,
        },
      };

      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');

      await globalThis.browser.action.setTitle({ windowId: 1, title: 'test' });
      expect(mockSetTitle).toHaveBeenCalledTimes(2);
      expect(mockSetTitle).toHaveBeenNthCalledWith(2, { title: 'test' });

      await globalThis.browser.action.setBadgeText({
        windowId: 1,
        text: 'test',
      });
      expect(mockSetBadgeText).toHaveBeenCalledTimes(2);
      expect(mockSetBadgeText).toHaveBeenNthCalledWith(2, { text: 'test' });
    });

    it('throws original error if windowId not present', async () => {
      const mockSetTitle = jest.fn().mockRejectedValue(new Error('Real error'));

      globalThis.browser = {
        action: {
          setTitle: mockSetTitle,
          setBadgeText: jest.fn(),
        },
      };

      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');

      await expect(
        globalThis.browser.action.setTitle({ title: 'test' }),
      ).rejects.toThrow('Real error');
    });

    it('throws original error if windowId not present on setBadgeText', async () => {
      const mockSetBadgeText = jest
        .fn()
        .mockRejectedValue(new Error('Real error'));

      globalThis.browser = {
        action: {
          setTitle: jest.fn(),
          setBadgeText: mockSetBadgeText,
        },
      };

      // eslint-disable-next-line global-require
      require('../../src/js/polyfill.js');

      await expect(
        globalThis.browser.action.setBadgeText({ text: 'test' }),
      ).rejects.toThrow('Real error');
    });
  });
});
