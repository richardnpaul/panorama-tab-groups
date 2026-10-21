let mockUseNativeGroups = true;
vi.mock('../../../src/js/share/options.js', () => ({
  loadOptions: vi.fn().mockImplementation(() =>
    Promise.resolve({
      useNativeGroups: mockUseNativeGroups,
    }),
  ),
}));

describe('options/native-groups.js', () => {
  let initNativeGroupsOption;
  let mockCheckbox;
  let mockFeedback;
  let mockContainer;
  let mockWarningText;

  const setupBrowserEnv = async (mode) => {
    mockUseNativeGroups = true;
    vi.clearAllMocks();
    global.browser = {
      storage: {
        sync: { set: vi.fn().mockResolvedValue() },
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(),
      },
      tabs: {},
    };

    if (mode === 'hybrid') {
      global.browser.tabGroups = { query: () => {} };
      global.browser.tabs.group = () => {};
      global.browser.tabs.hide = () => {};
    } else if (mode === 'collapse-only') {
      global.browser.tabGroups = { query: () => {} };
      global.browser.tabs.group = () => {};
    } else if (mode === 'legacy') {
      global.browser.tabs.hide = () => {};
    } // unsupported has neither

    mockCheckbox = {
      checked: false,
      addEventListener: vi.fn(),
      disabled: false,
    };
    mockFeedback = { textContent: '', style: { display: 'none' } };
    mockWarningText = { textContent: '', className: '' };
    mockContainer = {
      style: { display: 'none', opacity: '1' },
      querySelector: vi.fn(),
    };

    global.document = {
      getElementById: vi.fn((id) => {
        if (id === 'useNativeGroups') return mockCheckbox;
        if (id === 'nativeGroupsContainer') return mockContainer;
        if (id === 'nativeGroupsFeedback') return mockFeedback;
        if (id === 'nativeGroupsWarning') return mockWarningText;
        return null;
      }),
      createElement: vi.fn().mockReturnValue(mockWarningText),
    };

    vi.resetModules();
    ({ default: initNativeGroupsOption } =
      await import('../../../src/js/options/native-groups.js'));
  };

  describe('hybrid mode', () => {
    beforeEach(() => setupBrowserEnv('hybrid'));

    it('initializes fully functional', async () => {
      await initNativeGroupsOption();
      expect(mockWarningText.className).toBe('info-text');
      expect(mockCheckbox.disabled).toBe(false);
    });
  });

  describe('collapse-only mode', () => {
    beforeEach(() => setupBrowserEnv('collapse-only'));

    it('initializes the native groups option', async () => {
      await initNativeGroupsOption();
      expect(mockWarningText.className).toBe('warning-text');
      expect(mockCheckbox.checked).toBe(true);
    });

    it('triggers migration when toggled on', async () => {
      await initNativeGroupsOption();
      const changeHandler = mockCheckbox.addEventListener.mock.calls[0][1];
      mockCheckbox.checked = true;
      changeHandler();
      await new Promise(process.nextTick);
      expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'migrateToHybridGroups',
      });
    });

    it('triggers cleanup when toggled off', async () => {
      await initNativeGroupsOption();
      const changeHandler = mockCheckbox.addEventListener.mock.calls[0][1];
      mockCheckbox.checked = false;
      changeHandler();
      await new Promise(process.nextTick);
      expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'cleanupNativeGroups',
      });
    });
  });

  describe('legacy mode', () => {
    beforeEach(() => setupBrowserEnv('legacy'));

    it('disables checkbox', async () => {
      await initNativeGroupsOption();
      expect(mockWarningText.className).toBe('warning-text');
      expect(mockCheckbox.disabled).toBe(true);
    });
  });

  describe('unsupported mode', () => {
    beforeEach(() => setupBrowserEnv('unsupported'));

    it('disables checkbox', async () => {
      await initNativeGroupsOption();
      expect(mockWarningText.className).toBe('warning-text');
      expect(mockCheckbox.disabled).toBe(true);
    });
  });

  describe('error handling and edge cases', () => {
    beforeEach(async () => {
      await setupBrowserEnv('hybrid');
    });

    it('handles missing checkbox or container DOM elements', async () => {
      global.document.getElementById = vi.fn().mockReturnValue(null);
      await initNativeGroupsOption();
      // Should return early and not throw
    });

    it('handles storage.sync.set failure', async () => {
      global.browser.storage.sync.set.mockRejectedValue(
        new Error('Sync set error'),
      );
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await initNativeGroupsOption();
      const changeHandler = mockCheckbox.addEventListener.mock.calls[0][1];
      mockCheckbox.checked = true;
      changeHandler();

      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Options] Failed to save useNativeGroups:',
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });

    it('handles sendMessage migration failure', async () => {
      global.browser.runtime.sendMessage.mockRejectedValue(
        new Error('Migration send error'),
      );
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await initNativeGroupsOption();
      const changeHandler = mockCheckbox.addEventListener.mock.calls[0][1];
      mockCheckbox.checked = true;
      changeHandler();

      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Options] Failed to send migration message:',
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });

    it('handles sendMessage cleanup failure', async () => {
      global.browser.runtime.sendMessage.mockRejectedValue(
        new Error('Cleanup send error'),
      );
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await initNativeGroupsOption();
      const changeHandler = mockCheckbox.addEventListener.mock.calls[0][1];
      mockCheckbox.checked = false;
      changeHandler();

      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Options] Failed to send cleanup message:',
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });

    it('handles options where useNativeGroups is false or undefined', async () => {
      mockUseNativeGroups = false;
      await initNativeGroupsOption();
      expect(mockCheckbox.checked).toBe(false);
    });

    it('handles missing feedback DOM element when toggled', async () => {
      const origGetElementById = global.document.getElementById;
      global.document.getElementById = vi.fn((id) => {
        if (id === 'nativeGroupsFeedback') return null;
        if (id === 'useNativeGroups') return mockCheckbox;
        if (id === 'nativeGroupsContainer') return mockContainer;
        if (id === 'nativeGroupsWarning') return mockWarningText;
        return null;
      });

      await initNativeGroupsOption();
      const changeHandler = mockCheckbox.addEventListener.mock.calls[0][1];
      mockCheckbox.checked = true;
      changeHandler();

      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(mockFeedback.style.display).toBe('none');
      global.document.getElementById = origGetElementById;
    });

    describe('with fake timers', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('hides feedback after 3 seconds', async () => {
        await initNativeGroupsOption();
        const changeHandler = mockCheckbox.addEventListener.mock.calls[0][1];
        mockCheckbox.checked = true;
        changeHandler();

        expect(mockFeedback.style.display).toBe('block');
        vi.advanceTimersByTime(3000);
        expect(mockFeedback.style.display).toBe('none');
      });
    });
  });
});
