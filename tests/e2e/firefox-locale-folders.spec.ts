import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { expect, firefox, test } from '@playwright/test';
import { langpackFor } from '../support/firefox-langpacks.js';
import { probeExtension } from '../support/probe-extension.js';
import { localeFolders } from '../support/locales.js';
import { TARGET_LOCALES } from '../support/target-locales.js';
import { FIREFOX_LANGUAGES, folderFor } from '../support/ui-languages.js';

// Which folder of `_locales` Firefox takes for the language it is set to, as tests/e2e/chromium-locale-folders.spec.ts
// asks Chromium. Firefox is set to a language by its language pack, so the packs of the languages
// asked about are downloaded (once, for the version of Firefox that Playwright runs).

interface Answer {
  folder: string;
  ui: string;
}

/** A local server that tells what the extension reports to it; what it says is waited for for 30 seconds */
async function listening(): Promise<{
  address: string;
  reported: () => Promise<Answer>;
  close: () => void;
}> {
  let answer: (value: Answer) => void = () => undefined;
  const reported = new Promise<Answer>((resolve) => {
    answer = resolve;
  });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.writeHead(200);
    response.end('ok');
    answer({
      folder: url.searchParams.get('folder') ?? '',
      ui: url.searchParams.get('ui') ?? '',
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const found = server.address();
  const port = typeof found === 'object' && found !== null ? found.port : 0;
  let timer: NodeJS.Timeout | undefined;
  return {
    address: `http://127.0.0.1:${String(port)}/`,
    reported: async () => {
      try {
        return await Promise.race([
          reported,
          new Promise<Answer>((resolve) => {
            timer = setTimeout(() => {
              resolve({ folder: 'nothing reported', ui: '' });
            }, 30000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    close: () => {
      server.close();
    },
  };
}

/** Firefox set to the language, with the extension; what the extension reported: the folder, and the language of the browser */
async function answerOf(
  folders: readonly string[],
  language: string,
): Promise<Answer> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-profile-'));
  try {
    fs.mkdirSync(path.join(profile, 'extensions'));
    fs.copyFileSync(
      await langpackFor(language),
      path.join(
        profile,
        'extensions',
        `langpack-${language}@firefox.mozilla.org.xpi`,
      ),
    );

    const server = await listening();
    const extension = probeExtension(folders, 'firefox', server.address);
    try {
      const { connectWithMaxRetries, findFreeTcpPort } =
        await import('playwright-webextext/dist/firefox_remote.js');
      const rdpPort = await findFreeTcpPort();
      const context = await firefox.launchPersistentContext(profile, {
        headless: true,
        env: { ...process.env, MOZ_HEADLESS: '1' },
        args: [
          '--start-debugger-server',
          String(rdpPort),
          '--disable-default-apps',
        ],
        firefoxUserPrefs: {
          'devtools.debugger.remote-enabled': true,
          'devtools.debugger.prompt-connection': false,
          'extensions.manifestV3.enabled': true,
          'xpinstall.signatures.required': false,
          'extensions.autoDisableScopes': 0,
          'extensions.enabledScopes': 15,
          'intl.locale.requested': language,
        },
      });
      try {
        const client = await connectWithMaxRetries({ port: rdpPort });
        await client.installTemporaryAddon(extension);
        client.disconnect();
        return await server.reported();
      } finally {
        await context.close();
      }
    } finally {
      server.close();
      fs.rmSync(extension, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

test.describe('Folders of translations that Firefox takes', () => {
  test.skip(
    ({ browserName }) => browserName !== 'firefox',
    'Chromium has its own test',
  );
  test.setTimeout(15 * 60 * 1000);

  // The languages with a region, and the ones whose folder is not the language: where the rule could go wrong.
  // Each is asked with the folders that make the difference
  const cases: [folders: string[], language: string][] = [
    [['pt'], 'pt-BR'],
    [['pt', 'pt_BR'], 'pt-BR'],
    [['pt', 'pt_PT'], 'pt-PT'],
    [['nb'], 'nb-NO'],
    [['no'], 'nb-NO'],
    [['nn'], 'nn-NO'],
    [['ga'], 'ga-IE'],
    [['hy'], 'hy-AM'],
    [['hi'], 'hi-IN'],
    [['gu'], 'gu-IN'],
    [['pa'], 'pa-IN'],
    [['ne'], 'ne-NP'],
    [['sv'], 'sv-SE'],
    [['es'], 'es-ES'],
    [['es'], 'es-AR'],
    [['es'], 'es-MX'],
    [['es_419', 'es'], 'es-MX'],
    [['es_419'], 'es-MX'],
    [['de_CH'], 'de'],
    [['en_GB'], 'en-GB'],
    [['en_CA'], 'en-CA'],
    [['zh_CN'], 'zh-CN'],
    [['zh_TW'], 'zh-TW'],
    [['ca'], 'ca-valencia'],
    [['tl'], 'tl'],
  ];

  test('takes the folder named like its language, else the one named like the language alone', async () => {
    const answers = await cases.reduce(
      async (previous, [folders, language]) => [
        ...(await previous),
        await answerOf(folders, language),
      ],
      Promise.resolve<Answer[]>([]),
    );

    expect(answers.map(({ folder }) => folder)).toEqual(
      cases.map(
        ([folders, language]) =>
          folderFor(language, folders, true) ?? 'default',
      ),
    );
  });

  // Every folder of the extension, in the language of Firefox that is meant to take it, with all the other
  // folders there too: it is the folder that is taken, and not another
  const present = localeFolders();
  present
    .filter((folder) => folder !== 'en')
    .forEach((folder) => {
      const language = FIREFOX_LANGUAGES.find(
        (each) => folderFor(each, TARGET_LOCALES, true) === folder,
      );
      if (language === undefined) {
        return;
      }
      test(`takes ${folder} when it is set to ${language}`, async () => {
        const { folder: taken } = await answerOf(present, language);

        expect(taken).toBe(folder);
      });
    });
});
