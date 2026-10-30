import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { localeFolders } from '../support/locales.js';
import {
  DRAFT_LOCALES,
  REGIONAL_ENGLISH,
  TARGET_LOCALES,
} from '../support/target-locales.js';
import {
  CHROMIUM_LANGUAGES,
  FIREFOX_LANGUAGES,
  folderFor,
  reachableFolders,
} from '../support/ui-languages.js';

// docs/plans/languages.md says which languages the extension is to have and which languages of a browser take
// each. The table of that document is checked here against the code, so that it is kept true.

/** The folders of the aim that no language of Chromium 156 or Firefox 159 takes: docs/plans/languages.md says so; all but `en_AU` are Batch C */
const UNTAKEN: string[] = [
  'ak',
  'bm',
  'ckb',
  'de_CH',
  'en_AU',
  'ha',
  'ig',
  'lb',
  'lg',
  'ln',
  'lo',
  'mg',
  'mn',
  'mt',
  'no',
  'nso',
  'ny',
  'om',
  'ps',
  'qu',
  'rn',
  'rw',
  'sn',
  'so',
  'st',
  'ti',
  'tn',
  'wo',
  'yo',
  'zgh',
  'zh_HK',
  'zu',
];

interface Row {
  folder: string;
  chromium: string[];
  firefox: string[];
  status: string;
}

/** The rows of the table of languages: a folder in code marks, the two browsers' languages, and the status */
function tableRows(): Row[] {
  const lines = readFileSync('docs/plans/languages.md', 'utf8').split('\n');
  const cells = (line: string): string[] =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
  const languages = (cell: string | undefined): string[] =>
    cell === undefined || cell === '–'
      ? []
      : cell.split(',').map((language) => language.trim());
  return lines
    .filter((line) => /^\| `[A-Za-z0-9_]+`\s*\|/u.test(line))
    .map((line) => {
      const [folder = '', , , , chromium, firefox, status = ''] = cells(line);
      return {
        folder: folder.replaceAll('`', ''),
        chromium: languages(chromium),
        firefox: languages(firefox),
        status,
      };
    });
}

describe('folderFor', () => {
  it('takes the folder named like the language, with `_` for `-`', () => {
    expect(folderFor('pt-BR', ['pt', 'pt_BR'])).toBe('pt_BR');
  });

  it('takes the folder of the language alone when there is none for the region', () => {
    expect(folderFor('pt-PT', ['pt', 'pt_BR'])).toBe('pt');
  });

  it('takes the folder of a language that has no region', () => {
    expect(folderFor('de', ['de', 'de_CH'])).toBe('de');
  });

  it('takes none when the folders are those of other languages', () => {
    expect(folderFor('zh-TW', ['zh_CN'])).toBeUndefined();
    expect(folderFor('nb', ['no'])).toBeUndefined();
  });

  it('takes a folder of another region of the language only where that is asked for (Firefox)', () => {
    expect(folderFor('es-MX', ['es_419'])).toBeUndefined();
    expect(folderFor('es-MX', ['es_419'], true)).toBe('es_419');
    expect(folderFor('de', ['de_CH'], true)).toBe('de_CH');
  });

  it('prefers the language alone to another region, also where that is asked for', () => {
    expect(folderFor('es-MX', ['es_419', 'es'], true)).toBe('es');
    expect(folderFor('pt-PT', ['pt_BR', 'pt_PT'], true)).toBe('pt_PT');
  });

  it('takes no folder of another language, also where any region is asked for', () => {
    expect(folderFor('nb', ['no'], true)).toBeUndefined();
  });
});

describe('reachableFolders', () => {
  it('keeps the folders that a language takes, in the order given', () => {
    expect(
      reachableFolders(['pt-BR', 'de'], ['de', 'de_CH', 'pt', 'pt_BR']),
    ).toEqual(['de', 'pt_BR']);
  });

  it('keeps the folder of another region where that is asked for', () => {
    expect(reachableFolders(['de'], ['de_CH'], true)).toEqual(['de_CH']);
    expect(reachableFolders(['de'], ['de_CH'])).toEqual([]);
  });

  it('has none for no language', () => {
    expect(reachableFolders([], ['de'])).toEqual([]);
  });
});

describe('the languages that are the aim (docs/plans/languages.md)', () => {
  it('has each folder once, written like the folder of a language', () => {
    expect(new Set(TARGET_LOCALES).size).toBe(TARGET_LOCALES.length);
    TARGET_LOCALES.forEach((folder) => {
      expect(folder).toMatch(/^[a-z]{2,3}(_[A-Za-z0-9]{2,3})?$/u);
    });
  });

  it('does not have Russian, which is left out (docs/plans/languages.md)', () => {
    expect(TARGET_LOCALES).not.toContain('ru');
    expect(existsSync('src/_locales/ru')).toBe(false);
  });

  it('has the languages of Firefox that Lazarus lacks: Tagalog and Nynorsk', () => {
    expect(TARGET_LOCALES).toEqual(expect.arrayContaining(['tl', 'nn']));
  });

  it('names as regional English and as drafts only folders of the aim', () => {
    expect(
      [...REGIONAL_ENGLISH, ...DRAFT_LOCALES].filter(
        (folder) => !TARGET_LOCALES.includes(folder),
      ),
    ).toEqual([]);
  });

  it('has a folder for every draft, and none for a regional English', () => {
    expect(
      DRAFT_LOCALES.filter((folder) => !existsSync(`src/_locales/${folder}`)),
    ).toEqual([]);
    expect(
      REGIONAL_ENGLISH.filter((folder) => existsSync(`src/_locales/${folder}`)),
    ).toEqual([]);
  });

  it('has English as the default', () => {
    expect(TARGET_LOCALES).toContain('en');
  });

  it('has every language the extension is translated into', () => {
    const present = localeFolders();
    expect(TARGET_LOCALES.filter((folder) => present.includes(folder))).toEqual(
      present,
    );
  });

  it('has the folders of the table, each once', () => {
    expect(
      tableRows()
        .map(({ folder }) => folder)
        .sort(),
    ).toEqual([...TARGET_LOCALES].sort());
  });

  it('says of each folder whether it exists, and which language of a browser takes it', () => {
    const taking = (
      languages: readonly string[],
      folder: string,
      anyRegion: boolean,
    ): string[] =>
      languages.filter(
        (language) => folderFor(language, TARGET_LOCALES, anyRegion) === folder,
      );

    tableRows().forEach(({ folder, chromium, firefox, status }) => {
      expect(chromium, `${folder}: Chromium`).toEqual(
        taking(CHROMIUM_LANGUAGES, folder, false),
      );
      expect(firefox, `${folder}: Firefox`).toEqual(
        taking(FIREFOX_LANGUAGES, folder, true),
      );
      const expected = ((): string => {
        if (REGIONAL_ENGLISH.includes(folder)) {
          return 'inherits `en`';
        }
        if (!existsSync(`src/_locales/${folder}`)) {
          return 'planned';
        }
        if (folder === 'en') {
          return 'default';
        }
        return DRAFT_LOCALES.includes(folder) ? 'draft' : 'present';
      })();
      expect(status, `${folder}: status`).toBe(expected);
    });
  });

  it('counts the folders that no language of Chromium or Firefox takes, as the document says', () => {
    const translations = TARGET_LOCALES.filter((folder) => folder !== 'en');
    const taken = new Set([
      ...reachableFolders(CHROMIUM_LANGUAGES, TARGET_LOCALES),
      ...reachableFolders(FIREFOX_LANGUAGES, TARGET_LOCALES, true),
    ]);
    const untaken = translations.filter((folder) => !taken.has(folder));

    expect(untaken).toEqual(UNTAKEN);
  });
});
