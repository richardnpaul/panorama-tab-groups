import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files: Record<string, string> = {
  'src/_locales/en/messages.json': JSON.stringify({
    a: { message: 'A' },
    b: { message: 'B' },
  }),
  'src/_locales/de/messages.json': JSON.stringify({ a: { message: 'Eins' } }),
  'src/_locales/fr/messages.json': JSON.stringify({
    a: { message: 'Un' },
    b: { message: 'Deux' },
  }),
};

vi.mock('node:fs', () => ({
  readdirSync: () => ['fr', 'en', 'de'],
  readFileSync: (path: string) => files[path] ?? '',
}));

describe('scripts/locale-report.ts', () => {
  let log = vi.spyOn(console, 'log');

  beforeEach(() => {
    vi.resetModules();
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the report of every language except English, the most complete first', async () => {
    await import('../../../scripts/locale-report.js');

    expect(log).toHaveBeenCalledTimes(1);
    const report = String(log.mock.calls[0]?.[0]);
    expect(report).toContain('English has 2 messages.');
    expect(report.indexOf('| fr |')).toBeGreaterThan(-1);
    expect(report.indexOf('| fr |')).toBeLessThan(report.indexOf('| de |'));
    expect(report).not.toContain('| en |');
  });
});
