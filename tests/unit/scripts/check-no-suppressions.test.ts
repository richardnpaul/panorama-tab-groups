import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Counts, Repository } from '../../../scripts/lib/suppressions.js';

type Check = (
  repository: Repository & { allowlist: Counts },
) => Promise<string[]>;

const execFileSync = vi.fn<(...args: unknown[]) => string>();
const existsSync = vi.fn<(file: string) => boolean>();
const readFileSync = vi.fn<(file: string, encoding: string) => string>();
const checkSuppressions = vi.fn<Check>();

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSync(...args),
}));
vi.mock('node:fs', () => ({
  existsSync: (file: string) => existsSync(file),
  readFileSync: (file: string, encoding: string) =>
    readFileSync(file, encoding),
}));
vi.mock(
  '../../../scripts/lib/suppressions.js',
  async (importOriginal: () => Promise<object>) => ({
    ...(await importOriginal()),
    checkSuppressions: (...args: Parameters<Check>) =>
      checkSuppressions(...args),
  }),
);

describe('scripts/check-no-suppressions.ts', () => {
  let errorSpy: MockInstance<typeof console.error>;
  const originalExitCode = process.exitCode;

  const run = async (problems: string[] = []) => {
    checkSuppressions.mockResolvedValue(problems);
    await import('../../../scripts/check-no-suppressions.js');
    const args = checkSuppressions.mock.calls[0]?.[0];
    if (!args) {
      throw new Error('The guard did not run the check');
    }
    return args;
  };

  beforeEach(() => {
    vi.resetModules();
    execFileSync
      .mockReset()
      .mockReturnValue('src/a.js\n\nsrc/gone.js\nsrc/b.ts\n');
    existsSync.mockReset().mockImplementation((file) => file !== 'src/gone.js');
    readFileSync.mockReset().mockReturnValue('{"k": 1}');
    checkSuppressions.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
      args.importConfig('tests/unit/scripts/fixtures/sample-config.ts'),
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

  it('keeps only the counts of the allow-list', async () => {
    readFileSync.mockReturnValue('{"k": 1, "bad": "2"}');

    const args = await run();

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
