import type { I18n } from '../ports/i18n.js';
import { requireElement } from '../share/dom.js';

// [selector of the one element to translate, message name]
const TEXTS: readonly (readonly [string, string])[] = [
  ['#optionKeyboardShortcuts h2', 'optionKeyboardShortcuts'],
  ['label[for="_execute_action"]', 'optionKeyboardShortcutsToggle'],
  ['label[for="activate-next-group"]', 'optionKeyboardShortcutsNextGroup'],
  [
    'label[for="activate-previous-group"]',
    'optionKeyboardShortcutsPreviousGroup',
  ],
  ['#optionsView h2', 'optionsView'],
  ['label[for="viewFreeform"] span', 'optionsViewFreeform'],
  ['label[for="viewPopup"] span', 'optionsViewPopup'],
  ['#optionsTheme h2', 'optionsTheme'],
  ['label[for="themeLight"] span', 'optionsThemeLight'],
  ['label[for="themeDark"] span', 'optionsThemeDark'],
  ['#optionsToolbar h3', 'optionsToolbar'],
  ['#optionsToolbar h4', 'optionsToolbarPosition'],
  ['label[for="toolbarPositionTop"] span', 'optionsToolbarPositionTop'],
  ['label[for="toolbarPositionRight"] span', 'optionsToolbarPositionRight'],
  ['label[for="toolbarPositionBottom"] span', 'optionsToolbarPositionBottom'],
  ['label[for="toolbarPositionLeft"] span', 'optionsToolbarPositionLeft'],
  ['#optionsBackup h2', 'optionsBackup'],
  ['#optionsBackup h3:nth-of-type(1)', 'optionsBackupImport'],
  ['#optionsBackup p:nth-of-type(1)', 'optionsBackupImportText'],
  ['#optionsBackup h3:nth-of-type(2)', 'optionsBackupExport'],
  ['#optionsBackup p:nth-of-type(2)', 'optionsBackupExportText'],
  ['#optionsStatistics h2', 'optionsStatistics'],
  ['label[for="numberOfTabs"]', 'optionsStatisticsNumberOfTabs'],
  ['label[for="thumbnailCacheSize"]', 'optionsStatisticsThumbnailCacheSize'],
  ['#saveBackupButton', 'optionsBackupExportButton'],
];

// [selector of every element to translate, message name]
const BUTTON_TEXTS: readonly (readonly [string, string])[] = [
  [
    '#optionKeyboardShortcuts .updateShortcut',
    'optionKeyboardShortcutsButtonsUpdate',
  ],
  [
    '#optionKeyboardShortcuts .resetShortcut',
    'optionKeyboardShortcutsButtonsReset',
  ],
  [
    '#optionKeyboardShortcuts .disableShortcut',
    'optionKeyboardShortcutsButtonsDisable',
  ],
  [
    '#optionKeyboardShortcuts .enableShortcut',
    'optionKeyboardShortcutsButtonsEnable',
  ],
];

export default function addTranslations(i18n: I18n): void {
  TEXTS.forEach(([selector, messageName]) => {
    requireElement(Element, selector).textContent =
      i18n.getMessage(messageName);
  });

  const link = requireElement(HTMLAnchorElement, '#optionKeyboardShortcuts a');
  link.href = i18n.getMessage('optionKeyboardShortcutsHelpLink');
  link.textContent = i18n.getMessage('optionKeyboardShortcutsHelpLinkText');

  BUTTON_TEXTS.forEach(([selector, messageName]) => {
    const text = i18n.getMessage(messageName);
    document.querySelectorAll(selector).forEach((button) => {
      button.textContent = text;
    });
  });
}
