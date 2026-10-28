import { readFileSync, readdirSync } from 'node:fs';
import { localeReport, parseLocale } from './lib/locale-report.js';

const DIRECTORY = 'src/_locales';

const read = (folder: string) =>
  parseLocale(
    folder,
    readFileSync(`${DIRECTORY}/${folder}/messages.json`, 'utf8'),
  );

const translations = readdirSync(DIRECTORY).filter((folder) => folder !== 'en');

console.log(
  localeReport(
    read('en'),
    Object.fromEntries(translations.map((folder) => [folder, read(folder)])),
  ),
);
