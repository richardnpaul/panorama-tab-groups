import { describe, expect, it } from 'vitest';
import { applyLanguage } from '../../../src/js/share/direction.js';

/** The browser answers these names for itself; anything else is a message of the extension */
const browserIn = (answers: Record<string, string>) => ({
  getMessage: (name: string) => answers[name] ?? '',
});

const rootOf = () => ({ dir: '', lang: 'unset' });

describe('share/direction.ts', () => {
  describe('applyLanguage', () => {
    it.each([
      ['rtl', 'rtl'],
      ['ltr', 'ltr'],
      ['', 'ltr'],
      ['upside-down', 'ltr'],
    ])('sets the direction %j as %s', (bidi, dir) => {
      const root = rootOf();

      applyLanguage(browserIn({ '@@bidi_dir': bidi }), root);

      expect(root.dir).toBe(dir);
    });

    it.each([
      ['de', 'de'],
      ['pt_BR', 'pt-BR'],
      ['zh_TW', 'zh-TW'],
      ['ar', 'ar'],
      ['fil', 'fil'],
      ['es_419', 'es-419'],
    ])('sets the language of the browser, %s, as %s', (locale, lang) => {
      const root = rootOf();

      applyLanguage(browserIn({ '@@ui_locale': locale }), root);

      expect(root.lang).toBe(lang);
    });

    it.each([[''], ['@@ui_locale'], ['x'], ['en_'], ['1234']])(
      'leaves the language alone when the browser gives %j',
      (locale) => {
        const root = rootOf();

        applyLanguage(browserIn({ '@@ui_locale': locale }), root);

        expect(root.lang).toBe('unset');
      },
    );

    it('sets both', () => {
      const root = rootOf();

      applyLanguage(
        browserIn({ '@@bidi_dir': 'rtl', '@@ui_locale': 'he' }),
        root,
      );

      expect(root).toEqual({ dir: 'rtl', lang: 'he' });
    });
  });
});
