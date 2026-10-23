// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../../../src/js/share/options.js';

// Mocks of everything index.ts wires together. The factories reach them lazily
// because vi.mock is hoisted above these declarations.
const loadOptions = vi.fn();
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
const loadBackup = vi.fn();
const saveBackup = vi.fn();
const getStatistics = vi.fn();
const resetPTG = vi.fn();
const initNativeGroupsOption = vi.fn();
const commands: { value: Promise<unknown> } = { value: Promise.resolve([]) };

vi.mock('../../../src/js/polyfill.js', () => ({}));
vi.mock('../../../src/js/share/options.js', () => ({
  loadOptions: (): unknown => loadOptions(),
}));
vi.mock('../../../src/js/options/translations.js', () => ({
  default: (): unknown => addTranslations(),
}));
vi.mock('../../../src/js/options/shortcuts.js', () => ({
  get shortcuts() {
    return commands.value;
  },
  updateShortcut: (e: unknown): unknown => updateShortcut(e),
  resetShortcut: (e: unknown): unknown => resetShortcut(e),
  disableShortcut: (o: unknown, e: unknown): unknown => disableShortcut(o, e),
  disableShortcutForm: (n: unknown): unknown => disableShortcutForm(n),
  enableShortcut: (o: unknown, e: unknown): unknown => enableShortcut(o, e),
}));
vi.mock('../../../src/js/options/view.js', () => ({
  saveOptionView: (): unknown => saveOptionView(),
  showViewSpecificOptions: (v: unknown): unknown => showViewSpecificOptions(v),
}));
vi.mock('../../../src/js/options/theme.js', () => ({
  default: (): unknown => saveOptionTheme(),
}));
vi.mock('../../../src/js/options/toolbar.js', () => ({
  default: (): unknown => saveOptionToolbarPosition(),
}));
vi.mock('../../../src/js/options/backup.js', () => ({
  loadBackup: (e: unknown): unknown => loadBackup(e),
  saveBackup: (): unknown => saveBackup(),
}));
vi.mock('../../../src/js/options/statistics.js', () => ({
  default: (): unknown => getStatistics(),
}));
vi.mock('../../../src/js/options/reset.js', () => ({
  default: (): unknown => resetPTG(),
}));
vi.mock('../../../src/js/options/native-groups.js', () => ({
  default: (): unknown => initNativeGroupsOption(),
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

let domReady: (() => void) | undefined;

/** Import the module, capture its DOMContentLoaded listener, and fire it */
async function startPage() {
  domReady = undefined;
  vi.spyOn(document, 'addEventListener').mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'DOMContentLoaded' && typeof listener === 'function') {
        domReady = () => {
          listener(new Event('DOMContentLoaded'));
        };
      }
    },
  );
  await import('../../../src/js/options/index.js');
}

async function runInit() {
  domReady?.();
  await vi.waitFor(() => {
    expect(initNativeGroupsOption).toHaveBeenCalled();
  });
}

describe('options/index.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    [
      loadOptions,
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
      loadBackup,
      saveBackup,
      getStatistics,
      resetPTG,
      initNativeGroupsOption,
    ].forEach((mock) => {
      mock.mockReset();
    });
    loadOptions.mockResolvedValue(storedOptions());
    getStatistics.mockResolvedValue(undefined);
    loadBackup.mockResolvedValue(undefined);
    saveBackup.mockResolvedValue(undefined);
    initNativeGroupsOption.mockResolvedValue(undefined);
    commands.value = Promise.resolve([]);
    document.body.innerHTML = pageBody;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('starts when the page has loaded, not before', async () => {
    await startPage();

    expect(domReady).toBeDefined();
    expect(loadOptions).not.toHaveBeenCalled();
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

      await runInit();

      expect(order).toEqual([
        'load',
        'restore',
        'translate',
        'statistics',
        'native groups',
      ]);
    });

    it('waits for the stored options and the shortcut list', async () => {
      let release: (value: unknown) => void = () => undefined;
      commands.value = new Promise((resolve) => {
        release = resolve;
      });
      await startPage();

      domReady?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(addTranslations).not.toHaveBeenCalled();

      release([]);
      await vi.waitFor(() => {
        expect(addTranslations).toHaveBeenCalledTimes(1);
      });
    });

    it('logs a failure to load the statistics and carries on', async () => {
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const failure = new Error('no tabs');
      getStatistics.mockRejectedValue(failure);
      await startPage();

      await runInit();
      await vi.waitFor(() => {
        expect(error).toHaveBeenCalledWith(
          '[Options] Failed to load statistics:',
          failure,
        );
      });
    });

    it('logs a failure to start instead of leaving it unhandled', async () => {
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const failure = new Error('storage is gone');
      loadOptions.mockRejectedValue(failure);
      await startPage();

      domReady?.();

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalledWith(
          '[Options] Event handler failed:',
          failure,
        );
      });
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

      await runInit();

      expect(checkedValue('view')).toBe('popup');
      expect(checkedValue('theme')).toBe('light');
      expect(checkedValue('toolbarPosition')).toBe('left');
    });

    it('shows the options that belong to the stored view', async () => {
      await startPage();

      await runInit();

      expect(showViewSpecificOptions).toHaveBeenCalledTimes(1);
      expect(showViewSpecificOptions).toHaveBeenCalledWith('freeform');
    });

    it('falls back to the automatic theme for an unknown stored theme', async () => {
      loadOptions.mockResolvedValue(storedOptions({ theme: 'sepia' }));
      await startPage();

      await runInit();

      expect(checkedValue('theme')).toBe('auto');
    });

    it('leaves the theme alone when there is no automatic theme either', async () => {
      loadOptions.mockResolvedValue(storedOptions({ theme: 'sepia' }));
      element('input[name="theme"][value="auto"]').remove();
      await startPage();

      await runInit();

      expect(checkedValue('theme')).toBeUndefined();
    });

    it.each([
      ['view', { view: 'panorama' }],
      ['toolbarPosition', { toolbarPosition: 'middle' }],
    ])(
      'fails when there is no radio button for the stored %s',
      async (name, stored) => {
        const error = vi
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);
        loadOptions.mockResolvedValue(storedOptions(stored));
        await startPage();

        domReady?.();

        await vi.waitFor(() => {
          expect(error).toHaveBeenCalled();
        });
        expect(String(error.mock.calls[0]?.[1])).toContain(
          `Element not found: input[name="${name}"]`,
        );
        expect(initNativeGroupsOption).not.toHaveBeenCalled();
      },
    );

    it('locks the forms of the shortcuts that are disabled', async () => {
      commands.value = Promise.resolve([
        { name: 'activate-next-group', shortcut: 'Alt+W' },
        { name: 'activate-previous-group', shortcut: 'Alt+Shift+W' },
        { name: '_execute_action', shortcut: 'Ctrl+Shift+F' },
        { shortcut: 'no-name' },
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

      await runInit();

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
      commands.value = Promise.resolve([next]);
    });

    it('shows the current shortcut in the input', async () => {
      await startPage();

      await runInit();

      expect(
        document.querySelector<HTMLInputElement>('#activate-next-group input')
          ?.value,
      ).toBe('Alt+W');
    });

    it('shows an empty input for a command without a shortcut', async () => {
      commands.value = Promise.resolve([{ name: 'activate-next-group' }]);
      await startPage();

      await runInit();

      expect(
        document.querySelector<HTMLInputElement>('#activate-next-group input')
          ?.value,
      ).toBe('');
    });

    it('update and reset buttons run their handlers with the click', async () => {
      updateShortcut.mockResolvedValue(undefined);
      resetShortcut.mockResolvedValue(undefined);
      await startPage();
      await runInit();

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
      await runInit();

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
      await runInit();

      clickIn('.updateShortcut');

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalledWith(
          '[Options] Event handler failed:',
          failure,
        );
      });
    });

    it('skips commands that have no form on the page', async () => {
      commands.value = Promise.resolve([
        { name: 'not-on-the-page', shortcut: 'Alt+X' },
        { shortcut: 'no-name' },
        next,
      ]);
      await startPage();

      await runInit();

      expect(
        document.querySelector<HTMLInputElement>('#activate-next-group input')
          ?.value,
      ).toBe('Alt+W');
    });

    it('never wires a command that has no name, whatever is on the page', async () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<form id="undefined"><input value="untouched" /><button class="updateShortcut"></button></form>',
      );
      commands.value = Promise.resolve([{ shortcut: 'no-name' }]);
      await startPage();
      await runInit();

      element('#undefined .updateShortcut').dispatchEvent(new Event('click'));

      expect(updateShortcut).not.toHaveBeenCalled();
      expect(
        document.querySelector<HTMLInputElement>('#undefined input')?.value,
      ).toBe('untouched');
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

      await runInit();

      expect(initNativeGroupsOption).toHaveBeenCalled();
    });

    it('skips an element that has the id but is not an HTML element', async () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<svg><g id="svg-shortcut"></g></svg>',
      );
      commands.value = Promise.resolve([
        { name: 'svg-shortcut', shortcut: 'x' },
      ]);
      await startPage();

      await runInit();

      expect(initNativeGroupsOption).toHaveBeenCalled();
    });
  });

  describe('wiring up the rest of the page', () => {
    beforeEach(() => {
      saveOptionView.mockResolvedValue(undefined);
      saveOptionTheme.mockResolvedValue(undefined);
      saveOptionToolbarPosition.mockResolvedValue(undefined);
      saveBackup.mockResolvedValue(undefined);
    });

    it.each([
      ['form[name="formView"]', saveOptionView],
      ['form[name="formTheme"]', saveOptionTheme],
      ['form[name="formToolbarPosition"]', saveOptionToolbarPosition],
    ])('saves when %s changes', async (selector, handler) => {
      await startPage();
      await runInit();

      element(selector).dispatchEvent(new Event('change'));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not save the other options when one form changes', async () => {
      await startPage();
      await runInit();

      element('form[name="formView"]').dispatchEvent(new Event('change'));

      expect(saveOptionTheme).not.toHaveBeenCalled();
      expect(saveOptionToolbarPosition).not.toHaveBeenCalled();
    });

    it('loads a backup file when one is chosen', async () => {
      await startPage();
      await runInit();

      element('#backupFileInput').dispatchEvent(new Event('change'));

      expect(loadBackup).toHaveBeenCalledTimes(1);
      expect(loadBackup.mock.calls[0]?.[0]).toBeInstanceOf(Event);
    });

    it('saves a backup when the button is clicked', async () => {
      await startPage();
      await runInit();

      element('#saveBackupButton').dispatchEvent(new Event('click'));

      expect(saveBackup).toHaveBeenCalledTimes(1);
    });

    it('resets the add-on when the reset button is clicked', async () => {
      await startPage();
      await runInit();

      element('#resetAddon').dispatchEvent(new Event('click'));

      expect(resetPTG).toHaveBeenCalledTimes(1);
    });

    it.each([
      'form[name="formView"]',
      'form[name="formTheme"]',
      'form[name="formToolbarPosition"]',
    ])('fails naming %s when the form cannot be found', async (selector) => {
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      // Keep the form's radio buttons, so the options can still be restored
      element(selector).removeAttribute('name');
      await startPage();

      domReady?.();

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
      expect(String(error.mock.calls[0]?.[1])).toContain(
        `Element not found: ${selector}`,
      );
    });

    it.each(['#backupFileInput', '#saveBackupButton', '#resetAddon'])(
      'fails naming %s when it is missing',
      async (selector) => {
        const error = vi
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);
        element(selector).remove();
        await startPage();

        domReady?.();

        await vi.waitFor(() => {
          expect(error).toHaveBeenCalled();
        });
        expect(String(error.mock.calls[0]?.[1])).toContain(
          `Element not found: ${selector}`,
        );
      },
    );
  });
});
