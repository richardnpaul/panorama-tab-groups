vi.mock('../../../src/js/polyfill.js', () => ({}));
vi.mock('../../../src/js/share/options.js', () => ({
  loadOptions: vi.fn().mockResolvedValue({
    shortcut: {
      'test-shortcut': { disabled: true },
    },
    view: 'panorama',
    theme: 'dark',
    toolbarPosition: 'bottom',
  }),
}));

vi.mock('../../../src/js/options/translations.js', () => ({
  default: vi.fn(),
}));
vi.mock('../../../src/js/options/shortcuts.js', () => ({
  shortcuts: Promise.resolve([
    { name: 'test-shortcut', shortcut: 'Ctrl+A' },
    { shortcut: 'no-name' },
  ]),
  updateShortcut: vi.fn(),
  resetShortcut: vi.fn(),
  disableShortcut: vi.fn(),
  disableShortcutForm: vi.fn(),
  enableShortcut: vi.fn(),
}));
vi.mock('../../../src/js/options/view.js', () => ({
  saveOptionView: vi.fn(),
  showViewSpecificOptions: vi.fn(),
}));
vi.mock('../../../src/js/options/theme.js', () => ({ default: vi.fn() }));
vi.mock('../../../src/js/options/toolbar.js', () => ({ default: vi.fn() }));
vi.mock('../../../src/js/options/backup.js', () => ({
  loadBackup: vi.fn(),
  saveBackup: vi.fn(),
}));
vi.mock('../../../src/js/options/statistics.js', () => ({
  default: vi.fn(),
}));
vi.mock('../../../src/js/options/reset.js', () => ({ default: vi.fn() }));
vi.mock('../../../src/js/options/native-groups.js', () => ({
  default: vi.fn().mockResolvedValue(),
}));

describe('options/index.js', () => {
  let mockElements;

  beforeEach(() => {
    vi.clearAllMocks();

    mockElements = {
      '#test-shortcut': {
        querySelector: vi.fn((selector) => {
          if (selector === 'input') return { value: '' };
          return { addEventListener: vi.fn() }; // return mock buttons
        }),
      },
      'form[name="formView"]': { addEventListener: vi.fn() },
      'form[name="formTheme"]': { addEventListener: vi.fn() },
      'form[name="formToolbarPosition"]': { addEventListener: vi.fn() },
      '#backupFileInput': { addEventListener: vi.fn() },
      '#saveBackupButton': { addEventListener: vi.fn() },
      '#resetAddon': { addEventListener: vi.fn() },
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
      querySelector: vi.fn((sel) => getMockElement(sel)),
      getElementById: vi.fn((id) => getMockElement(`#${id}`)),
      addEventListener: vi.fn((event, cb) => {
        if (event === 'DOMContentLoaded') {
          global.document.DOMContentLoadedCb = cb;
        }
      }),
    };
  });

  it('initializes options view', async () => {
    vi.resetModules();
    await import('../../../src/js/options/index.js');
    const { loadOptions } = await import('../../../src/js/share/options.js');
    const { default: addTranslations } =
      await import('../../../src/js/options/translations.js');
    const { default: getStatistics } =
      await import('../../../src/js/options/statistics.js');
    const { default: initNativeGroupsOption } =
      await import('../../../src/js/options/native-groups.js');
    const { disableShortcutForm } =
      await import('../../../src/js/options/shortcuts.js');
    const { showViewSpecificOptions } =
      await import('../../../src/js/options/view.js');

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
    vi.resetModules();
    const { loadOptions: loadOptions2 } =
      await import('../../../src/js/share/options.js');
    loadOptions2.mockResolvedValueOnce({
      shortcut: {
        'test-shortcut': { disabled: false },
      },
      view: 'panorama',
      theme: 'invalid-theme',
      toolbarPosition: 'top',
    });
    await import('../../../src/js/options/index.js');

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
        querySelector: vi.fn().mockReturnValue(null),
      },
      'form[name="formView"]': { addEventListener: vi.fn() },
      'form[name="formTheme"]': { addEventListener: vi.fn() },
      'form[name="formToolbarPosition"]': { addEventListener: vi.fn() },
      '#backupFileInput': { addEventListener: vi.fn() },
      '#saveBackupButton': { addEventListener: vi.fn() },
      '#resetAddon': { addEventListener: vi.fn() },
    };

    vi.resetModules();
    const { loadOptions: loadOptionsMock } =
      await import('../../../src/js/share/options.js');
    loadOptionsMock.mockResolvedValueOnce({
      shortcut: {},
      view: 'panorama',
      theme: 'invalid-theme',
      toolbarPosition: 'bottom',
    });

    const origDocumentQuerySelector = global.document.querySelector;
    global.document.querySelector = vi.fn((sel) => {
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

    await import('../../../src/js/options/index.js');

    if (global.document.DOMContentLoadedCb) {
      global.document.DOMContentLoadedCb();
    }
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    global.document.querySelector = origDocumentQuerySelector;
  });
});
