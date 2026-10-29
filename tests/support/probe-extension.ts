import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A throwaway extension that has these folders of `_locales`, each with a message that says which it is
 * (`default` for English), and a background that reports that message and the language of the browser to
 * the address it is given. It is how a test asks a real browser which folder it takes.
 */
export function probeExtension(
  folders: readonly string[],
  browser: 'chromium' | 'firefox',
  reportTo = '',
): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-probe-'));
  const background = {
    chromium: { service_worker: 'background.js' },
    firefox: { scripts: ['background.js'] },
  }[browser];
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'probe',
      version: '1.0',
      default_locale: 'en',
      background,
      browser_specific_settings: { gecko: { id: 'probe@example.com' } },
    }),
  );
  fs.writeFileSync(
    path.join(directory, 'background.js'),
    reportTo === ''
      ? ''
      : `fetch(${JSON.stringify(reportTo)} + '?folder=' + encodeURIComponent(chrome.i18n.getMessage('probe')) + '&ui=' + encodeURIComponent(chrome.i18n.getUILanguage()), { mode: 'no-cors' });`,
  );
  ['en', ...folders].forEach((folder) => {
    fs.mkdirSync(path.join(directory, '_locales', folder), { recursive: true });
    fs.writeFileSync(
      path.join(directory, '_locales', folder, 'messages.json'),
      JSON.stringify({
        probe: { message: folder === 'en' ? 'default' : folder },
      }),
    );
  });
  return directory;
}
