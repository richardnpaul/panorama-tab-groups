import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pluralCategory, pluralForms } from '../../src/js/core/plural.js';
import { isRecord, isNumber, isString } from '../../src/js/share/guards.js';
import { localeFolders, readLocale } from '../support/locales.js';

const folders = localeFolders();
const translations = folders.filter((folder) => folder !== 'en');
const english = readLocale('en');

/** The files of the extension that can name a message, other than the messages themselves */
function sourceTexts(directory = 'src'): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === '_locales' ? [] : sourceTexts(path);
    }
    return /\.(ts|html|json)$/u.test(entry.name)
      ? [readFileSync(path, 'utf8')]
      : [];
  });
}

/** What the code puts into a message, once each: `$1`, and `{link}` for where a link goes; a form may repeat one or leave it out */
const placeholdersOf = (message: string): string[] =>
  [...new Set(message.match(/\$[A-Z0-9_]+\$?|\{[a-z]+\}/gu) ?? [])].sort();

/** The number of messages of English that a folder does not have, which fall back to English */
const missingFrom = (folder: string): number => {
  const own = readLocale(folder);
  return Object.keys(english).filter((name) => !(name in own)).length;
};

/**
 * What each folder may lack. It can only get smaller: the test fails when a
 * folder lacks more, and also when it lacks fewer than written here, so the
 * number is lowered with the work (and a language that is complete says 0).
 */
const allowedGaps: unknown = JSON.parse(
  readFileSync('tests/unit/locale-gaps.json', 'utf8'),
);

describe('locales', () => {
  it('has English, which the manifest names as the default', () => {
    const manifest: unknown = JSON.parse(
      readFileSync('src/manifest.json', 'utf8'),
    );

    expect(isRecord(manifest) && manifest.default_locale).toBe('en');
    expect(folders).toContain('en');
  });

  it.each(folders)(
    '%s is named as a language, or a language and a region',
    (folder) => {
      // Whether a browser loads the folder is tested in a real one, in locales.spec.ts: a
      // folder with a region it does not report was never loaded, as el_GR, fr_FR and tr_TR
      expect(folder).toMatch(/^[a-z]{2,3}(_[A-Z]{2})?$/u);
    },
  );

  describe.each(folders)('%s', (folder) => {
    const own = readLocale(folder);

    it('has no message that English does not have', () => {
      expect(Object.keys(own).filter((name) => !(name in english))).toEqual([]);
    });

    it('has the placeholders of the English message in each message it has', () => {
      const different = Object.entries(own)
        .filter(
          ([name, message]) =>
            name in english &&
            placeholdersOf(message).join() !==
              placeholdersOf(english[name] ?? '').join(),
        )
        .map(([name]) => name);

      expect(different).toEqual([]);
    });

    it('keeps the place of the link in the sentence that has one', () => {
      const name = 'optionKeyboardShortcutsManage';
      if (name in own) {
        expect(own[name].split('{link}')).toHaveLength(2);
      }
    });

    it('has no message that is empty', () => {
      expect(
        Object.entries(own)
          .filter(([, message]) => message.trim() === '')
          .map(([name]) => name),
      ).toEqual([]);
    });

    it('has no markup in a message, which a page shows as the text it is', () => {
      expect(
        Object.entries(own)
          .filter(([, message]) => /<\/?[a-z]/iu.test(message))
          .map(([name]) => name),
      ).toEqual([]);
    });

    it('does not use the number of the plural rule that the messages had', () => {
      expect(own).not.toHaveProperty('pluralRule');
    });

    it('has a form for every count, in each message that has forms', () => {
      const language = folder;
      const counts = Array.from({ length: 1001 }, (_, count) => count);

      const incomplete = Object.entries(own).flatMap(([name, message]) => {
        const forms = pluralForms(message);
        if (forms === undefined) {
          return [];
        }
        const missing = new Set(
          counts
            .map((count) => pluralCategory(language, count))
            .filter((category) => !(category in forms) && !('other' in forms)),
        );
        return missing.size === 0 ? [] : [`${name}: ${[...missing].join()}`];
      });

      expect(incomplete).toEqual([]);
    });

    it('uses forms in all its parts or in none', () => {
      const mixed = Object.entries(own)
        .filter(
          ([, message]) =>
            message.includes('|') && pluralForms(message) === undefined,
        )
        .map(([name]) => name);

      // A "|" in a message that is not a list of forms is a form lost its label
      expect(mixed).toEqual([]);
    });
  });

  describe('what each language lacks', () => {
    it('is written down for every language, and for no other', () => {
      expect(isRecord(allowedGaps) && Object.keys(allowedGaps).sort()).toEqual(
        translations,
      );
    });

    it.each(translations)(
      '%s lacks as many messages as is written down: no more, and no fewer',
      (folder) => {
        const allowed = isRecord(allowedGaps) ? allowedGaps[folder] : undefined;

        expect(isNumber(allowed)).toBe(true);
        expect(missingFrom(folder)).toBe(allowed);
      },
    );
  });

  describe('the messages and the code', () => {
    const sources = sourceTexts().join('\n');

    it('has every message that the code asks for by name', () => {
      const asked = [
        ...sources.matchAll(/getMessage\(\s*['"`]([A-Za-z0-9_@]+)['"`]/gu),
      ].map(([, name]) => name);
      // The names the browser gives itself, such as @@ui_locale
      const asksForMessages = asked.filter(
        (name) => isString(name) && !name.startsWith('@@'),
      );

      expect(asksForMessages.length).toBeGreaterThan(0);
      expect(
        asksForMessages.filter((name) => !(String(name) in english)),
      ).toEqual([]);
    });

    it('has no message that nothing uses', () => {
      const unused = Object.keys(english).filter(
        (name) =>
          !new RegExp(`['"\`]${name}['"\`]|__MSG_${name}__`, 'u').test(sources),
      );

      expect(unused).toEqual([]);
    });
  });
});
