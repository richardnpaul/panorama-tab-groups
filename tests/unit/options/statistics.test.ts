// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserViewState } from '../../../src/js/adapters/browser/view-state.js';
import { createMemoryViewState } from '../../../src/js/adapters/memory/view-state.js';
import { createMemoryViewTabs } from '../../../src/js/adapters/memory/view-tabs.js';
import { createStatistics } from '../../../src/js/options/statistics.js';
import type { ViewState } from '../../../src/js/ports/view-state.js';
import type { ViewTab } from '../../../src/js/ports/view-tabs.js';
import { createFakeSessions } from '../../support/fake-sessions.js';

const getMessage = vi.fn<(messageName: string) => string>();

const text = (id: string) => document.getElementById(id)?.textContent;

const tab = (id: number, discarded = false): ViewTab => ({
  id,
  windowId: 1,
  index: id,
  title: '',
  url: undefined,
  favIconUrl: undefined,
  pinned: false,
  discarded,
  lastAccessed: 0,
});

/** The statistics over these tabs, with thumbnails as the browser stores them */
function statisticsOf(
  tabs: ViewTab[],
  stored: Record<number, unknown> = {},
): { show: () => Promise<void>; viewState: ViewState } {
  const sessions = createFakeSessions();
  Object.entries(stored).forEach(([id, value]) => {
    sessions.tabValues.set(sessions.slot(Number(id), 'thumbnail'), value);
  });
  const viewState = createBrowserViewState(() => sessions.api);
  return {
    show: createStatistics({
      viewTabs: createMemoryViewTabs(tabs),
      viewState,
      i18n: { getMessage },
    }),
    viewState,
  };
}

describe('options/statistics.ts', () => {
  beforeEach(() => {
    getMessage.mockReset().mockReturnValue('active');
    document.body.innerHTML = `
      <span id="thumbnailCacheSize">old size</span>
      <span id="numberOfTabs">old tabs</span>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads the thumbnail of every tab of every window', async () => {
    const viewState = createMemoryViewState();
    const thumbnail = vi.spyOn(viewState, 'thumbnail');
    const viewTabs = createMemoryViewTabs([tab(1), tab(2, true)]);
    const listAll = vi.spyOn(viewTabs, 'listAll');

    await createStatistics({ viewTabs, viewState, i18n: { getMessage } })();

    expect(listAll).toHaveBeenCalledTimes(1);
    expect(thumbnail).toHaveBeenCalledTimes(2);
    expect(thumbnail).toHaveBeenCalledWith(1);
    expect(thumbnail).toHaveBeenCalledWith(2);
  });

  it('adds up thumbnails stored as records and as plain strings', async () => {
    const { show } = statisticsOf([tab(1), tab(2, true), tab(3)], {
      1: { thumbnail: 'A'.repeat(50), capturedTime: 5 },
      2: 'B'.repeat(70),
    });

    await show();

    expect(text('thumbnailCacheSize')).toBe('120 bytes');
  });

  it.each([
    ['a record whose picture is not text', { thumbnail: 5 }],
    ['a record without a picture', {}],
    ['nothing', null],
  ])('counts a thumbnail stored as %s as empty', async (_name, stored) => {
    const { show } = statisticsOf([tab(1)], { 1: stored });

    await show();

    expect(text('thumbnailCacheSize')).toBe('0 bytes');
  });

  it('counts the pictures the view keeps now', async () => {
    const { show, viewState } = statisticsOf([tab(1)]);
    await viewState.setThumbnail(1, { image: 'C'.repeat(30), capturedAt: 1 });

    await show();

    expect(text('thumbnailCacheSize')).toBe('30 bytes');
  });

  it('formats a large cache size', async () => {
    const { show } = statisticsOf([tab(1)], { 1: 'A'.repeat(2048) });

    await show();

    expect(text('thumbnailCacheSize')).toBe('2.000 KiB');
  });

  it('reports the number of tabs and how many are not discarded', async () => {
    const { show } = statisticsOf([tab(1), tab(2, true), tab(3)]);

    await show();

    expect(getMessage).toHaveBeenCalledWith(
      'optionsStatisticsNumberOfTabsActive',
    );
    expect(text('numberOfTabs')).toBe('3 (active 2)');
  });

  it('reports zero when there are no tabs', async () => {
    const { show } = statisticsOf([]);

    await show();

    expect(text('numberOfTabs')).toBe('0 (active 0)');
    expect(text('thumbnailCacheSize')).toBe('0 bytes');
  });

  it('replaces the old text instead of adding to it', async () => {
    const { show } = statisticsOf([tab(1)]);

    await show();

    expect(document.getElementById('numberOfTabs')?.childNodes).toHaveLength(1);
    expect(
      document.getElementById('thumbnailCacheSize')?.childNodes,
    ).toHaveLength(1);
  });

  it('fails when the page lacks the statistics elements', async () => {
    const { show } = statisticsOf([]);
    document.body.innerHTML = '<span id="thumbnailCacheSize"></span>';

    await expect(show()).rejects.toThrow('Element not found: #numberOfTabs');
  });
});
