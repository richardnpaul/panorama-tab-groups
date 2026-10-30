import fs from 'node:fs';
import path from 'node:path';
import { firefox } from '@playwright/test';

// Firefox is set to a language by the language pack of that language, and takes only a pack that Mozilla
// has signed (a pack that is not is refused whatever the preferences say, which was tried), so a test of
// the languages of Firefox downloads the packs of the version that is installed, and keeps them.

const CACHE = path.join('node_modules', '.cache', 'firefox-langpacks');

/** The version of the Firefox that Playwright runs, from its `application.ini` */
function firefoxVersion(): string {
  const ini = fs.readFileSync(
    path.join(path.dirname(firefox.executablePath()), 'application.ini'),
    'utf8',
  );
  const found = /^Version=(.+)$/mu.exec(ini)?.[1];
  if (found === undefined) {
    throw new Error('application.ini of Firefox has no Version');
  }
  return found;
}

/** The signed language pack of the language for the installed Firefox, downloaded once; its path */
export async function langpackFor(language: string): Promise<string> {
  const version = firefoxVersion();
  const target = path.join(CACHE, version, `${language}.xpi`);
  if (!fs.existsSync(target)) {
    const url = `https://ftp.mozilla.org/pub/firefox/releases/${version}/linux-x86_64/xpi/${language}.xpi`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `The language pack ${url} could not be downloaded: ${String(response.status)}`,
      );
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  return target;
}
