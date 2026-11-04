import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { type Lab, startLab } from './lab/lab.js';
import { worldOf } from './lab/world.js';

// What the real Firefox does with a file an add-on's background writes, asked of it by a probe
// extension, and the add-on writing its own backups (docs/plans/data-structures-review.md, decision 7).

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

test.describe('Files a background writes, in Firefox', () => {
  test.skip(
    ({ browserName }) => browserName !== 'firefox',
    'Asked of the Firefox that Playwright brings',
  );

  let lab: Lab;

  test.beforeEach(async () => {
    lab = await startLab({ probes: ['a'] });
  });

  test.afterEach(async () => {
    await lab.close();
  });

  /** Download from the probe's background; the download as Firefox lists it once it has ended */
  async function download(
    url: string,
    filename: string,
  ): Promise<Record<string, unknown>> {
    const a = lab.probe('a');
    const id = await a.call('downloads.download', {
      url,
      filename,
      conflictAction: 'overwrite',
      saveAs: false,
    });
    let ended: Record<string, unknown> = {};
    await expect
      .poll(async () => {
        const found = await a.call('downloads.search', { id });
        const [item] = Array.isArray(found)
          ? found.flatMap((each: unknown) => (isObject(each) ? [each] : []))
          : [];
        ended = item ?? {};
        return ended.state;
      })
      .not.toBe('in_progress');
    return ended;
  }

  test('refuses a data: link, and writes a file from a blob: link, which it overwrites', async () => {
    const a = lab.probe('a');

    await expect(
      a.call('downloads.download', {
        url: `data:application/json;charset=utf-8,${encodeURIComponent('{"a":1}')}`,
        filename: 'facts/data.json',
        conflictAction: 'overwrite',
        saveAs: false,
      }),
    ).rejects.toThrow(/Access denied for URL data:/u);

    const file = path.join(lab.downloads, 'facts', 'blob.json');
    const first = await download(
      String(await a.call('lab.objectUrl', '{"b":1}')),
      'facts/blob.json',
    );
    const second = await download(
      String(await a.call('lab.objectUrl', '{"b":2}')),
      'facts/blob.json',
    );

    expect(first).toMatchObject({ state: 'complete', filename: file });
    expect(second).toMatchObject({ state: 'complete', filename: file });
    expect(fs.readdirSync(path.join(lab.downloads, 'facts'))).toEqual([
      'blob.json',
    ]);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"b":2}');

    // Taken out of the list of downloads, the file stays
    await a.call('downloads.erase', { id: second.id });
    expect(await a.call('downloads.search', { id: second.id })).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"b":2}');
  });

  test('the add-on backs the groups up to a file of its own, and leaves no entry in the downloads', async () => {
    test.setTimeout(60000);
    const world = worldOf(lab, 'a');
    const [windowId = 0] = await world.windowIds();
    await world.addTabs(windowId, ['backed-up']);

    await lab.installLogged(path.join(process.cwd(), 'dist-firefox'));
    await expect
      .poll(() => lab.logs().join('\n'), { timeout: 30000 })
      .toContain('Finished setup');

    const backup = path.join(
      lab.downloads,
      'panorama-tab-groups-backups',
      'backup-1.json',
    );
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
            expect.objectContaining({ url: lab.pageUrl('backed-up') }),
          ]),
        }),
      ]),
    });
    // The probe sees every download of the profile, the add-on's too
    await expect
      .poll(() => lab.probe('a').call('downloads.search', {}))
      .toEqual([]);
    expect(lab.logs().filter((line) => line.startsWith('error'))).toEqual([]);
  });
});
