import { folderLocaleScript } from '../support/folder-locale.js';
import { localeFolders, readLocale } from '../support/locales.js';
import { TARGET_LOCALES } from '../support/target-locales.js';
import { CHROMIUM_LANGUAGES, folderFor } from '../support/ui-languages.js';
import { test, expect } from './fixtures.js';
import {
  PAGE_NAMES,
  overlappingTexts,
  pagesOfTheExtension,
  sidewaysOverflow,
} from './pages.js';

const english = readLocale('en');

/** The languages written from the right, which the browser says of the language it is set to */
const RIGHT_TO_LEFT = ['ar', 'ckb', 'fa', 'he', 'ps', 'ur'];

const runsFromTheRight = (folder: string): boolean =>
  RIGHT_TO_LEFT.includes(folder.split('_')[0] ?? folder);

/** The folders of translations, which are named like the language of the browser they are for */
const folders = localeFolders().filter((folder) => folder !== 'en');

/**
 * A message the folder has translated, to tell its text from English. One that has
 * no placeholder is used, so that the text can be compared as it is.
 */
function distinguishingMessage(folder: string): [string, string] {
  const found = Object.entries(readLocale(folder)).find(
    ([name, text]) =>
      name !== 'pluralRule' && !text.includes('$') && text !== english[name],
  );
  if (found === undefined) {
    throw new Error(`${folder} has no message that differs from English`);
  }
  return found;
}

// Pages of Firefox are served with a stand-in for the browser API in these tests, so
// the choice of folder is only tested where the extension is loaded as the browser loads it
test.describe('Folders of translations in Chromium', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Firefox pages are served with a stand-in for the browser API',
  );

  // Chromium can be set to 55 languages; the pages in the others are shown in Chromium with the messages of the folder
  // put in by the test, and which folder Firefox takes is asked of Firefox (firefox-locale-folders.spec.ts)
  const chromiumTakes = (folder: string): boolean =>
    CHROMIUM_LANGUAGES.some(
      (language) => folderFor(language, TARGET_LOCALES) === folder,
    );

  folders
    .filter((folder) => !chromiumTakes(folder))
    .forEach((folder) => {
      test(`${folder}: shows every page with the messages of the folder, and keeps a picture of each`, async ({
        page,
        extensionId,
        extensionProtocol,
      }, testInfo) => {
        await page.addInitScript({
          content: folderLocaleScript({
            folder,
            messages: readLocale(folder),
            rtl: runsFromTheRight(folder),
          }),
        });
        const url = (path: string) =>
          `${extensionProtocol}://${extensionId}/${path}`;

        await PAGE_NAMES.reduce(async (previous, name) => {
          await previous;
          await pagesOfTheExtension[name](page, url);

          const language = folder.split('_')[0] ?? folder;
          await expect(page.locator('html')).toHaveAttribute(
            'lang',
            new RegExp(`^${language}`, 'u'),
          );
          await expect(page.locator('html')).toHaveAttribute(
            'dir',
            runsFromTheRight(folder) ? 'rtl' : 'ltr',
          );
          if (name !== 'popup') {
            expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
          }
          expect(await overlappingTexts(page)).toEqual([]);

          const picture = testInfo.outputPath(`${folder}-${name}.png`);
          await page.screenshot({ path: picture, fullPage: true });
          await testInfo.attach(`${folder}-${name}`, {
            path: picture,
            contentType: 'image/png',
          });
        }, Promise.resolve());
      });
    });

  folders.filter(chromiumTakes).forEach((folder) => {
    test.describe(folder, () => {
      // pt_BR is the language tag pt-BR, and a folder with only a language is that language
      test.use({ uiLanguage: folder.replace('_', '-') });

      test('is loaded when the browser is set to that language', async ({
        page,
        extensionId,
        extensionProtocol,
      }) => {
        const [name, text] = distinguishingMessage(folder);
        await page.goto(`${extensionProtocol}://${extensionId}/options.html`);

        expect(
          await page.evaluate(
            (messageName) => browser.i18n.getMessage(messageName),
            name,
          ),
        ).toBe(text);
      });

      // Kept as pictures, so that a reviewer can look at a language without speaking it
      test('shows every page in that language, and keeps a picture of each', async ({
        page,
        extensionId,
        extensionProtocol,
      }, testInfo) => {
        const url = (path: string) =>
          `${extensionProtocol}://${extensionId}/${path}`;

        await PAGE_NAMES.reduce(async (previous, name) => {
          await previous;
          await pagesOfTheExtension[name](page, url);

          // The page is told the language of the browser, and the way text runs in it
          const language = folder.split('_')[0] ?? folder;
          await expect(page.locator('html')).toHaveAttribute(
            'lang',
            new RegExp(`^${language}`, 'u'),
          );
          await expect(page.locator('html')).toHaveAttribute(
            'dir',
            runsFromTheRight(folder) ? 'rtl' : 'ltr',
          );
          // The popup is two frames side by side, so it is wider than the window by design
          if (name !== 'popup') {
            expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
          }
          expect(await overlappingTexts(page)).toEqual([]);

          const picture = testInfo.outputPath(`${folder}-${name}.png`);
          await page.screenshot({ path: picture, fullPage: true });
          await testInfo.attach(`${folder}-${name}`, {
            path: picture,
            contentType: 'image/png',
          });
        }, Promise.resolve());
      });
    });
  });
});
