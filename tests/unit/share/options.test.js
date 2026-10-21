describe('share/options.js', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    global.browser = {
      runtime: {
        getManifest: vi.fn().mockReturnValue({ version: '1.0' }),
      },
      storage: {
        sync: {
          get: vi.fn(),
        },
      },
      tabGroups: { query: vi.fn() },
      tabs: { group: vi.fn() },
    };
  });

  afterEach(() => {
    delete global.browser;
  });

  it('provides defaultOptions and handles majorVersion >= 1', async () => {
    const { defaultOptions } = await import('../../../src/js/share/options.js');

    expect(defaultOptions).toBeDefined();
    expect(defaultOptions.toolbarPosition).toBe('top');
    expect(defaultOptions.useNativeGroups).toBe(true);
    expect(defaultOptions.theme).toBe('auto');
    expect(defaultOptions.view).toBe('popup'); // majorVersion >= 1
  });

  it('provides defaultOptions and handles majorVersion < 1', async () => {
    global.browser.runtime.getManifest.mockReturnValue({ version: '0.9.0' });

    const { defaultOptions } = await import('../../../src/js/share/options.js');

    expect(defaultOptions.theme).toBe('auto');
    expect(defaultOptions.view).toBe('freeform'); // majorVersion < 1
  });

  it('disables native groups if APIs are not available', async () => {
    delete global.browser.tabGroups;
    const { defaultOptions } = await import('../../../src/js/share/options.js');

    expect(defaultOptions.useNativeGroups).toBe(false);
  });

  it('loads options via loadOptions()', async () => {
    const mockOptions = { view: 'custom' };
    global.browser.storage.sync.get.mockResolvedValue(mockOptions);

    const { loadOptions } = await import('../../../src/js/share/options.js');

    const result = await loadOptions();
    expect(result).toEqual(mockOptions);
    expect(global.browser.storage.sync.get).toHaveBeenCalledWith(
      expect.any(Object),
    );
  });
});
