// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import getStatistics from '../../../src/js/options/statistics.js';

const query = vi.fn();
const getTabValue = vi.fn();
const getMessage = vi.fn();

const text = (id: string) => document.getElementById(id)?.textContent;

describe('options/statistics.ts', () => {
  beforeEach(() => {
    query.mockReset();
    getTabValue.mockReset().mockResolvedValue(undefined);
    getMessage.mockReset().mockReturnValue('active');
    Object.assign(globalThis, {
      browser: {
        tabs: { query },
        sessions: { getTabValue },
        i18n: { getMessage },
      },
    });
    document.body.innerHTML = `
      <span id="thumbnailCacheSize">old size</span>
      <span id="numberOfTabs">old tabs</span>
    `;
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'browser');
    document.body.innerHTML = '';
  });

  function givenTabs(
    tabs: { id?: number; discarded: boolean }[],
    thumbnails: Record<number, unknown>,
  ) {
    query.mockResolvedValue(tabs);
    getTabValue.mockImplementation(async (id: number) =>
      Promise.resolve(thumbnails[id]),
    );
  }

  it('queries all tabs and reads the cached thumbnail of each', async () => {
    givenTabs(
      [
        { id: 1, discarded: false },
        { id: 2, discarded: true },
      ],
      {},
    );

    await getStatistics();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({});
    expect(getTabValue).toHaveBeenCalledTimes(2);
    expect(getTabValue).toHaveBeenCalledWith(1, 'thumbnail');
    expect(getTabValue).toHaveBeenCalledWith(2, 'thumbnail');
  });

  it('adds up thumbnails stored as objects and as plain strings', async () => {
    givenTabs(
      [
        { id: 1, discarded: false },
        { id: 2, discarded: true },
        { id: 3, discarded: false },
      ],
      { 1: { thumbnail: 'A'.repeat(50) }, 2: 'B'.repeat(70) },
    );

    await getStatistics();

    expect(text('thumbnailCacheSize')).toBe('120 bytes');
  });

  it('counts a thumbnail object without a string thumbnail as empty', async () => {
    givenTabs(
      [
        { id: 1, discarded: false },
        { id: 2, discarded: false },
        { id: 3, discarded: false },
      ],
      { 1: { thumbnail: 5 }, 2: {}, 3: null },
    );

    await getStatistics();

    expect(text('thumbnailCacheSize')).toBe('0 bytes');
  });

  it('does not read a thumbnail for a tab without an id', async () => {
    givenTabs([{ discarded: false }], {});

    await getStatistics();

    expect(getTabValue).not.toHaveBeenCalled();
    expect(text('thumbnailCacheSize')).toBe('0 bytes');
    expect(text('numberOfTabs')).toBe('1 (active 1)');
  });

  it('formats a large cache size', async () => {
    givenTabs([{ id: 1, discarded: false }], {
      1: 'A'.repeat(2048),
    });

    await getStatistics();

    expect(text('thumbnailCacheSize')).toBe('2.000 KiB');
  });

  it('reports the number of tabs and how many are not discarded', async () => {
    givenTabs(
      [
        { id: 1, discarded: false },
        { id: 2, discarded: true },
        { id: 3, discarded: false },
      ],
      {},
    );

    await getStatistics();

    expect(getMessage).toHaveBeenCalledWith(
      'optionsStatisticsNumberOfTabsActive',
    );
    expect(text('numberOfTabs')).toBe('3 (active 2)');
  });

  it('reports zero for a window without tabs', async () => {
    givenTabs([], {});

    await getStatistics();

    expect(text('numberOfTabs')).toBe('0 (active 0)');
    expect(text('thumbnailCacheSize')).toBe('0 bytes');
  });

  it('replaces the old text instead of adding to it', async () => {
    givenTabs([{ id: 1, discarded: false }], {});

    await getStatistics();

    expect(document.getElementById('numberOfTabs')?.childNodes).toHaveLength(1);
    expect(
      document.getElementById('thumbnailCacheSize')?.childNodes,
    ).toHaveLength(1);
  });

  it('fails when the page lacks the statistics elements', async () => {
    givenTabs([], {});
    document.body.innerHTML = '<span id="thumbnailCacheSize"></span>';

    await expect(getStatistics()).rejects.toThrow(
      'Element not found: #numberOfTabs',
    );
  });
});
