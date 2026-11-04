import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { type Worker, chromium, expect, test } from '@playwright/test';

// What Chromium does with a file the background of the add-on writes, and the add-on writing its own
// backups (docs/plans/data-structures-review.md, decision 7). The background is a service worker, which
// has no page to make a link in.

test.describe('Files the background writes, in Chromium', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The background is a service worker in Chromium only',
  );

  let profile: string;
  let downloads: string;
  let server: http.Server;
  let port: number;

  test.beforeEach(async () => {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-profile-'));
    downloads = path.join(profile, 'Downloads');
    // The profile's own Downloads folder, so nothing is written to the user's
    fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
    fs.writeFileSync(
      path.join(profile, 'Default', 'Preferences'),
      JSON.stringify({
        download: { default_directory: downloads, prompt_for_download: false },
      }),
    );
    server = http.createServer((request, response) => {
      // The address is shown as text, never as markup, as in the lab's pages (`lab/lab.ts`)
      const shown = (request.url ?? '').replace(/[<&]/gu, '');
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<title>${shown}</title>${shown}`);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;
  });

  test.afterEach(() => {
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  });

  async function launch() {
    const dist = path.join(process.cwd(), 'dist');
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: chromium.executablePath(),
      headless: true,
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
    // Playwright takes every download for itself, under a name of its own; Chromium's own way keeps the
    // name and the folder the add-on asks for
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
    const [worker] = context.serviceWorkers();
    const found =
      worker ??
      (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    return { context, worker: found };
  }

  /** Download a text from the service worker, by a link of the kind asked for; how it ended */
  const download = (
    worker: Worker,
    request: { how: 'data' | 'blob'; text: string; filename: string },
  ) =>
    worker.evaluate(async ({ how, text, filename }) => {
      let url: string;
      try {
        url =
          how === 'data'
            ? `data:application/json;charset=utf-8,${encodeURIComponent(text)}`
            : URL.createObjectURL(
                new Blob([text], { type: 'application/json' }),
              );
      } catch (error) {
        return { id: -1, refused: String(error) };
      }
      const id = await browser.downloads.download({
        url,
        filename,
        conflictAction: 'overwrite',
        saveAs: false,
      });
      // Asked again until it has ended, five seconds at most
      const ended = async (
        tries: number,
      ): Promise<{
        id: number;
        state: string | undefined;
        file: string | undefined;
      }> => {
        const [item] = await browser.downloads.search({ id });
        if (item?.state !== 'in_progress' || tries === 0) {
          return { id, state: item?.state, file: item?.filename };
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 50);
        });
        return ended(tries - 1);
      };
      return ended(100);
    }, request);

  test('writes a file from a data: link, which it overwrites, and cannot make a blob: link', async () => {
    const { context, worker } = await launch();
    try {
      const filename = 'facts/one.json';
      const first = await download(worker, {
        how: 'data',
        text: '{"a":1}',
        filename,
      });
      const second = await download(worker, {
        how: 'data',
        text: '{"a":2}',
        filename,
      });
      const blob = await download(worker, {
        how: 'blob',
        text: '{"b":1}',
        filename: 'facts/two.json',
      });

      const file = path.join(downloads, filename);
      expect(first).toMatchObject({ state: 'complete', file });
      expect(second).toMatchObject({ state: 'complete', file });
      expect(fs.readdirSync(path.join(downloads, 'facts'))).toEqual([
        'one.json',
      ]);
      expect(fs.readFileSync(file, 'utf8')).toBe('{"a":2}');
      expect(blob).toEqual({
        id: -1,
        refused: 'TypeError: URL.createObjectURL is not a function',
      });

      // Taken out of the list of downloads, the file stays
      const listed = await worker.evaluate(async (id) => {
        await browser.downloads.erase({ id });
        return browser.downloads.search({ id });
      }, second.id);
      expect(listed).toEqual([]);
      expect(fs.readFileSync(file, 'utf8')).toBe('{"a":2}');
    } finally {
      await context.close();
    }
  });

  test('backs the groups up to a file of its own a few seconds after they change, and leaves no entry in the downloads', async () => {
    test.setTimeout(60000);
    const { context, worker } = await launch();
    try {
      const backup = path.join(
        downloads,
        'panorama-tab-groups-backups',
        'backup-1.json',
      );
      const address = `http://127.0.0.1:${String(port)}/backed-up`;
      // A new tab is put in a group, which is a change, whether start-up was done or not
      const page = await context.newPage();
      await page.goto(address);

      await expect
        .poll(() => fs.existsSync(backup), { timeout: 20000 })
        .toBe(true);

      const saved: unknown = JSON.parse(fs.readFileSync(backup, 'utf8'));
      expect(saved).toMatchObject({
        file: { type: 'tgvView', version: 1 },
        savedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/u),
        windows: expect.arrayContaining([
          expect.objectContaining({
            tabs: expect.arrayContaining([
              expect.objectContaining({ url: address }),
            ]),
          }),
        ]),
      });
      await expect
        .poll(() =>
          worker.evaluate(async () =>
            (await browser.downloads.search({})).map(
              ({ filename }) => filename,
            ),
          ),
        )
        .toEqual([]);
      const record: unknown = await worker.evaluate(async () => {
        const stored: Record<string, unknown> =
          await browser.storage.local.get('automaticBackups');
        return stored.automaticBackups;
      });
      expect(record).toMatchObject({ next: 2, last: expect.any(Number) });
    } finally {
      await context.close();
    }
  });
});
