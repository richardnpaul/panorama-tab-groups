import type { Options } from '../core/options.js';
import type { I18n } from '../ports/i18n.js';
import type { Messaging } from '../ports/messaging.js';
import type { OptionsStore } from '../ports/options.js';
import type { Shortcut, Shortcuts } from '../ports/shortcuts.js';
import type { ViewState } from '../ports/view-state.js';
import type { ViewTabs } from '../ports/view-tabs.js';
import type { Capabilities } from '../share/capabilities.js';
import {
  asListener,
  findElement,
  requireElement,
  requireElementById,
} from '../share/dom.js';
import type { BackupHandlers } from './backup.js';
import initNativeGroupsOption from './native-groups.js';
import resetPTG from './reset.js';
import {
  createShortcutHandlers,
  disableShortcutForm,
  type ShortcutHandlers,
} from './shortcuts.js';
import { createStatistics } from './statistics.js';
import { createThemeSaver } from './theme.js';
import { createToolbarSaver } from './toolbar.js';
import addTranslations from './translations.js';
import { createViewSaver, showViewSpecificOptions } from './view.js';

export interface OptionsPagePorts {
  options: OptionsStore;
  shortcuts: Shortcuts;
  messaging: Messaging;
  i18n: I18n;
  viewTabs: Pick<ViewTabs, 'listAll'>;
  viewState: Pick<ViewState, 'thumbnail'>;
  /** What the browser the page runs in can do */
  capabilities: Capabilities;
  backup: BackupHandlers;
}

/** What each form of the page does when it changes */
interface Savers {
  view: () => Promise<void>;
  theme: () => Promise<void>;
  toolbarPosition: () => Promise<void>;
}

function restoreOptions(
  options: Options,
  loadedShortcuts: readonly Shortcut[],
): void {
  // Shortcuts
  loadedShortcuts.forEach(({ name }) => {
    if (options.shortcut[name]?.disabled === true) {
      disableShortcutForm(name);
    }
  });

  // View
  requireElement(
    HTMLInputElement,
    `input[name="view"][value="${options.view}"]`,
  ).checked = true;
  showViewSpecificOptions(options.view);

  // Theme, falling back to 'auto' if the stored theme value doesn't exist
  const themeInput =
    findElement(
      HTMLInputElement,
      `input[name="theme"][value="${options.theme}"]`,
    ) ?? findElement(HTMLInputElement, 'input[name="theme"][value="auto"]');
  if (themeInput !== null) {
    themeInput.checked = true;
  }

  // Toolbar
  requireElement(
    HTMLInputElement,
    `input[name="toolbarPosition"][value="${options.toolbarPosition}"]`,
  ).checked = true;
}

function attachShortcutHandlers(
  handlers: ShortcutHandlers,
  options: Options,
  { name, shortcut }: Shortcut,
): void {
  const shortcutNode = findElement(HTMLElement, `#${name}`);
  if (shortcutNode === null) {
    return;
  }

  const inputElement = findElement(HTMLInputElement, 'input', shortcutNode);
  if (inputElement !== null) {
    inputElement.value = shortcut;
  }

  findElement(HTMLElement, '.updateShortcut', shortcutNode)?.addEventListener(
    'click',
    asListener(handlers.update),
  );
  findElement(HTMLElement, '.resetShortcut', shortcutNode)?.addEventListener(
    'click',
    asListener(handlers.reset),
  );
  findElement(HTMLElement, '.enableShortcut', shortcutNode)?.addEventListener(
    'click',
    asListener((event) => handlers.enable(options, event)),
  );
  findElement(HTMLElement, '.disableShortcut', shortcutNode)?.addEventListener(
    'click',
    asListener((event) => handlers.disable(options, event)),
  );
}

function attachEventHandlers(
  {
    shortcutHandlers,
    savers,
    backup,
  }: {
    shortcutHandlers: ShortcutHandlers;
    savers: Savers;
    backup: BackupHandlers;
  },
  options: Options,
  loadedShortcuts: readonly Shortcut[],
): void {
  loadedShortcuts.forEach((shortcut) => {
    attachShortcutHandlers(shortcutHandlers, options, shortcut);
  });

  requireElement(HTMLFormElement, 'form[name="formView"]').addEventListener(
    'change',
    asListener(savers.view),
  );
  requireElement(HTMLFormElement, 'form[name="formTheme"]').addEventListener(
    'change',
    asListener(savers.theme),
  );
  requireElement(
    HTMLFormElement,
    'form[name="formToolbarPosition"]',
  ).addEventListener('change', asListener(savers.toolbarPosition));

  // Backup
  requireElementById(HTMLElement, 'backupFileInput').addEventListener(
    'change',
    asListener(backup.loadBackup),
  );
  requireElementById(HTMLElement, 'saveBackupButton').addEventListener(
    'click',
    asListener(backup.saveBackup),
  );
  requireElementById(HTMLElement, 'resetAddon').addEventListener(
    'click',
    resetPTG,
  );
}

/** The options page: it shows what is stored and keeps what the user changes */
export function createOptionsPage(ports: OptionsPagePorts): {
  start: () => Promise<void>;
} {
  const shortcutHandlers = createShortcutHandlers(ports);
  const savers: Savers = {
    view: createViewSaver(ports),
    theme: createThemeSaver(ports),
    toolbarPosition: createToolbarSaver(ports),
  };
  const showStatistics = createStatistics(ports);

  return {
    async start() {
      const [options, loadedShortcuts] = await Promise.all([
        ports.options.load(),
        ports.shortcuts.getAll(),
      ]);
      restoreOptions(options, loadedShortcuts);
      addTranslations(ports.i18n);
      attachEventHandlers(
        { shortcutHandlers, savers, backup: ports.backup },
        options,
        loadedShortcuts,
      );
      showStatistics().catch((error: unknown) => {
        console.error('[Options] Failed to load statistics:', error);
      });
      await initNativeGroupsOption(ports);
    },
  };
}
