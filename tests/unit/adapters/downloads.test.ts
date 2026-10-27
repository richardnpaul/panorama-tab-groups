import { describe, expect, it, vi } from 'vitest';
import { createBrowserDownloads } from '../../../src/js/adapters/browser/downloads.js';
import { createMemoryDownloads } from '../../../src/js/adapters/memory/downloads.js';

describe('adapters/browser/downloads.ts', () => {
  it('offers the text as a file, asking the user where to save it', async () => {
    const download = vi.fn().mockResolvedValue(1);
    const makeUrl = vi.fn(() => 'blob:link');
    const downloads = createBrowserDownloads(
      () => ({ downloads: { download } }),
      makeUrl,
    );

    await downloads.saveFile('{"a":1}', 'backup.json');

    expect(makeUrl).toHaveBeenCalledWith('{"a":1}');
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith({
      url: 'blob:link',
      filename: 'backup.json',
      conflictAction: 'uniquify',
      saveAs: true,
    });
  });

  it('passes on a failure', async () => {
    const failure = new Error('cancelled');
    const downloads = createBrowserDownloads(
      () => ({ downloads: { download: vi.fn().mockRejectedValue(failure) } }),
      () => 'blob:x',
    );

    await expect(downloads.saveFile('a', 'b')).rejects.toBe(failure);
  });

  it('uses the browser that exists when it is called', async () => {
    const first = vi.fn().mockResolvedValue(1);
    const second = vi.fn().mockResolvedValue(1);
    let current = first;
    const downloads = createBrowserDownloads(
      () => ({ downloads: { download: current } }),
      () => 'blob:x',
    );
    current = second;

    await downloads.saveFile('a', 'b');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('adapters/memory/downloads.ts', () => {
  it('remembers the files offered, in order', async () => {
    const downloads = createMemoryDownloads();

    await downloads.saveFile('one', 'a.json');
    await downloads.saveFile('two', 'b.json');

    expect(downloads.saved).toEqual([
      { filename: 'a.json', content: 'one' },
      { filename: 'b.json', content: 'two' },
    ]);
  });
});
