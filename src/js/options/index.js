import { loadOptions } from '../_share/options.js';
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

function restoreOptions(options, loadedShortcuts) {
  // Shortcuts
  loadedShortcuts.forEach((shortcut) => {
    if (Object.prototype.hasOwnProperty.call(shortcut, 'name')) {
      return;
    }
    if (options.shortcut[shortcut.name].disabled) {
      disableShortcutForm(shortcut.name);
    }
  });

  // View
  document.querySelector(
    `input[name="view"][value="${options.view}"]`,
  ).checked = true;
  showViewSpecificOptions(options.view);

  // Theme
  const themeElement = document.querySelector(
    `input[name="theme"][value="${options.theme}"]`,
  );
  if (themeElement) {
    themeElement.checked = true;
  } else {
    // Fallback to 'auto' if the stored theme value doesn't exist
    const autoElement = document.querySelector('input[name="theme"][value="auto"]');
    if (autoElement) {
      autoElement.checked = true;
    }
  }

  // Toolbar
  document.querySelector(
    `input[name="toolbarPosition"][value="${options.toolbarPosition}"]`,
  ).checked = true;
}

function attachEventHandler(options, loadedShortcuts) {
  // Shortcuts
  loadedShortcuts.forEach((shortcut) => {
    const shortcutNode = document.querySelector(`#${shortcut.name}`);

    if (!shortcutNode) {
      return;
    }

    const inputElement = shortcutNode.querySelector('input');
    const updateButton = shortcutNode.querySelector('.updateShortcut');
    const resetButton = shortcutNode.querySelector('.resetShortcut');
    const enableButton = shortcutNode.querySelector('.enableShortcut');
    const disableButton = shortcutNode.querySelector('.disableShortcut');

    if (inputElement) {
      inputElement.value = shortcut.shortcut;
    }

    if (updateButton) {
      updateButton.addEventListener('click', updateShortcut);
    }

    if (resetButton) {
      resetButton.addEventListener('click', resetShortcut);
    }

    if (enableButton) {
      enableButton.addEventListener('click', enableShortcut.bind(this, options));
    }

    if (Object.prototype.hasOwnProperty.call(shortcut, 'name') && disableButton) {
      disableButton.addEventListener('click', disableShortcut.bind(this, options));
    }
  });

  // View
  document
    .querySelector('form[name="formView"]')
    .addEventListener('change', saveOptionView);

  // Theme
  document
    .querySelector('form[name="formTheme"]')
    .addEventListener('change', saveOptionTheme);

  // Toolbar
  document
    .querySelector('form[name="formToolbarPosition"]')
    .addEventListener('change', saveOptionToolbarPosition);

  // Backup
  document
    .getElementById('backupFileInput')
    .addEventListener('change', loadBackup);
  document
    .getElementById('saveBackupButton')
    .addEventListener('click', saveBackup);
  document.getElementById('resetAddon').addEventListener('click', resetPTG);
}

async function init() {
  const options = await loadOptions();
  restoreOptions(options, await shortcuts);
  addTranslations();
  attachEventHandler(options, await shortcuts);
  getStatistics();
}

document.addEventListener('DOMContentLoaded', init);
