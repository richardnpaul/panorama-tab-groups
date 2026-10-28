import { readdirSync, readFileSync } from 'node:fs';
import { type Locale, parseLocale } from '../../scripts/lib/locale-report.js';

export type { Locale };

const LOCALES_DIRECTORY = 'src/_locales';

/** Read `messages.json` of a folder, or fail with what is wrong with it */
export const readLocale = (folder: string): Locale =>
  parseLocale(
    folder,
    readFileSync(`${LOCALES_DIRECTORY}/${folder}/messages.json`, 'utf8'),
  );

/** The folders of translations, English (the default) included, in order */
export const localeFolders = (): string[] =>
  readdirSync(LOCALES_DIRECTORY).sort();
