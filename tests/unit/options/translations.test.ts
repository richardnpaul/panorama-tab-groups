// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import addTranslations from '../../../src/js/options/translations.js';

const getMessage = vi.fn((messageName: string) => `msg:${messageName}`);

// The real options page, so the selectors are checked against the real markup
const optionsPage = readFileSync('src/options.html', 'utf8');
const pageBody = /<body[^>]*>([\s\S]*)<\/body>/.exec(optionsPage)?.[1] ?? '';

const textOf = (selector: string) =>
  document.querySelector(selector)?.textContent;

// What each element must say: [selector, message name]. This is the contract
// with the page and the locale files, so it is written out in full.
const expectedTexts: readonly (readonly [string, string])[] = [
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

const expectedButtonTexts: readonly (readonly [string, string])[] = [
  ['updateShortcut', 'optionKeyboardShortcutsButtonsUpdate'],
  ['resetShortcut', 'optionKeyboardShortcutsButtonsReset'],
  ['disableShortcut', 'optionKeyboardShortcutsButtonsDisable'],
  ['enableShortcut', 'optionKeyboardShortcutsButtonsEnable'],
];

describe('options/translations.ts', () => {
  beforeEach(() => {
    getMessage.mockClear();
    Object.assign(globalThis, { browser: { i18n: { getMessage } } });
    document.body.innerHTML = pageBody;
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'browser');
    document.body.innerHTML = '';
  });

  it('finds the options page markup the test relies on', () => {
    expect(pageBody).toContain('id="optionKeyboardShortcuts"');
  });

  it.each(expectedTexts)('translates %s with %s', (selector, messageName) => {
    addTranslations();

    expect(textOf(selector)).toBe(`msg:${messageName}`);
  });

  it.each(expectedButtonTexts)(
    'translates every .%s button with %s',
    (className, messageName) => {
      addTranslations();

      const buttons = document.querySelectorAll(
        `#optionKeyboardShortcuts .${className}`,
      );
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((button) => {
        expect(button.textContent).toBe(`msg:${messageName}`);
      });
    },
  );

  it('sets the help link address and text', () => {
    addTranslations();

    const link = document.querySelector<HTMLAnchorElement>(
      '#optionKeyboardShortcuts a',
    );
    expect(link?.getAttribute('href')).toBe(
      'msg:optionKeyboardShortcutsHelpLink',
    );
    expect(link?.textContent).toBe('msg:optionKeyboardShortcutsHelpLinkText');
  });

  it('asks for exactly the messages it displays', () => {
    addTranslations();

    const asked = getMessage.mock.calls.map(([name]) => name).sort();
    const expected = [
      ...expectedTexts.map(([, name]) => name),
      ...expectedButtonTexts.map(([, name]) => name),
      'optionKeyboardShortcutsHelpLink',
      'optionKeyboardShortcutsHelpLinkText',
    ].sort();
    expect(asked).toEqual(expected);
  });

  it('fails naming the selector when the page lacks an element', () => {
    document.body.innerHTML = '';

    expect(() => {
      addTranslations();
    }).toThrow('Element not found: #optionKeyboardShortcuts h2');
  });

  it('fails when the help link is missing', () => {
    document.querySelectorAll('#optionKeyboardShortcuts a').forEach((link) => {
      link.remove();
    });

    expect(() => {
      addTranslations();
    }).toThrow('Element not found: #optionKeyboardShortcuts a');
  });

  it('does not fail when the page has no shortcut buttons', () => {
    document
      .querySelectorAll('#optionKeyboardShortcuts button')
      .forEach((button) => {
        button.remove();
      });

    expect(() => {
      addTranslations();
    }).not.toThrow();
  });
});
