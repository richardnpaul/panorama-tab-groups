import '../polyfill.js';
import {
  asListener,
  findElement,
  requireElement,
  requireElementById,
} from '../share/dom.js';
import { loadOptions, type Options } from '../share/options.js';
import addTranslations from './translations.js';
import {
  shortcuts,
  updateShortcut,
  resetShortcut,
  disableShortcut,
  disableShortcutForm,
  enableShortcut,
} from './shortcuts.js';
import { saveOptionView, showViewSpecificOptions } from './view.js';
import saveOptionTheme from './theme.js';
import saveOptionToolbarPosition from './toolbar.js';
import { loadBackup, saveBackup } from './backup.js';
import getStatistics from './statistics.js';
import resetPTG from './reset.js';
import initNativeGroupsOption from './native-groups.js';

type Command = browser.commands.Command;

function restoreOptions(
  options: Options,
  loadedShortcuts: readonly Command[],
): void {
  // Shortcuts
  loadedShortcuts.forEach(({ name }) => {
    if (name !== undefined && options.shortcut[name]?.disabled === true) {
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
  options: Options,
  { name, shortcut }: Command,
): void {
  if (name === undefined) {
    return;
  }
  const shortcutNode = findElement(HTMLElement, `#${name}`);
  if (shortcutNode === null) {
    return;
  }

  const inputElement = findElement(HTMLInputElement, 'input', shortcutNode);
  if (inputElement !== null) {
    inputElement.value = shortcut ?? '';
  }

  findElement(HTMLElement, '.updateShortcut', shortcutNode)?.addEventListener(
    'click',
    asListener(updateShortcut),
  );
  findElement(HTMLElement, '.resetShortcut', shortcutNode)?.addEventListener(
    'click',
    asListener(resetShortcut),
  );
  findElement(HTMLElement, '.enableShortcut', shortcutNode)?.addEventListener(
    'click',
    asListener((event) => enableShortcut(options, event)),
  );
  findElement(HTMLElement, '.disableShortcut', shortcutNode)?.addEventListener(
    'click',
    asListener((event) => disableShortcut(options, event)),
  );
}

function attachEventHandlers(
  options: Options,
  loadedShortcuts: readonly Command[],
): void {
  loadedShortcuts.forEach((command) => {
    attachShortcutHandlers(options, command);
  });

  requireElement(HTMLFormElement, 'form[name="formView"]').addEventListener(
    'change',
    asListener(saveOptionView),
  );
  requireElement(HTMLFormElement, 'form[name="formTheme"]').addEventListener(
    'change',
    asListener(saveOptionTheme),
  );
  requireElement(
    HTMLFormElement,
    'form[name="formToolbarPosition"]',
  ).addEventListener('change', asListener(saveOptionToolbarPosition));

  // Backup
  requireElementById(HTMLElement, 'backupFileInput').addEventListener(
    'change',
    asListener(loadBackup),
  );
  requireElementById(HTMLElement, 'saveBackupButton').addEventListener(
    'click',
    asListener(saveBackup),
  );
  requireElementById(HTMLElement, 'resetAddon').addEventListener(
    'click',
    resetPTG,
  );
}

async function init(): Promise<void> {
  const options = await loadOptions();
  restoreOptions(options, await shortcuts);
  addTranslations();
  attachEventHandlers(options, await shortcuts);
  getStatistics().catch((error: unknown) => {
    console.error('[Options] Failed to load statistics:', error);
  });
  await initNativeGroupsOption();
}

document.addEventListener('DOMContentLoaded', asListener(init));
