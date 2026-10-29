import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { probeExtension } from '../support/probe-extension.js';
import { TARGET_LOCALES } from '../support/target-locales.js';
import { CHROMIUM_LANGUAGES, folderFor } from '../support/ui-languages.js';

// Which folder of `_locales` Chromium takes for the language it is set to. A folder that no language
// takes is not an error: the extension starts, and shows English (`el_GR` and `fr_FR` did that to
// every Greek and French user of this add-on until they were renamed). docs/languages.md has what
// was found, and what it means for the languages that are to be added.

/** The folder of the extension that Chromium takes when it is set to the language, or `default` */
async function folderTaken(
  extension: string,
  language: string,
): Promise<string> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-profile-'));
  try {
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: chromium.executablePath(),
      headless: true,
      env: { ...process.env, LANGUAGE: language },
      args: [
        `--lang=${language}`,
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
    try {
      const [existing] = context.serviceWorkers();
      const worker =
        existing ??
        (await context.waitForEvent('serviceworker', { timeout: 15000 }));
      return await worker.evaluate(() => browser.i18n.getMessage('probe'));
    } finally {
      await context.close();
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

/** Ask Chromium, set to each language, which folder of an extension that has these folders it takes; the extension is removed after */
async function askedWith<T>(
  folders: readonly string[],
  ask: (extension: string) => Promise<T>,
): Promise<T> {
  const extension = probeExtension(folders, 'chromium');
  try {
    return await ask(extension);
  } finally {
    fs.rmSync(extension, { recursive: true, force: true });
  }
}

/** The languages Chromium can be set to, from the translations of its own interface (`locales/*.pak`) */
function chromiumLanguages(): string[] {
  const directory = path.join(
    path.dirname(chromium.executablePath()),
    'locales',
  );
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.pak') && !file.includes('_'))
    .map((file) => file.replace('.pak', ''))
    .sort();
}

test.describe('Folders of translations that Chromium takes', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Firefox is not asked here: see docs/languages.md',
  );
  test.setTimeout(10 * 60 * 1000);

  test('knows the languages that tests/support/ui-languages.ts lists', () => {
    expect(chromiumLanguages()).toEqual([...CHROMIUM_LANGUAGES]);
  });

  test('takes, for each language it can be set to, the folder named like it, else the one named like the language alone', async () => {
    const folders = TARGET_LOCALES;
    const taken = await askedWith(folders, (extension) =>
      CHROMIUM_LANGUAGES.reduce(
        async (previous, language) => ({
          ...(await previous),
          [language]: await folderTaken(extension, language),
        }),
        Promise.resolve<Record<string, string>>({}),
      ),
    );

    expect(taken).toEqual(
      Object.fromEntries(
        CHROMIUM_LANGUAGES.map((language) => [
          language,
          folderFor(language, folders) ?? 'default',
        ]),
      ),
    );
  });

  test('takes a folder named for the language alone for a region of it, and nothing for a region whose folder is another', async () => {
    const cases: [folders: string[], language: string, taken: string][] = [
      [['pt'], 'pt-BR', 'pt'],
      [['pt'], 'pt-PT', 'pt'],
      [['es'], 'es-419', 'es'],
      [['zh'], 'zh-CN', 'zh'],
      [['zh_CN'], 'zh-TW', 'default'],
      [['en_GB'], 'en-US', 'default'],
      // Norwegian is `nb` to Chromium: a folder `no` is taken by no language
      [['nb'], 'nb', 'nb'],
      [['no'], 'nb', 'default'],
    ];
    const taken = await cases.reduce(async (previous, [folders, language]) => {
      const found = await previous;
      const folder = await askedWith(folders, (extension) =>
        folderTaken(extension, language),
      );
      return [...found, folder];
    }, Promise.resolve<string[]>([]));

    expect(taken).toEqual(cases.map(([, , expected]) => expected));
  });
});
