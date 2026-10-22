import { vi } from 'vitest';

const execFileSync = vi.fn();
const existsSync = vi.fn();
const readFileSync = vi.fn();
const checkSuppressions = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: (...args) => execFileSync(...args),
}));
vi.mock('node:fs', () => ({
  existsSync: (...args) => existsSync(...args),
  readFileSync: (...args) => readFileSync(...args),
}));
vi.mock('../../../scripts/lib/suppressions.mjs', () => ({
  checkSuppressions: (...args) => checkSuppressions(...args),
}));

describe('scripts/check-no-suppressions.mjs', () => {
  let errorSpy;
  const originalExitCode = process.exitCode;

  const run = async (problems = []) => {
    checkSuppressions.mockResolvedValue(problems);
    await import('../../../scripts/check-no-suppressions.mjs');
    return checkSuppressions.mock.calls[0][0];
  };

  beforeEach(() => {
    vi.resetModules();
    execFileSync
      .mockReset()
      .mockReturnValue('src/a.js\n\nsrc/gone.js\nsrc/b.ts\n');
    existsSync.mockReset().mockImplementation((file) => file !== 'src/gone.js');
    readFileSync.mockReset().mockReturnValue('{"k": 1}');
    checkSuppressions.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('lists tracked and untracked files that still exist', async () => {
    const args = await run();

    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8' },
    );
    expect(args.files).toEqual(['src/a.js', 'src/b.ts']);
  });

  it('reads files as UTF-8 text', async () => {
    const args = await run();
    readFileSync.mockReturnValueOnce('contents');

    expect(args.readText('src/a.js')).toBe('contents');
    expect(readFileSync).toHaveBeenLastCalledWith('src/a.js', 'utf8');
  });

  it('imports a config module and returns its default export', async () => {
    const args = await run();

    await expect(
      args.importConfig('tests/unit/scripts/fixtures/sample-config.mjs'),
    ).resolves.toEqual({ loaded: true });
  });

  it('loads the allow-list from the scripts folder', async () => {
    const args = await run();

    expect(readFileSync).toHaveBeenCalledWith(
      'scripts/suppression-allowlist.json',
      'utf8',
    );
    expect(args.allowlist).toEqual({ k: 1 });
  });

  it('succeeds quietly when there are no problems', async () => {
    await run([]);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('prints every problem and fails the process', async () => {
    await run(['first problem', 'second problem']);

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenNthCalledWith(1, 'first problem');
    expect(errorSpy).toHaveBeenNthCalledWith(2, 'second problem');
    expect(process.exitCode).toBe(1);
  });
});
