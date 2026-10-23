import { describe, expect, it, vi, type Mock } from 'vitest';
import { createBrowserViewState } from '../../../src/js/adapters/browser/view-state.js';
import {
  createBrowserViewTabs,
  type ViewTabsApi,
} from '../../../src/js/adapters/browser/view-tabs.js';
import { createMemoryViewState } from '../../../src/js/adapters/memory/view-state.js';
import { createMemoryViewTabs } from '../../../src/js/adapters/memory/view-tabs.js';
import type { ViewState } from '../../../src/js/ports/view-state.js';
import type { ViewTab } from '../../../src/js/ports/view-tabs.js';
import { createFakeSessions } from '../../support/fake-sessions.js';

const rawTab = (overrides: Record<string, unknown> = {}) => ({
  id: 4,
  windowId: 2,
  index: 1,
  title: 'T',
  url: 'https://a/',
  favIconUrl: 'https://a/i.png',
  pinned: true,
  discarded: true,
  lastAccessed: 99,
  ...overrides,
});

const api = (tabs: Partial<Record<keyof ViewTabsApi['tabs'], Mock>> = {}) => ({
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(rawTab()),
    getCurrent: vi.fn().mockResolvedValue({ id: 7 }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: 11 }),
    ...tabs,
  },
});

describe('adapters/browser/view-tabs.ts', () => {
  it('lists the tabs of the current window as the view shows them', async () => {
    const query = vi.fn().mockResolvedValue([rawTab()]);
    const tabs = createBrowserViewTabs(() => api({ query }));

    await expect(tabs.list()).resolves.toEqual([
      {
        id: 4,
        windowId: 2,
        index: 1,
        title: 'T',
        url: 'https://a/',
        favIconUrl: 'https://a/i.png',
        pinned: true,
        discarded: true,
        lastAccessed: 99,
      },
    ]);
    expect(query).toHaveBeenCalledWith({ currentWindow: true });
  });

  it('fills in what the browser leaves out', async () => {
    const tabs = createBrowserViewTabs(() =>
      api({
        get: vi.fn().mockResolvedValue(
          rawTab({
            title: undefined,
            url: undefined,
            favIconUrl: undefined,
            discarded: undefined,
            lastAccessed: undefined,
            pinned: undefined,
          }),
        ),
      }),
    );

    await expect(tabs.get(4)).resolves.toEqual({
      id: 4,
      windowId: 2,
      index: 1,
      title: '',
      url: undefined,
      favIconUrl: undefined,
      pinned: false,
      discarded: false,
      lastAccessed: 0,
    });
  });

  it.each([[{ id: undefined }], [{ windowId: undefined }]])(
    'fails for a tab that has no id or no window: %j',
    async (missing) => {
      const tabs = createBrowserViewTabs(() =>
        api({ get: vi.fn().mockResolvedValue(rawTab(missing)) }),
      );

      await expect(tabs.get(4)).rejects.toThrow('A tab has no id or window');
    },
  );

  it('accepts the tab 0 and the window 0', async () => {
    const tabs = createBrowserViewTabs(() =>
      api({ get: vi.fn().mockResolvedValue(rawTab({ id: 0, windowId: 0 })) }),
    );

    await expect(tabs.get(0)).resolves.toMatchObject({ id: 0, windowId: 0 });
  });

  it('activates, closes and moves tabs, and opens a new one', async () => {
    const browser = api();
    const tabs = createBrowserViewTabs(() => browser);

    await tabs.activate(3);
    await tabs.close(4);
    await tabs.moveTo(5, 0);
    const opened = await tabs.openNew();

    expect(opened).toBe(11);
    expect(browser.tabs.update).toHaveBeenCalledWith(3, { active: true });
    expect(browser.tabs.remove).toHaveBeenCalledWith(4);
    expect(browser.tabs.move).toHaveBeenCalledWith(5, { index: 0 });
    expect(browser.tabs.create).toHaveBeenCalledWith({ active: true });
  });

  it('fails when the browser gives the new tab no id', async () => {
    const tabs = createBrowserViewTabs(() =>
      api({ create: vi.fn().mockResolvedValue({}) }),
    );

    await expect(tabs.openNew()).rejects.toThrow('The new tab has no id');
  });

  it('passes on failures', async () => {
    const failure = new Error('no');
    const reject = vi.fn().mockRejectedValue(failure);
    const tabs = createBrowserViewTabs(() =>
      api({ update: reject, remove: reject, move: reject, create: reject }),
    );

    await expect(tabs.activate(1)).rejects.toBe(failure);
    await expect(tabs.close(1)).rejects.toBe(failure);
    await expect(tabs.moveTo(1, 0)).rejects.toBe(failure);
    await expect(tabs.openNew()).rejects.toBe(failure);
  });

  it('gives the id of the tab the page is in', async () => {
    const tabs = createBrowserViewTabs(() => api());

    await expect(tabs.currentId()).resolves.toBe(7);
  });

  it('accepts the current tab 0', async () => {
    const tabs = createBrowserViewTabs(() =>
      api({ getCurrent: vi.fn().mockResolvedValue({ id: 0 }) }),
    );

    await expect(tabs.currentId()).resolves.toBe(0);
  });

  it.each([[undefined], [{}]])(
    'fails when the page is not in a tab: %j',
    async (current) => {
      const tabs = createBrowserViewTabs(() =>
        api({ getCurrent: vi.fn().mockResolvedValue(current) }),
      );

      await expect(tabs.currentId()).rejects.toThrow(
        'This page is not in a tab',
      );
    },
  );

  it('takes a small JPEG picture of a tab', async () => {
    const captureTab = vi.fn().mockResolvedValue('data:image/jpeg;base64,x');
    const tabs = createBrowserViewTabs(() => api({ captureTab }));

    await expect(tabs.capture(4)).resolves.toBe('data:image/jpeg;base64,x');
    expect(captureTab).toHaveBeenCalledWith(4, { format: 'jpeg', quality: 25 });
  });

  it('gives no picture where the browser cannot take one', async () => {
    const tabs = createBrowserViewTabs(() => api());

    await expect(tabs.capture(4)).resolves.toBeUndefined();
  });

  it('uses the browser that exists when it is called', async () => {
    const first = api();
    const second = api();
    let current = first;
    const tabs = createBrowserViewTabs(() => current);
    current = second;

    await tabs.activate(1);

    expect(first.tabs.update).not.toHaveBeenCalled();
    expect(second.tabs.update).toHaveBeenCalledTimes(1);
  });
});

const viewTab = (id: number): ViewTab => ({
  id,
  windowId: 1,
  index: id,
  title: `T${String(id)}`,
  url: undefined,
  favIconUrl: undefined,
  pinned: false,
  discarded: false,
  lastAccessed: 0,
});

describe('adapters/memory/view-tabs.ts', () => {
  it('lists copies of the tabs it was given, and replaces them when told', async () => {
    const given = [viewTab(1)];
    const tabs = createMemoryViewTabs(given);
    given[0] = { ...viewTab(1), title: 'changed' };

    const listed = await tabs.list();
    listed[0] = { ...viewTab(1), title: 'changed again' };

    expect((await tabs.list())[0]?.title).toBe('T1');
    tabs.setTabs([viewTab(2)]);
    expect((await tabs.list()).map(({ id }) => id)).toEqual([2]);
  });

  it('has no tabs to begin with', async () => {
    await expect(createMemoryViewTabs().list()).resolves.toEqual([]);
  });

  it('gives a tab by id as a copy, and fails for one that is not there', async () => {
    const tabs = createMemoryViewTabs([viewTab(1), viewTab(2)]);

    const found = await tabs.get(2);
    found.title = 'changed';

    expect((await tabs.get(2)).title).toBe('T2');
    await expect(tabs.get(9)).rejects.toThrow('Invalid tab ID: 9');
  });

  it('remembers what was done', async () => {
    const tabs = createMemoryViewTabs([viewTab(1), viewTab(2)]);

    await tabs.activate(1);
    await tabs.moveTo(2, 0);
    const first = await tabs.openNew();
    const second = await tabs.openNew();
    await tabs.close(2);

    expect(second).toBe(first + 1);

    expect(tabs.calls).toEqual([
      'activate 1',
      'move 2 to 0',
      'open new',
      'open new',
      'close 2',
    ]);
    expect((await tabs.list()).map(({ id }) => id)).toEqual([1]);
  });

  it('fails to close a tab that is not there, and notes it', async () => {
    const tabs = createMemoryViewTabs();

    await expect(tabs.close(5)).rejects.toThrow('Invalid tab ID: 5');
    expect(tabs.calls).toEqual(['close 5']);
  });

  it('is shown in the tab it was told, and takes pictures only of those it has', async () => {
    const tabs = createMemoryViewTabs();
    tabs.currentTabId = 8;
    tabs.captures.set(3, 'data:x');

    await expect(tabs.currentId()).resolves.toBe(8);
    await expect(tabs.capture(3)).resolves.toBe('data:x');
    await expect(tabs.capture(4)).resolves.toBeUndefined();
  });

  it('is shown in the tab 1 unless told otherwise', async () => {
    await expect(createMemoryViewTabs().currentId()).resolves.toBe(1);
  });
});

function viewStateContract(name: string, make: () => ViewState) {
  describe(`ViewState: ${name}`, () => {
    it('has no thumbnail for a tab that has none', async () => {
      await expect(make().thumbnail(3)).resolves.toBeUndefined();
    });

    it('keeps a thumbnail and when it was taken', async () => {
      const state = make();

      await state.setThumbnail(3, { image: 'data:a', capturedAt: 500 });

      await expect(state.thumbnail(3)).resolves.toEqual({
        image: 'data:a',
        capturedAt: 500,
      });
      await expect(state.thumbnail(4)).resolves.toBeUndefined();
    });

    it('keeps a thumbnail by tab 0', async () => {
      const state = make();

      await state.setThumbnail(0, { image: 'data:z', capturedAt: 1 });

      await expect(state.thumbnail(0)).resolves.toMatchObject({
        image: 'data:z',
      });
    });

    it('keeps the layout mode of each window', async () => {
      const state = make();

      await state.setLayoutMode(1, 'tiling');
      await state.setLayoutMode(2, 'freeform');

      await expect(state.layoutMode(1)).resolves.toBe('tiling');
      await expect(state.layoutMode(2)).resolves.toBe('freeform');
      await expect(state.layoutMode(3)).resolves.toBeUndefined();
    });

    it('changes the layout mode', async () => {
      const state = make();
      await state.setLayoutMode(1, 'tiling');

      await state.setLayoutMode(1, 'freeform');

      await expect(state.layoutMode(1)).resolves.toBe('freeform');
    });
  });
}

viewStateContract('memory', createMemoryViewState);
viewStateContract('browser', () => {
  const fake = createFakeSessions();
  return createBrowserViewState(() => fake.api);
});

describe('adapters/browser/view-state.ts', () => {
  it('reads the picture an older version kept alone, with no time', async () => {
    const fake = createFakeSessions();
    const state = createBrowserViewState(() => fake.api);
    await fake.api.sessions.setTabValue(3, 'thumbnail', 'data:old');

    await expect(state.thumbnail(3)).resolves.toEqual({
      image: 'data:old',
      capturedAt: undefined,
    });
  });

  it('reads a record whose time is not a number as having no time', async () => {
    const fake = createFakeSessions();
    const state = createBrowserViewState(() => fake.api);
    await fake.api.sessions.setTabValue(3, 'thumbnail', {
      thumbnail: 'data:a',
      capturedTime: 'x',
    });

    await expect(state.thumbnail(3)).resolves.toEqual({
      image: 'data:a',
      capturedAt: undefined,
    });
  });

  it.each([[5], [null], [{}], [{ thumbnail: 5 }], [['data:x']]])(
    'has no thumbnail for the stored value %j',
    async (stored) => {
      const fake = createFakeSessions();
      const state = createBrowserViewState(() => fake.api);
      await fake.api.sessions.setTabValue(3, 'thumbnail', stored);

      await expect(state.thumbnail(3)).resolves.toBeUndefined();
    },
  );

  it('stores a thumbnail as the view always has', async () => {
    const fake = createFakeSessions();
    const state = createBrowserViewState(() => fake.api);

    await state.setThumbnail(3, { image: 'data:a', capturedAt: 5 });

    expect(fake.tabValues.get(fake.slot(3, 'thumbnail'))).toEqual({
      thumbnail: 'data:a',
      capturedTime: 5,
    });
  });

  it.each([['tiling'], ['freeform']])(
    'reads the layout mode %s',
    async (mode) => {
      const fake = createFakeSessions();
      const state = createBrowserViewState(() => fake.api);
      await fake.api.sessions.setWindowValue(1, 'layoutMode', mode);

      await expect(state.layoutMode(1)).resolves.toBe(mode);
    },
  );

  it.each([['grid'], [3], [null]])(
    'has no layout mode when %j was stored',
    async (stored) => {
      const fake = createFakeSessions();
      const state = createBrowserViewState(() => fake.api);
      await fake.api.sessions.setWindowValue(1, 'layoutMode', stored);

      await expect(state.layoutMode(1)).resolves.toBeUndefined();
    },
  );

  it('stores the layout mode as text', async () => {
    const fake = createFakeSessions();
    const state = createBrowserViewState(() => fake.api);

    await state.setLayoutMode(1, 'tiling');

    expect(fake.windowValues.get(fake.slot(1, 'layoutMode'))).toBe('tiling');
  });
});
