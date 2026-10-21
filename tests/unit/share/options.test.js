describe('share/options.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    global.browser = {
      runtime: {
        getManifest: jest.fn().mockReturnValue({ version: '1.0' }),
      },
      storage: {
        sync: {
          get: jest.fn(),
        },
      },
      tabGroups: { query: jest.fn() },
      tabs: { group: jest.fn() },
    };
  });

  afterEach(() => {
    delete global.browser;
  });

  it('provides defaultOptions and handles majorVersion >= 1', () => {
    let defaultOptions;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const optionsModule = require('../../../src/js/share/options.js');
      defaultOptions = optionsModule.defaultOptions;
    });

    expect(defaultOptions).toBeDefined();
    expect(defaultOptions.toolbarPosition).toBe('top');
    expect(defaultOptions.useNativeGroups).toBe(true);
    expect(defaultOptions.theme).toBe('auto');
    expect(defaultOptions.view).toBe('popup'); // majorVersion >= 1
  });

  it('provides defaultOptions and handles majorVersion < 1', () => {
    global.browser.runtime.getManifest.mockReturnValue({ version: '0.9.0' });

    let defaultOptions;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const optionsModule = require('../../../src/js/share/options.js');
      defaultOptions = optionsModule.defaultOptions;
    });

    expect(defaultOptions.theme).toBe('auto');
    expect(defaultOptions.view).toBe('freeform'); // majorVersion < 1
  });

  it('disables native groups if APIs are not available', () => {
    delete global.browser.tabGroups;
    let defaultOptions;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const optionsModule = require('../../../src/js/share/options.js');
      defaultOptions = optionsModule.defaultOptions;
    });

    expect(defaultOptions.useNativeGroups).toBe(false);
  });

  it('loads options via loadOptions()', async () => {
    const mockOptions = { view: 'custom' };
    global.browser.storage.sync.get.mockResolvedValue(mockOptions);

    let loadedOptions;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const optionsModule = require('../../../src/js/share/options.js');
      loadedOptions = optionsModule.loadOptions();
    });

    const result = await loadedOptions;
    expect(result).toEqual(mockOptions);
    expect(global.browser.storage.sync.get).toHaveBeenCalledWith(
      expect.any(Object),
    );
  });
});
