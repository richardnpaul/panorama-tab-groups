import { isRecord, isString } from '../../src/js/share/guards.js';

/** The message text of each name in one folder of translations */
export type Locale = Record<string, string>;

/** Read the text of a `messages.json`, or fail with what is wrong with it */
export function parseLocale(folder: string, text: string): Locale {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || Array.isArray(data)) {
    throw new Error(`${folder}: messages.json is not an object`);
  }
  return Object.fromEntries(
    Object.entries(data).map(([name, entry]) => {
      if (!isRecord(entry) || !isString(entry.message)) {
        throw new Error(`${folder}: ${name} has no message text`);
      }
      return [name, entry.message];
    }),
  );
}

/** How much of English a language has translated */
export interface Completeness {
  folder: string;
  translated: number;
  missing: number;
}

export function completenessOf(
  english: Locale,
  locales: Readonly<Record<string, Locale>>,
): Completeness[] {
  const names = Object.keys(english);
  return Object.entries(locales)
    .map(([folder, own]) => {
      const missing = names.filter((name) => !(name in own)).length;
      return { folder, translated: names.length - missing, missing };
    })
    .sort(
      (first, second) =>
        first.missing - second.missing ||
        first.folder.localeCompare(second.folder),
    );
}

/** A table for the summary of a run: each language, from the most complete, with what is missing */
export function localeReport(
  english: Locale,
  locales: Readonly<Record<string, Locale>>,
): string {
  const total = Object.keys(english).length;
  const rows = completenessOf(english, locales).map(
    ({ folder, translated, missing }) =>
      `| ${folder} | ${String(translated)} | ${String(missing)} | ${String(Math.floor((translated / total) * 100))}% |`,
  );
  return [
    '## Translations',
    '',
    `English has ${String(total)} messages. A message a language lacks is shown in English.`,
    '',
    '| Locale | Translated | Missing | Complete |',
    '| ------ | ---------- | ------- | -------- |',
    ...rows,
    '',
  ].join('\n');
}
