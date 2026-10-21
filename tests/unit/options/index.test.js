/* eslint-disable global-require */

jest.mock('../../../src/js/polyfill.js', () => ({}));
jest.mock('../../../src/js/share/options.js', () => ({
  loadOptions: jest.fn().mockResolvedValue({
    shortcut: {
      'test-shortcut': { disabled: true },
    },
    view: 'panorama',
    theme: 'dark',
    toolbarPosition: 'bottom',
  }),
}));

jest.mock('../../../src/js/options/translations.js', () => jest.fn());
jest.mock('../../../src/js/options/shortcuts.js', () => ({
  shortcuts: Promise.resolve([
    { name: 'test-shortcut', shortcut: 'Ctrl+A' },
    { shortcut: 'no-name' },
  ]),
  updateShortcut: jest.fn(),
  resetShortcut: jest.fn(),
  disableShortcut: jest.fn(),
  disableShortcutForm: jest.fn(),
  enableShortcut: jest.fn(),
}));
jest.mock('../../../src/js/options/view.js', () => ({
  saveOptionView: jest.fn(),
  showViewSpecificOptions: jest.fn(),
}));
jest.mock('../../../src/js/options/theme.js', () => jest.fn());
jest.mock('../../../src/js/options/toolbar.js', () => jest.fn());
jest.mock('../../../src/js/options/backup.js', () => ({
  loadBackup: jest.fn(),
  saveBackup: jest.fn(),
}));
jest.mock('../../../src/js/options/statistics.js', () => jest.fn());
jest.mock('../../../src/js/options/reset.js', () => jest.fn());
jest.mock('../../../src/js/options/native-groups.js', () =>
  jest.fn().mockResolvedValue(),
);

describe('options/index.js', () => {
  let mockElements;

  beforeEach(() => {
    jest.clearAllMocks();

    mockElements = {
      '#test-shortcut': {
        querySelector: jest.fn((selector) => {
          if (selector === 'input') return { value: '' };
          return { addEventListener: jest.fn() }; // return mock buttons
        }),
      },
      'form[name="formView"]': { addEventListener: jest.fn() },
      'form[name="formTheme"]': { addEventListener: jest.fn() },
      'form[name="formToolbarPosition"]': { addEventListener: jest.fn() },
      '#backupFileInput': { addEventListener: jest.fn() },
      '#saveBackupButton': { addEventListener: jest.fn() },
      '#resetAddon': { addEventListener: jest.fn() },
    };

    const inputElements = {};

    const getMockElement = (selector) => {
      if (mockElements[selector]) return mockElements[selector];
      if (selector === '#test-shortcut input') return { value: 'Ctrl+A' };

      const validSelectors = [
        'input[name="view"][value="panorama"]',
        'input[name="theme"][value="dark"]',
        'input[name="theme"][value="auto"]',
        'input[name="toolbarPosition"][value="bottom"]',
        'input[name="toolbarPosition"][value="top"]',
      ];

      if (selector.startsWith('input[')) {
        if (!validSelectors.includes(selector)) return null;
        if (!inputElements[selector]) {
          inputElements[selector] = { checked: false };
        }
        return inputElements[selector];
      }
      return null;
    };

    global.document = {
      querySelector: jest.fn((sel) => getMockElement(sel)),
      getElementById: jest.fn((id) => getMockElement(`#${id}`)),
      addEventListener: jest.fn((event, cb) => {
        if (event === 'DOMContentLoaded') {
          global.document.DOMContentLoadedCb = cb;
        }
      }),
    };
  });

  it('initializes options view', async () => {
    let loadOptions;
    let addTranslations;
    let getStatistics;
    let initNativeGroupsOption;
    let disableShortcutForm;
    let showViewSpecificOptions;

    jest.isolateModules(() => {
      require('../../../src/js/options/index.js');
      loadOptions = require('../../../src/js/share/options.js').loadOptions;
      addTranslations = require('../../../src/js/options/translations.js');
      getStatistics = require('../../../src/js/options/statistics.js');
      initNativeGroupsOption = require('../../../src/js/options/native-groups.js');
      disableShortcutForm =
        require('../../../src/js/options/shortcuts.js').disableShortcutForm;
      showViewSpecificOptions =
        require('../../../src/js/options/view.js').showViewSpecificOptions;
    });

    if (global.document.DOMContentLoadedCb) {
      global.document.DOMContentLoadedCb();
    }

    // Wait for async init to resolve
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(loadOptions).toHaveBeenCalled();
    expect(addTranslations).toHaveBeenCalled();
    expect(getStatistics).toHaveBeenCalled();
    expect(initNativeGroupsOption).toHaveBeenCalled();
    expect(disableShortcutForm).toHaveBeenCalledWith('test-shortcut');
    expect(showViewSpecificOptions).toHaveBeenCalledWith('panorama');

    expect(
      document.querySelector('input[name="view"][value="panorama"]').checked,
    ).toBe(true);
    expect(
      document.querySelector('input[name="theme"][value="dark"]').checked,
    ).toBe(true);
    expect(
      document.querySelector('input[name="toolbarPosition"][value="bottom"]')
        .checked,
    ).toBe(true);

    // Test event handlers attachment
    const shortcutInput = document.querySelector('#test-shortcut input');
    expect(shortcutInput.value).toBe('Ctrl+A');
  });

  it('falls back to auto theme if the stored theme is invalid', async () => {
    let loadOptions2;
    jest.isolateModules(() => {
      loadOptions2 = require('../../../src/js/share/options.js').loadOptions;
      loadOptions2.mockResolvedValueOnce({
        shortcut: {
          'test-shortcut': { disabled: false },
        },
        view: 'panorama',
        theme: 'invalid-theme',
        toolbarPosition: 'top',
      });
      require('../../../src/js/options/index.js');
    });

    if (global.document.DOMContentLoadedCb) {
      global.document.DOMContentLoadedCb();
    }
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(
      document.querySelector('input[name="theme"][value="auto"]').checked,
    ).toBe(true);
  });

  it('handles missing DOM elements gracefully', async () => {
    mockElements = {
      '#test-shortcut': {
        querySelector: jest.fn().mockReturnValue(null),
      },
      'form[name="formView"]': { addEventListener: jest.fn() },
      'form[name="formTheme"]': { addEventListener: jest.fn() },
      'form[name="formToolbarPosition"]': { addEventListener: jest.fn() },
      '#backupFileInput': { addEventListener: jest.fn() },
      '#saveBackupButton': { addEventListener: jest.fn() },
      '#resetAddon': { addEventListener: jest.fn() },
    };

    const loadOptionsMock =
      require('../../../src/js/share/options.js').loadOptions;
    loadOptionsMock.mockResolvedValueOnce({
      shortcut: {},
      view: 'panorama',
      theme: 'invalid-theme',
      toolbarPosition: 'bottom',
    });

    const origDocumentQuerySelector = global.document.querySelector;
    global.document.querySelector = jest.fn((sel) => {
      if (sel === 'input[name="theme"][value="auto"]') {
        return null;
      }
      if (sel === 'input[name="theme"][value="invalid-theme"]') {
        return null;
      }
      if (mockElements[sel]) return mockElements[sel];
      if (sel.startsWith('input[')) return { checked: false };
      return null;
    });

    jest.isolateModules(() => {
      require('../../../src/js/options/index.js');
    });

    if (global.document.DOMContentLoadedCb) {
      global.document.DOMContentLoadedCb();
    }
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    global.document.querySelector = origDocumentQuerySelector;
  });
});
