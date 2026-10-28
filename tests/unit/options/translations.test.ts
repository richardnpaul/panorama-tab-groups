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
  ['label[for="themeAuto"] span', 'optionsThemeAuto'],
  ['label[for="themeLight"] span', 'optionsThemeLight'],
  ['label[for="themeDark"] span', 'optionsThemeDark'],
  ['#optionsToolbar h3', 'optionsToolbar'],
  ['#optionsToolbar h4', 'optionsToolbarPosition'],
  ['label[for="toolbarPositionTop"] span', 'optionsToolbarPositionTop'],
  ['label[for="toolbarPositionRight"] span', 'optionsToolbarPositionRight'],
  ['label[for="toolbarPositionBottom"] span', 'optionsToolbarPositionBottom'],
  ['label[for="toolbarPositionLeft"] span', 'optionsToolbarPositionLeft'],
  ['#optionsNativeGroups h2', 'optionsNativeGroups'],
  ['#optionsNativeGroups label span', 'optionsNativeGroupsUse'],
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
    getMessage.mockReset().mockImplementation((name) => `msg:${name}`);
    document.body.innerHTML = pageBody;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the options page markup the test relies on', () => {
    expect(pageBody).toContain('id="optionKeyboardShortcuts"');
  });

  it.each(expectedTexts)('translates %s with %s', (selector, messageName) => {
    addTranslations({ getMessage });

    expect(textOf(selector)).toBe(`msg:${messageName}`);
  });

  it.each(expectedButtonTexts)(
    'translates every .%s button with %s',
    (className, messageName) => {
      addTranslations({ getMessage });

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
    addTranslations({ getMessage });

    const link = document.querySelector<HTMLAnchorElement>(
      '#optionKeyboardShortcuts a',
    );
    expect(link?.getAttribute('href')).toBe(
      'msg:optionKeyboardShortcutsHelpLink',
    );
    expect(link?.textContent).toBe('msg:optionKeyboardShortcutsHelpLinkText');
  });

  describe('the sentence with a link in it', () => {
    const sentence = () => document.getElementById('shortcutsManage');
    const link = () =>
      document.querySelector<HTMLAnchorElement>('#shortcutsManageLink');

    const say = (manage: string) => {
      getMessage.mockImplementation((name) =>
        name === 'optionKeyboardShortcutsManage' ? manage : `msg:${name}`,
      );
    };

    it('puts the link where the message has {link}', () => {
      say('Look at {link} for more.');

      addTranslations({ getMessage });

      expect(sentence()?.textContent).toBe(
        'Look at msg:optionKeyboardShortcutsManageLinkText for more.',
      );
      expect(sentence()?.childNodes).toHaveLength(3);
      expect(link()?.textContent).toBe(
        'msg:optionKeyboardShortcutsManageLinkText',
      );
    });

    it('puts the link first where the language puts it first', () => {
      say('{link} shows how.');

      addTranslations({ getMessage });

      expect(sentence()?.firstChild?.textContent).toBe('');
      expect(sentence()?.childNodes[1]).toBe(link());
      expect(sentence()?.lastChild?.textContent).toBe(' shows how.');
    });

    it('keeps the address of the link', () => {
      say('See {link}.');
      const address = link()?.getAttribute('href');

      addTranslations({ getMessage });

      expect(address).toContain('developer.mozilla.org');
      expect(link()?.getAttribute('href')).toBe(address);
    });

    it('puts the link after the text where the message has no place for it', () => {
      say('A message without a place.');

      addTranslations({ getMessage });

      expect(sentence()?.childNodes[0]?.textContent).toBe(
        'A message without a place.',
      );
      expect(sentence()?.childNodes[1]).toBe(link());
      expect(sentence()?.childNodes[2]?.textContent).toBe('');
    });

    it('does not read markup in the message as markup', () => {
      say('<img src=x onerror=alert(1)> {link}');

      addTranslations({ getMessage });

      expect(sentence()?.querySelector('img')).toBeNull();
      expect(sentence()?.textContent).toContain('<img src=x');
    });

    it('fails naming the link when the page lacks it', () => {
      link()?.remove();

      expect(() => {
        addTranslations({ getMessage });
      }).toThrow('Element not found: #shortcutsManageLink');
    });
  });

  it('asks for exactly the messages it displays', () => {
    addTranslations({ getMessage });

    const asked = getMessage.mock.calls.map(([name]) => name).sort();
    const expected = [
      ...expectedTexts.map(([, name]) => name),
      ...expectedButtonTexts.map(([, name]) => name),
      'optionKeyboardShortcutsHelpLink',
      'optionKeyboardShortcutsHelpLinkText',
      'optionKeyboardShortcutsManage',
      'optionKeyboardShortcutsManageLinkText',
    ].sort();
    expect(asked).toEqual(expected);
  });

  it('fails naming the selector when the page lacks an element', () => {
    document.body.innerHTML = '';

    expect(() => {
      addTranslations({ getMessage });
    }).toThrow('Element not found: #optionKeyboardShortcuts h2');
  });

  it('fails when the help link is missing', () => {
    document.querySelectorAll('#optionKeyboardShortcuts a').forEach((link) => {
      link.remove();
    });

    expect(() => {
      addTranslations({ getMessage });
    }).toThrow('Element not found: #optionKeyboardShortcuts a');
  });

  it('does not fail when the page has no shortcut buttons', () => {
    document
      .querySelectorAll('#optionKeyboardShortcuts button')
      .forEach((button) => {
        button.remove();
      });

    expect(() => {
      addTranslations({ getMessage });
    }).not.toThrow();
  });
});
