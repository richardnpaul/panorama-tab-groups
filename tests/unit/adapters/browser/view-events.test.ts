import { describe, expect, it, vi } from 'vitest';
import { createAppearanceSettings } from '../../../../src/js/adapters/browser/appearance-settings.js';
import {
  registerViewListeners,
  type ViewEventsApi,
  type ViewTabHandlers,
} from '../../../../src/js/adapters/browser/view-events.js';

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function emitter<Args extends unknown[], Extra extends unknown[] = []>() {
  const added: { listener: (...args: Args) => void; extra: Extra }[] = [];
  return {
    added,
    addListener: (listener: (...args: Args) => void, ...extra: Extra) => {
      added.push({ listener, extra });
    },
    fire(...args: Args) {
      added.forEach(({ listener }) => {
        listener(...args);
      });
    },
  };
}

const rawTab = (overrides: Record<string, unknown> = {}) => ({
  id: 4,
  windowId: 1,
  index: 0,
  title: 'T',
  pinned: false,
  ...overrides,
});

function setUp({ filtersSupported = true } = {}) {
  const events = {
    created: emitter<[ReturnType<typeof rawTab>]>(),
    removed: emitter<[number, { windowId: number }]>(),
    updated: emitter<
      [number, object, ReturnType<typeof rawTab>],
      [{ windowId: number; properties: string[] }?]
    >(),
    moved: emitter<[number, { windowId: number }]>(),
    attached: emitter<[number, { newWindowId: number }]>(),
    detached: emitter<[number, { oldWindowId: number }]>(),
  };
  const updatedAdd = events.updated.addListener;
  const api: ViewEventsApi = {
    tabs: {
      onCreated: events.created,
      onRemoved: events.removed,
      onUpdated: {
        addListener: (listener, ...extra) => {
          if (!filtersSupported && extra.length > 0) {
            throw new Error('Event does not support filters');
          }
          updatedAdd(listener, ...extra);
        },
      },
      onMoved: events.moved,
      onAttached: events.attached,
      onDetached: events.detached,
    },
  };
  const handlers = {
    tabCreated: vi.fn().mockResolvedValue(undefined),
    tabRemoved: vi.fn(),
    tabUpdated: vi.fn().mockResolvedValue(undefined),
    tabMoved: vi.fn().mockResolvedValue(undefined),
    tabAttached: vi.fn().mockResolvedValue(undefined),
    tabDetached: vi.fn(),
  } satisfies ViewTabHandlers;
  const logger = { error: vi.fn() };
  registerViewListeners(api, 7, handlers, logger);
  return { events, handlers, logger };
}

describe('adapters/browser/view-events.ts', () => {
  it('gives a tab that was created as the view shows it', () => {
    const { events, handlers } = setUp();

    events.created.fire(
      rawTab({ url: 'https://a/', favIconUrl: 'https://a/i', discarded: true }),
    );

    expect(handlers.tabCreated).toHaveBeenCalledWith({
      id: 4,
      windowId: 1,
      index: 0,
      title: 'T',
      url: 'https://a/',
      favIconUrl: 'https://a/i',
      pinned: false,
      discarded: true,
      lastAccessed: 0,
    });
  });

  it.each([[{ id: undefined }], [{ windowId: undefined }]])(
    'leaves out a tab with no id or window: %j',
    (missing) => {
      const { events, handlers } = setUp();

      events.created.fire(rawTab(missing));
      events.updated.fire(4, {}, rawTab(missing));

      expect(handlers.tabCreated).not.toHaveBeenCalled();
      expect(handlers.tabUpdated).not.toHaveBeenCalled();
    },
  );

  it('gives a tab with the id 0 and the window 0', () => {
    const { events, handlers } = setUp();

    events.created.fire(rawTab({ id: 0, windowId: 0 }));

    expect(handlers.tabCreated).toHaveBeenCalledTimes(1);
  });

  it('gives what the browser says of a tab that was closed, moved, attached or detached', () => {
    const { events, handlers } = setUp();

    events.removed.fire(4, { windowId: 1 });
    events.moved.fire(5, { windowId: 2 });
    events.attached.fire(6, { newWindowId: 3 });
    events.detached.fire(7, { oldWindowId: 4 });

    expect(handlers.tabRemoved).toHaveBeenCalledWith(4, { windowId: 1 });
    expect(handlers.tabMoved).toHaveBeenCalledWith(5, { windowId: 2 });
    expect(handlers.tabAttached).toHaveBeenCalledWith(6, { newWindowId: 3 });
    expect(handlers.tabDetached).toHaveBeenCalledWith(7, { oldWindowId: 4 });
  });

  it('gives the change to a tab with the tab as the view shows it', () => {
    const { events, handlers } = setUp();

    events.updated.fire(4, { pinned: true }, rawTab({ pinned: true }));

    expect(handlers.tabUpdated).toHaveBeenCalledWith(
      4,
      { pinned: true },
      expect.objectContaining({ id: 4, pinned: true }),
    );
  });

  it('listens to the changes of the window of the view, to the properties it shows', () => {
    const { events } = setUp();

    expect(events.updated.added).toHaveLength(1);
    expect(events.updated.added[0]?.extra).toEqual([
      {
        windowId: 7,
        properties: ['discarded', 'favIconUrl', 'pinned', 'title', 'status'],
      },
    ]);
  });

  it('listens to every change where the browser has no filters for them', () => {
    const { events, handlers } = setUp({ filtersSupported: false });

    expect(events.updated.added).toHaveLength(1);
    expect(events.updated.added[0]?.extra).toEqual([]);
    events.updated.fire(4, {}, rawTab());
    expect(handlers.tabUpdated).toHaveBeenCalledTimes(1);
  });

  it('adds one listener to each of the other events', () => {
    const { events } = setUp();

    [
      events.created,
      events.removed,
      events.moved,
      events.attached,
      events.detached,
    ].forEach((event) => {
      expect(event.added).toHaveLength(1);
    });
  });

  it('logs a handler that fails, with the name of the event', async () => {
    const { events, handlers, logger } = setUp();
    const failure = new Error('no');
    Object.values(handlers).forEach((handler) => {
      handler.mockRejectedValue(failure);
    });

    events.created.fire(rawTab());
    events.updated.fire(4, {}, rawTab());
    events.moved.fire(4, { windowId: 1 });
    events.attached.fire(4, { newWindowId: 1 });
    await settle();

    expect(logger.error.mock.calls.map((call) => String(call[0]))).toEqual([
      '[View] tabs.onCreated handler failed:',
      '[View] tabs.onUpdated handler failed:',
      '[View] tabs.onMoved handler failed:',
      '[View] tabs.onAttached handler failed:',
    ]);
  });
});

describe('adapters/browser/appearance-settings.ts', () => {
  function setUpSettings(stored: Record<string, unknown> = {}) {
    let listener: (
      changes: Record<string, { newValue?: unknown } | undefined>,
      areaName: string,
    ) => void = () => undefined;
    const api = {
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue(stored),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: {
          addListener: vi.fn((added: typeof listener) => {
            listener = added;
          }),
        },
      },
    };
    return {
      settings: createAppearanceSettings(() => api),
      api,
      change: (
        changes: Record<string, { newValue?: unknown } | undefined>,
        area = 'sync',
      ) => {
        listener(changes, area);
      },
    };
  }

  it('reads the settings, with the defaults where nothing is stored', async () => {
    const { settings, api } = setUpSettings({});

    await expect(settings.read()).resolves.toEqual({
      useDarkTheme: false,
      theme: 'auto',
      toolbarPosition: 'top',
    });
    expect(api.storage.sync.get).toHaveBeenCalledWith({
      useDarkTheme: false,
      theme: 'auto',
      toolbarPosition: 'top',
    });
  });

  it('reads what is stored', async () => {
    const { settings } = setUpSettings({
      useDarkTheme: true,
      theme: 'light',
      toolbarPosition: 'left',
    });

    await expect(settings.read()).resolves.toEqual({
      useDarkTheme: true,
      theme: 'light',
      toolbarPosition: 'left',
    });
  });

  it('takes the defaults for what is stored as something else', async () => {
    const { settings } = setUpSettings({
      useDarkTheme: 'yes',
      theme: 3,
      toolbarPosition: null,
    });

    await expect(settings.read()).resolves.toEqual({
      useDarkTheme: false,
      theme: 'auto',
      toolbarPosition: 'top',
    });
  });

  it('takes the defaults for stored data that is not a record', async () => {
    const { settings, api } = setUpSettings();
    api.storage.sync.get.mockResolvedValue(null);

    await expect(settings.read()).resolves.toEqual({
      useDarkTheme: false,
      theme: 'auto',
      toolbarPosition: 'top',
    });
  });

  it('keeps the dark theme as the theme and clears the old setting', async () => {
    const { settings, api } = setUpSettings();

    await settings.saveDarkTheme();

    expect(api.storage.sync.set).toHaveBeenCalledWith({
      useDarkTheme: null,
      theme: 'dark',
    });
  });

  it('tells of a change of the theme or the toolbar position in the sync storage', () => {
    const { settings, change } = setUpSettings();
    const listener = vi.fn();
    settings.onChange(listener);

    change({ theme: { newValue: 'dark' } });
    change({ toolbarPosition: { newValue: 'left' } });
    change({
      theme: { newValue: 'light' },
      toolbarPosition: { newValue: 'top' },
    });

    expect(listener.mock.calls).toEqual([
      [{ theme: 'dark' }],
      [{ toolbarPosition: 'left' }],
      [{ theme: 'light', toolbarPosition: 'top' }],
    ]);
  });

  it('does not tell of changes in another storage', () => {
    const { settings, change } = setUpSettings();
    const listener = vi.fn();
    settings.onChange(listener);

    change({ theme: { newValue: 'dark' } }, 'local');

    expect(listener).not.toHaveBeenCalled();
  });

  it('leaves out a change to something that is not text', () => {
    const { settings, change } = setUpSettings();
    const listener = vi.fn();
    settings.onChange(listener);

    change({ theme: { newValue: 5 }, toolbarPosition: {} });
    change({ theme: undefined });

    expect(listener.mock.calls).toEqual([[{}], [{}]]);
  });
});
