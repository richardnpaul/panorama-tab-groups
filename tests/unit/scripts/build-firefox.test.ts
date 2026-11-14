import { beforeEach, describe, expect, it, vi } from 'vitest';

const cpSync =
  vi.fn<(source: string, destination: string, options: object) => void>();
const readFileSync = vi.fn<(path: string, encoding: string) => string>();
const rmSync = vi.fn<(path: string, options: object) => void>();
const writeFileSync = vi.fn<(path: string, text: string) => void>();

vi.mock('node:fs', () => ({
  cpSync: (source: string, destination: string, options: object) => {
    cpSync(source, destination, options);
  },
  readFileSync: (path: string, encoding: string) =>
    readFileSync(path, encoding),
  rmSync: (path: string, options: object) => {
    rmSync(path, options);
  },
  writeFileSync: (path: string, text: string) => {
    writeFileSync(path, text);
  },
}));

describe('scripts/build-firefox.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    [cpSync, readFileSync, rmSync, writeFileSync].forEach((mock) => {
      mock.mockReset();
    });
    readFileSync.mockReturnValue(
      '{"background": {"scripts": ["a.js"], "service_worker": "a.js"}}',
    );
  });

  it('replaces dist-firefox with a copy of dist', async () => {
    await import('../../../scripts/build-firefox.js');

    expect(rmSync).toHaveBeenCalledWith('dist-firefox', {
      recursive: true,
      force: true,
    });
    expect(cpSync).toHaveBeenCalledWith('dist', 'dist-firefox', {
      recursive: true,
    });
    expect(rmSync.mock.invocationCallOrder[0]).toBeLessThan(
      cpSync.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('reads the manifest as UTF-8 text and writes the one for Firefox over it', async () => {
    await import('../../../scripts/build-firefox.js');

    expect(readFileSync).toHaveBeenCalledWith(
      'dist-firefox/manifest.json',
      'utf8',
    );
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [path, text] = writeFileSync.mock.calls[0] ?? [];
    expect(path).toBe('dist-firefox/manifest.json');
    expect(JSON.parse(text ?? '')).toEqual({
      background: { scripts: ['a.js'] },
      host_permissions: ['<all_urls>'],
    });
  });
});
