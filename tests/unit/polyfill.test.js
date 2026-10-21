describe('polyfill.js', () => {
  beforeEach(() => {
    // Reset global environment
    delete globalThis.browser;
    delete globalThis.chrome;
    vi.resetModules();
  });

  describe('browser alias', () => {
    it('sets browser to chrome if undefined', async () => {
      globalThis.chrome = { runtime: {} };
      await import('../../src/js/polyfill.js');
      expect(globalThis.browser).toBe(globalThis.chrome);
    });

    it('does not crash if browser and chrome are undefined', async () => {
      await import('../../src/js/polyfill.js');
      expect(globalThis.browser).toBeUndefined();
    });
  });

  describe('menus polyfill', () => {
    it('polyfills menus using contextMenus proxy', async () => {
      const mockContextMenus = {
        create: vi.fn().mockReturnValue(1),
        update: vi.fn().mockReturnValue(true),
        remove: vi.fn(),
      };

      globalThis.browser = {
        contextMenus: mockContextMenus,
      };

      await import('../../src/js/polyfill.js');

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

    it('directly aliases menus if proxy polyfill not needed or previously executed', async () => {
      globalThis.chrome = {
        contextMenus: {},
      };
      globalThis.browser = undefined; // Trigger `typeof browser === 'undefined'` block

      await import('../../src/js/polyfill.js');
      expect(globalThis.browser.menus).toBe(globalThis.browser.contextMenus);
    });
  });

  describe('sessions polyfill', () => {
    let mockStorageGet;
    let mockStorageSet;

    beforeEach(() => {
      mockStorageGet = vi.fn().mockResolvedValue({});
      mockStorageSet = vi.fn().mockResolvedValue();

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
      await import('../../src/js/polyfill.js');

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
      await import('../../src/js/polyfill.js');

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
      await import('../../src/js/polyfill.js');

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

    it('does not overwrite sessions methods if they already exist', async () => {
      const existingSetTabValue = vi.fn();
      globalThis.browser = {
        sessions: {
          setTabValue: existingSetTabValue,
        },
      };

      await import('../../src/js/polyfill.js');

      expect(globalThis.browser.sessions.setTabValue).toBe(existingSetTabValue);
    });
  });

  describe('action polyfill', () => {
    it('strips windowId from action methods if throwing', async () => {
      const mockSetTitle = vi
        .fn()
        .mockRejectedValueOnce(new Error('Invalid property'))
        .mockResolvedValueOnce(true);
      const mockSetBadgeText = vi
        .fn()
        .mockRejectedValueOnce(new Error('Invalid property'))
        .mockResolvedValueOnce(true);

      globalThis.browser = {
        action: {
          setTitle: mockSetTitle,
          setBadgeText: mockSetBadgeText,
        },
      };

      await import('../../src/js/polyfill.js');

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
      const mockSetTitle = vi.fn().mockRejectedValue(new Error('Real error'));

      globalThis.browser = {
        action: {
          setTitle: mockSetTitle,
          setBadgeText: vi.fn(),
        },
      };

      await import('../../src/js/polyfill.js');

      await expect(
        globalThis.browser.action.setTitle({ title: 'test' }),
      ).rejects.toThrow('Real error');
    });

    it('throws original error if windowId not present on setBadgeText', async () => {
      const mockSetBadgeText = vi
        .fn()
        .mockRejectedValue(new Error('Real error'));

      globalThis.browser = {
        action: {
          setTitle: vi.fn(),
          setBadgeText: mockSetBadgeText,
        },
      };

      await import('../../src/js/polyfill.js');

      await expect(
        globalThis.browser.action.setBadgeText({ text: 'test' }),
      ).rejects.toThrow('Real error');
    });
  });
});
