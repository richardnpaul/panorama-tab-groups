// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultOptions,
  type Options,
} from '../../../src/js/core/options.js';
import {
  createOptionsPage,
  type OptionsPagePorts,
} from '../../../src/js/options/page.js';
import type { Shortcut } from '../../../src/js/ports/shortcuts.js';

// Mocks of the parts the page puts together. The factories reach them lazily
// because vi.mock is hoisted above these declarations.
const addTranslations = vi.fn();
const updateShortcut = vi.fn();
const resetShortcut = vi.fn();
const disableShortcut = vi.fn();
const disableShortcutForm = vi.fn();
const enableShortcut = vi.fn();
const saveOptionView = vi.fn();
const showViewSpecificOptions = vi.fn();
const saveOptionTheme = vi.fn();
const saveOptionToolbarPosition = vi.fn();
const getStatistics = vi.fn();
const initNativeGroupsOption = vi.fn();
// What each factory was built with
const builtWith = vi.fn();

vi.mock('../../../src/js/options/translations.js', () => ({
  default: (i18n: unknown): unknown => addTranslations(i18n),
}));
vi.mock('../../../src/js/options/shortcuts.js', () => ({
  createShortcutHandlers: (ports: unknown) => {
    builtWith('shortcuts', ports);
    return {
      update: (e: unknown): unknown => updateShortcut(e),
      reset: (e: unknown): unknown => resetShortcut(e),
      disable: (o: unknown, e: unknown): unknown => disableShortcut(o, e),
      enable: (o: unknown, e: unknown): unknown => enableShortcut(o, e),
    };
  },
  disableShortcutForm: (n: unknown): unknown => disableShortcutForm(n),
}));
vi.mock('../../../src/js/options/view.js', () => ({
  createViewSaver: (ports: unknown) => {
    builtWith('view', ports);
    return (): unknown => saveOptionView();
  },
  showViewSpecificOptions: (v: unknown): unknown => showViewSpecificOptions(v),
}));
vi.mock('../../../src/js/options/theme.js', () => ({
  createThemeSaver: (ports: unknown) => {
    builtWith('theme', ports);
    return (): unknown => saveOptionTheme();
  },
}));
vi.mock('../../../src/js/options/toolbar.js', () => ({
  createToolbarSaver: (ports: unknown) => {
    builtWith('toolbar', ports);
    return (): unknown => saveOptionToolbarPosition();
  },
}));
vi.mock('../../../src/js/options/statistics.js', () => ({
  createStatistics: (ports: unknown) => {
    builtWith('statistics', ports);
    return (): unknown => getStatistics();
  },
}));
vi.mock('../../../src/js/options/native-groups.js', () => ({
  default: (ports: unknown): unknown => initNativeGroupsOption(ports),
}));

// The real options page, so the selectors are checked against the real markup
const optionsPage = readFileSync('src/options.html', 'utf8');
const pageBody = /<body[^>]*>([\s\S]*)<\/body>/.exec(optionsPage)?.[1] ?? '';

const storedOptions = (overrides: Partial<Options> = {}): Options => ({
  toolbarPosition: 'bottom',
  useNativeGroups: true,
  shortcut: {},
  theme: 'dark',
  view: 'freeform',
  ...overrides,
});

const checkedValue = (name: string) =>
  document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)
    ?.value;

const element = (selector: string): Element => {
  const found = document.querySelector(selector);
  if (found === null) {
    throw new Error(`test page has no ${selector}`);
  }
  return found;
};

const loadOptions = vi.fn<() => Promise<Options>>();
const getAllShortcuts = vi.fn<() => Promise<Shortcut[]>>();
const loadBackup = vi.fn<(event: Event) => Promise<void>>();
const saveBackup = vi.fn<() => Promise<void>>();

function portsOfPage(): OptionsPagePorts {
  return {
    options: { load: loadOptions, save: () => Promise.resolve() },
    shortcuts: {
      getAll: getAllShortcuts,
      update: () => Promise.resolve(),
      reset: () => Promise.resolve(),
    },
    messaging: { send: () => Promise.resolve() },
    i18n: { getMessage: (name) => name },
    viewTabs: { listAll: () => Promise.resolve([]) },
    viewState: { thumbnail: () => Promise.resolve(undefined) },
    capabilities: { hasTabHide: true, hasTabGroups: true },
    backup: { loadBackup, saveBackup },
  };
}

let ports: OptionsPagePorts;

const startPage = () => createOptionsPage(ports).start();

describe('options/page.ts', () => {
  beforeEach(() => {
    [
      addTranslations,
      updateShortcut,
      resetShortcut,
      disableShortcut,
      disableShortcutForm,
      enableShortcut,
      saveOptionView,
      showViewSpecificOptions,
      saveOptionTheme,
      saveOptionToolbarPosition,
      getStatistics,
      initNativeGroupsOption,
      builtWith,
      loadOptions,
      getAllShortcuts,
      loadBackup,
      saveBackup,
    ].forEach((mock) => {
      mock.mockReset();
    });
    loadOptions.mockResolvedValue(storedOptions());
    getAllShortcuts.mockResolvedValue([]);
    getStatistics.mockResolvedValue(undefined);
    loadBackup.mockResolvedValue(undefined);
    saveBackup.mockResolvedValue(undefined);
    initNativeGroupsOption.mockResolvedValue(undefined);
    ports = portsOfPage();
    document.body.innerHTML = pageBody;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('builds each part of the page from the ports it was given', () => {
    createOptionsPage(ports);

    expect(builtWith.mock.calls).toEqual([
      ['shortcuts', ports],
      ['view', ports],
      ['theme', ports],
      ['toolbar', ports],
      ['statistics', ports],
    ]);
  });

  it('reads nothing until it is started', () => {
    createOptionsPage(ports);

    expect(loadOptions).not.toHaveBeenCalled();
    expect(getAllShortcuts).not.toHaveBeenCalled();
  });

  describe('starting up', () => {
    it('restores, translates, wires up and then initialises the rest', async () => {
      const order: string[] = [];
      loadOptions.mockImplementation(() => {
        order.push('load');
        return Promise.resolve(storedOptions());
      });
      showViewSpecificOptions.mockImplementation(() => order.push('restore'));
      addTranslations.mockImplementation(() => order.push('translate'));
      getStatistics.mockImplementation(() => {
        order.push('statistics');
        return Promise.resolve();
      });
      initNativeGroupsOption.mockImplementation(() => {
        order.push('native groups');
        return Promise.resolve();
      });

      await startPage();

      expect(order).toEqual([
        'load',
        'restore',
        'translate',
        'statistics',
        'native groups',
      ]);
    });

    it('translates with the page translations and hands its ports to the native groups option', async () => {
      await startPage();

      expect(addTranslations).toHaveBeenCalledWith(ports.i18n);
      expect(initNativeGroupsOption).toHaveBeenCalledWith(ports);
    });

    it('waits for the stored options and the shortcut list', async () => {
      let release: (value: Shortcut[]) => void = () => undefined;
      getAllShortcuts.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const started = startPage();
      await Promise.resolve();
      await Promise.resolve();
      expect(addTranslations).not.toHaveBeenCalled();

      release([]);
      await started;
      expect(addTranslations).toHaveBeenCalledTimes(1);
    });

    it('logs a failure to load the statistics and carries on', async () => {
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const failure = new Error('no tabs');
      getStatistics.mockRejectedValue(failure);

      await startPage();

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalledWith(
          '[Options] Failed to load statistics:',
          failure,
        );
      });
      expect(initNativeGroupsOption).toHaveBeenCalled();
    });

    it('fails to start when the options cannot be loaded', async () => {
      const failure = new Error('storage is gone');
      loadOptions.mockRejectedValue(failure);

      await expect(startPage()).rejects.toBe(failure);
      expect(addTranslations).not.toHaveBeenCalled();
    });
  });

  describe('restoring the options', () => {
    it('checks the stored view, theme and toolbar position', async () => {
      loadOptions.mockResolvedValue(
        storedOptions({
          view: 'popup',
          theme: 'light',
          toolbarPosition: 'left',
        }),
      );

      await startPage();

      expect(checkedValue('view')).toBe('popup');
      expect(checkedValue('theme')).toBe('light');
      expect(checkedValue('toolbarPosition')).toBe('left');
    });

    it('checks the defaults when nothing is stored', async () => {
      loadOptions.mockResolvedValue(createDefaultOptions('0.8.12', true));

      await startPage();

      expect(checkedValue('view')).toBe('freeform');
      expect(checkedValue('theme')).toBe('auto');
      expect(checkedValue('toolbarPosition')).toBe('top');
    });

    it('shows the options that belong to the stored view', async () => {
      await startPage();

      expect(showViewSpecificOptions).toHaveBeenCalledTimes(1);
      expect(showViewSpecificOptions).toHaveBeenCalledWith('freeform');
    });

    it('falls back to the automatic theme for an unknown stored theme', async () => {
      loadOptions.mockResolvedValue(storedOptions({ theme: 'sepia' }));

      await startPage();

      expect(checkedValue('theme')).toBe('auto');
    });

    it('leaves the theme alone when there is no automatic theme either', async () => {
      loadOptions.mockResolvedValue(storedOptions({ theme: 'sepia' }));
      element('input[name="theme"][value="auto"]').remove();

      await startPage();

      expect(checkedValue('theme')).toBeUndefined();
    });

    it.each([
      ['view', { view: 'no-such-view' }],
      ['toolbarPosition', { toolbarPosition: 'middle' }],
    ])(
      'fails when there is no radio button for the stored %s',
      async (name, stored) => {
        loadOptions.mockResolvedValue(storedOptions(stored));

        await expect(startPage()).rejects.toThrow(
          `Element not found: input[name="${name}"]`,
        );
        expect(initNativeGroupsOption).not.toHaveBeenCalled();
      },
    );

    it('locks the forms of the shortcuts that are disabled', async () => {
      getAllShortcuts.mockResolvedValue([
        { name: 'activate-next-group', shortcut: 'Alt+W' },
        { name: 'activate-previous-group', shortcut: 'Alt+Shift+W' },
        { name: '_execute_action', shortcut: 'Ctrl+Shift+F' },
      ]);
      loadOptions.mockResolvedValue(
        storedOptions({
          shortcut: {
            'activate-next-group': { disabled: true },
            'activate-previous-group': { disabled: false },
          },
        }),
      );

      await startPage();

      expect(disableShortcutForm).toHaveBeenCalledTimes(1);
      expect(disableShortcutForm).toHaveBeenCalledWith('activate-next-group');
    });
  });

  describe('wiring up the shortcut forms', () => {
    const next = { name: 'activate-next-group', shortcut: 'Alt+W' };

    const clickIn = (selector: string) => {
      element(`#activate-next-group ${selector}`).dispatchEvent(
        new Event('click'),
      );
    };

    beforeEach(() => {
      getAllShortcuts.mockResolvedValue([next]);
    });

    it('shows the current shortcut in the input', async () => {
      await startPage();

      expect(
        document.querySelector<HTMLInputElement>('#activate-next-group input')
          ?.value,
      ).toBe('Alt+W');
    });

    it('shows an empty input for a command without a shortcut', async () => {
      getAllShortcuts.mockResolvedValue([
        { name: 'activate-next-group', shortcut: '' },
      ]);

      await startPage();

      expect(
        document.querySelector<HTMLInputElement>('#activate-next-group input')
          ?.value,
      ).toBe('');
    });

    it('update and reset buttons run their handlers with the click', async () => {
      updateShortcut.mockResolvedValue(undefined);
      resetShortcut.mockResolvedValue(undefined);
      await startPage();

      clickIn('.updateShortcut');
      clickIn('.resetShortcut');

      expect(updateShortcut).toHaveBeenCalledTimes(1);
      expect(updateShortcut.mock.calls[0]?.[0]).toBeInstanceOf(Event);
      expect(resetShortcut).toHaveBeenCalledTimes(1);
      expect(resetShortcut.mock.calls[0]?.[0]).toBeInstanceOf(Event);
    });

    it('enable and disable buttons also receive the loaded options', async () => {
      const stored = storedOptions();
      loadOptions.mockResolvedValue(stored);
      enableShortcut.mockResolvedValue(undefined);
      disableShortcut.mockResolvedValue(undefined);
      await startPage();

      clickIn('.enableShortcut');
      clickIn('.disableShortcut');

      expect(enableShortcut).toHaveBeenCalledTimes(1);
      expect(enableShortcut.mock.calls[0]?.[0]).toBe(stored);
      expect(enableShortcut.mock.calls[0]?.[1]).toBeInstanceOf(Event);
      expect(disableShortcut).toHaveBeenCalledTimes(1);
      expect(disableShortcut.mock.calls[0]?.[0]).toBe(stored);
      expect(disableShortcut.mock.calls[0]?.[1]).toBeInstanceOf(Event);
    });

    it('logs a handler that fails', async () => {
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const failure = new Error('cannot update');
      updateShortcut.mockRejectedValue(failure);
      await startPage();

      clickIn('.updateShortcut');

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalledWith(
          '[Options] Event handler failed:',
          failure,
        );
      });
    });

    it('skips commands that have no form on the page', async () => {
      getAllShortcuts.mockResolvedValue([
        { name: 'not-on-the-page', shortcut: 'Alt+X' },
        next,
      ]);

      await startPage();

      expect(
        document.querySelector<HTMLInputElement>('#activate-next-group input')
          ?.value,
      ).toBe('Alt+W');
    });

    it('copes with a form that is missing some of its parts', async () => {
      document
        .querySelectorAll(
          '#activate-next-group input, #activate-next-group button',
        )
        .forEach((part) => {
          part.remove();
        });

      await startPage();

      expect(initNativeGroupsOption).toHaveBeenCalled();
    });

    it('skips an element that has the id but is not an HTML element', async () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<svg><g id="svg-shortcut"></g></svg>',
      );
      getAllShortcuts.mockResolvedValue([
        { name: 'svg-shortcut', shortcut: 'x' },
      ]);

      await startPage();

      expect(initNativeGroupsOption).toHaveBeenCalled();
    });
  });

  describe('wiring up the rest of the page', () => {
    beforeEach(() => {
      saveOptionView.mockResolvedValue(undefined);
      saveOptionTheme.mockResolvedValue(undefined);
      saveOptionToolbarPosition.mockResolvedValue(undefined);
    });

    it.each([
      ['form[name="formView"]', saveOptionView],
      ['form[name="formTheme"]', saveOptionTheme],
      ['form[name="formToolbarPosition"]', saveOptionToolbarPosition],
    ])('saves when %s changes', async (selector, handler) => {
      await startPage();

      element(selector).dispatchEvent(new Event('change'));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not save the other options when one form changes', async () => {
      await startPage();

      element('form[name="formView"]').dispatchEvent(new Event('change'));

      expect(saveOptionTheme).not.toHaveBeenCalled();
      expect(saveOptionToolbarPosition).not.toHaveBeenCalled();
    });

    it('loads a backup file when one is chosen', async () => {
      await startPage();

      element('#backupFileInput').dispatchEvent(new Event('change'));

      expect(loadBackup).toHaveBeenCalledTimes(1);
      expect(loadBackup.mock.calls[0]?.[0]).toBeInstanceOf(Event);
    });

    it('saves a backup when the button is clicked', async () => {
      await startPage();

      element('#saveBackupButton').dispatchEvent(new Event('click'));

      expect(saveBackup).toHaveBeenCalledTimes(1);
    });

    it.each([
      'form[name="formView"]',
      'form[name="formTheme"]',
      'form[name="formToolbarPosition"]',
    ])('fails naming %s when the form cannot be found', async (selector) => {
      // Keep the form's radio buttons, so the options can still be restored
      element(selector).removeAttribute('name');

      await expect(startPage()).rejects.toThrow(
        `Element not found: ${selector}`,
      );
    });

    it.each(['#backupFileInput', '#saveBackupButton'])(
      'fails naming %s when it is missing',
      async (selector) => {
        element(selector).remove();

        await expect(startPage()).rejects.toThrow(
          `Element not found: ${selector}`,
        );
      },
    );
  });
});
