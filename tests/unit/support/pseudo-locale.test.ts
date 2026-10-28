import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  install,
  pseudoLocalize,
  pseudoLocaleScript,
} from '../../support/pseudo-locale.js';

describe('tests/support/pseudo-locale.ts', () => {
  describe('pseudoLocalize', () => {
    it('puts the text in brackets, accented', () => {
      expect(pseudoLocalize('Close tab')).toMatch(/^\[Çlöšé táb .*\]$/u);
    });

    it('makes the text about 40% longer', () => {
      const text = 'a'.repeat(50);

      const result = pseudoLocalize(text);

      // The brackets and the space are not part of the text
      expect(result.length - 3).toBeGreaterThanOrEqual(text.length * 1.4);
      expect(result.length - 3).toBeLessThanOrEqual(text.length * 1.4 + 1);
    });

    it('leaves a placeholder and a name in braces as they are', () => {
      expect(pseudoLocalize('Close $1 tabs {link} now')).toContain('$1');
      expect(pseudoLocalize('Close $1 tabs {link} now')).toContain('{link}');
      expect(pseudoLocalize('Close $1 tabs {link} now')).not.toContain(
        '{lín k}',
      );
    });

    it('keeps what is not a letter', () => {
      expect(pseudoLocalize('1:2 - 3!')).toContain('1:2 - 3!');
    });

    it('answers for an empty text', () => {
      expect(pseudoLocalize('')).toBe('[ ]');
    });
  });

  describe('pseudoLocaleScript', () => {
    it('is a script that defines the function the page calls and installs it', () => {
      const script = pseudoLocaleScript({ rtl: true });

      expect(script).toContain(
        'const pseudoLocalizeInPage = function pseudoLocalize',
      );
      expect(script).toContain('{"rtl":true}');
    });
  });

  describe('install', () => {
    /** The page, as the script finds it: the browser's i18n and the function the script defined */
    const inPage = (options: { rtl: boolean }) => {
      const asked: string[] = [];
      const chrome = {
        i18n: {
          getMessage: (name: string) => {
            asked.push(name);
            return 'Hello';
          },
        },
      };
      vi.stubGlobal('chrome', chrome);
      vi.stubGlobal('pseudoLocalizeInPage', pseudoLocalize);
      install(options);
      return { chrome, asked };
    };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('gives the messages of the browser as the pseudo-locale', () => {
      const { chrome, asked } = inPage({ rtl: true });

      expect(chrome.i18n.getMessage('x')).toMatch(/^\[Hé/u);
      expect(asked).toEqual(['x']);
    });

    it('says the language is Arabic, which runs from the right, when it should', () => {
      const { chrome, asked } = inPage({ rtl: true });

      expect(chrome.i18n.getMessage('@@bidi_dir')).toBe('rtl');
      expect(chrome.i18n.getMessage('@@ui_locale')).toBe('ar');
      expect(asked).toEqual([]);
    });

    it('says the language is English, which runs from the left, when it should', () => {
      const { chrome } = inPage({ rtl: false });

      expect(chrome.i18n.getMessage('@@bidi_dir')).toBe('ltr');
      expect(chrome.i18n.getMessage('@@ui_locale')).toBe('en');
    });
  });
});
