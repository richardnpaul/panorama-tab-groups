import { describe, expect, it, vi } from 'vitest';
import {
  registerListeners,
  type BackgroundHandlers,
  type EventsApi,
} from '../../../../src/js/adapters/browser/events.js';

/** An event that remembers its listener, to be fired by the test */
function emitter<Args extends unknown[], Result = void>() {
  const listeners: ((...args: Args) => Result)[] = [];
  return {
    addListener: (listener: (...args: Args) => Result) => {
      listeners.push(listener);
    },
    listeners,
    fire(...args: Args): Result | undefined {
      return listeners.at(0)?.(...args);
    },
  };
}

function setUp({ withTabGroups = true }: { withTabGroups?: boolean } = {}) {
  const events = {
    onClicked: emitter<[unknown]>(),
    onCommand: emitter<[string]>(),
    windowCreated: emitter<[{ id?: number | undefined }]>(),
    tabCreated: emitter<
      [
        {
          id?: number;
          windowId?: number;
          active?: boolean;
          url?: string;
          pendingUrl?: string;
        },
      ]
    >(),
    tabAttached: emitter<[number, { newWindowId: number }]>(),
    tabDetached: emitter<[number]>(),
    tabActivated: emitter<[{ tabId: number }]>(),
    tabUpdated: emitter<[number, { url?: string }, { url?: string }]>(),
    tabRemoved: emitter<[number, unknown]>(),
    groupRemoved: emitter<[{ id: number; windowId: number; title?: string }]>(),
    groupUpdated: emitter<[{ id: number; windowId: number; title?: string }]>(),
    storageChanged:
      emitter<
        [Record<string, { oldValue?: unknown; newValue?: unknown }>, string]
      >(),
    message: emitter<
      [unknown, unknown, (response?: unknown) => void],
      boolean
    >(),
    external: emitter<[unknown]>(),
    menuClicked:
      emitter<
        [
          { menuItemId: string | number },
          { id?: number; windowId?: number } | undefined,
        ]
      >(),
  };
  const api: EventsApi = {
    action: { onClicked: events.onClicked },
    commands: { onCommand: events.onCommand },
    windows: { onCreated: events.windowCreated },
    tabs: {
      onCreated: events.tabCreated,
      onAttached: events.tabAttached,
      onDetached: events.tabDetached,
      onActivated: events.tabActivated,
      onUpdated: events.tabUpdated,
      onRemoved: events.tabRemoved,
    },
    ...(withTabGroups
      ? {
          tabGroups: {
            onRemoved: events.groupRemoved,
            onUpdated: events.groupUpdated,
          },
        }
      : {}),
    storage: { onChanged: events.storageChanged },
    runtime: {
      onMessage: events.message,
      onMessageExternal: events.external,
    },
    contextMenus: { onClicked: events.menuClicked },
  };
  const handlers = {
    toggleView: vi.fn().mockResolvedValue(undefined),
    triggerCommand: vi.fn().mockResolvedValue(undefined),
    createGroupInWindowIfMissing: vi.fn().mockResolvedValue(undefined),
    tabCreated: vi.fn().mockResolvedValue(undefined),
    tabAttached: vi.fn().mockResolvedValue(undefined),
    tabDetached: vi.fn().mockResolvedValue(undefined),
    tabActivated: vi.fn().mockResolvedValue(undefined),
    tabUpdated: vi.fn().mockResolvedValue(undefined),
    tabRemoved: vi.fn(),
    menuClicked: vi.fn().mockResolvedValue(undefined),
    handleMessage: vi.fn().mockResolvedValue('answer'),
    handleExternalMessage: vi.fn().mockResolvedValue(undefined),
    storageChanged: vi.fn().mockResolvedValue(undefined),
    nativeGroupRemoved: vi.fn().mockResolvedValue(undefined),
    nativeGroupUpdated: vi.fn().mockResolvedValue(undefined),
  } satisfies BackgroundHandlers;
  const logger = { error: vi.fn() };
  registerListeners(api, handlers, logger);
  return { events, handlers, logger };
}

// Lets what was started by an event run to its end
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe('adapters/browser/events.ts', () => {
  it('adds one listener to every event', () => {
    const { events } = setUp();

    Object.values(events).forEach((event) => {
      expect(event.listeners).toHaveLength(1);
    });
  });

  it('adds the listeners at once, before anything has been awaited', () => {
    const { events, handlers } = setUp();

    expect(events.onClicked.listeners).toHaveLength(1);
    expect(handlers.toggleView).not.toHaveBeenCalled();
  });

  it('toggles the view when the button is clicked, whatever the click says', () => {
    const { events, handlers } = setUp();

    events.onClicked.fire({ id: 4 });

    expect(handlers.toggleView).toHaveBeenCalledTimes(1);
    expect(handlers.toggleView).toHaveBeenCalledWith();
  });

  it('gives a shortcut to the commands', () => {
    const { events, handlers } = setUp();

    events.onCommand.fire('activate-next-group');

    expect(handlers.triggerCommand).toHaveBeenCalledWith('activate-next-group');
  });

  it('gives the id of a window that was created, and ignores one without', () => {
    const { events, handlers } = setUp();

    events.windowCreated.fire({ id: 5 });
    events.windowCreated.fire({});

    expect(handlers.createGroupInWindowIfMissing).toHaveBeenCalledTimes(1);
    expect(handlers.createGroupInWindowIfMissing).toHaveBeenCalledWith(5);
  });

  it('gives what is known of a tab that was created, and nothing else of it', () => {
    const { events, handlers } = setUp();

    events.tabCreated.fire({
      id: 7,
      windowId: 2,
      active: true,
      url: 'https://a/',
      pendingUrl: 'https://b/',
    });

    expect(handlers.tabCreated).toHaveBeenCalledWith({
      id: 7,
      windowId: 2,
      active: true,
      url: 'https://a/',
      pendingUrl: 'https://b/',
    });
  });

  it('gives a tab with the id 0 and the window 0', () => {
    const { events, handlers } = setUp();

    events.tabCreated.fire({ id: 0, windowId: 0 });

    expect(handlers.tabCreated).toHaveBeenCalledTimes(1);
  });

  it.each([[{ id: 7 }], [{ windowId: 2 }], [{}]])(
    'ignores a created tab that has no id or no window: %j',
    (tab) => {
      const { events, handlers } = setUp();

      events.tabCreated.fire(tab);

      expect(handlers.tabCreated).not.toHaveBeenCalled();
    },
  );

  it('gives the other tab events to their handlers', () => {
    const { events, handlers } = setUp();

    events.tabAttached.fire(3, { newWindowId: 9 });
    events.tabDetached.fire(3);
    events.tabActivated.fire({ tabId: 3 });
    events.tabUpdated.fire(3, { url: 'x' }, { url: 'y' });

    expect(handlers.tabAttached).toHaveBeenCalledWith(3, { newWindowId: 9 });
    expect(handlers.tabDetached).toHaveBeenCalledWith(3);
    expect(handlers.tabActivated).toHaveBeenCalledWith({ tabId: 3 });
    expect(handlers.tabUpdated).toHaveBeenCalledWith(
      3,
      { url: 'x' },
      { url: 'y' },
    );
  });

  it('gives only the id of a tab that was closed', () => {
    const { events, handlers } = setUp();

    events.tabRemoved.fire(3, { windowId: 1 });

    expect(handlers.tabRemoved).toHaveBeenCalledTimes(1);
    expect(handlers.tabRemoved).toHaveBeenCalledWith(3);
  });

  it('gives the changes to native tab groups', () => {
    const { events, handlers } = setUp();

    events.groupRemoved.fire({ id: 1, windowId: 2 });
    events.groupUpdated.fire({ id: 1, windowId: 2, title: 'T' });

    expect(handlers.nativeGroupRemoved).toHaveBeenCalledWith({
      id: 1,
      windowId: 2,
    });
    expect(handlers.nativeGroupUpdated).toHaveBeenCalledWith({
      id: 1,
      windowId: 2,
      title: 'T',
    });
  });

  it('copes with a browser that has no native tab groups', () => {
    const { events, handlers } = setUp({ withTabGroups: false });

    expect(events.groupRemoved.listeners).toHaveLength(0);
    expect(events.tabCreated.listeners).toHaveLength(1);
    expect(handlers.nativeGroupRemoved).not.toHaveBeenCalled();
  });

  it('gives the settings that changed and where', () => {
    const { events, handlers } = setUp();
    const changes = { useNativeGroups: { oldValue: true, newValue: false } };

    events.storageChanged.fire(changes, 'sync');

    expect(handlers.storageChanged).toHaveBeenCalledWith(changes, 'sync');
  });

  it('gives the menu click and the tab it was on', () => {
    const { events, handlers } = setUp();

    events.menuClicked.fire({ menuItemId: '3' }, { id: 4, windowId: 1 });
    events.menuClicked.fire({ menuItemId: 'refresh-groups' }, undefined);

    expect(handlers.menuClicked).toHaveBeenNthCalledWith(
      1,
      { menuItemId: '3' },
      { id: 4, windowId: 1 },
    );
    expect(handlers.menuClicked).toHaveBeenNthCalledWith(
      2,
      { menuItemId: 'refresh-groups' },
      undefined,
    );
  });

  it('gives external messages to their handler', () => {
    const { events, handlers } = setUp();

    events.external.fire('activate-next-group');

    expect(handlers.handleExternalMessage).toHaveBeenCalledWith(
      'activate-next-group',
    );
  });

  describe('messages from the extension pages', () => {
    it('answers with what the handler gives, and keeps the channel open for it', async () => {
      const { events, handlers } = setUp();
      const sendResponse = vi.fn();
      const message = { action: 'refreshView' };

      const keepOpen = events.message.fire(
        message,
        { id: 'sender' },
        sendResponse,
      );
      await settle();

      expect(keepOpen).toBe(true);
      expect(handlers.handleMessage).toHaveBeenCalledWith(message);
      expect(sendResponse).toHaveBeenCalledTimes(1);
      expect(sendResponse).toHaveBeenCalledWith('answer');
    });

    it('answers with an error, and logs it, when the handler fails', async () => {
      const { events, handlers, logger } = setUp();
      const failure = new Error('boom');
      handlers.handleMessage.mockRejectedValue(failure);
      const sendResponse = vi.fn();

      events.message.fire({ action: 'x' }, undefined, sendResponse);
      await settle();

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'The background failed to handle the message',
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[runtime.onMessage] handler failed:',
        failure,
      );
    });
  });

  describe('when a handler fails', () => {
    it('logs it with the name of the event, instead of leaving it unhandled', async () => {
      const { events, handlers, logger } = setUp();
      const failure = new Error('boom');
      handlers.toggleView.mockRejectedValue(failure);

      events.onClicked.fire({});
      await settle();

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        '[action.onClicked] handler failed:',
        failure,
      );
    });

    it('logs it for each kind of event', async () => {
      const { events, handlers, logger } = setUp();
      Object.values(handlers).forEach((handler) => {
        handler.mockRejectedValue(new Error('boom'));
      });

      events.onCommand.fire('c');
      events.windowCreated.fire({ id: 1 });
      events.tabCreated.fire({ id: 1, windowId: 1 });
      events.tabAttached.fire(1, { newWindowId: 1 });
      events.tabDetached.fire(1);
      events.tabActivated.fire({ tabId: 1 });
      events.tabUpdated.fire(1, {}, {});
      events.groupRemoved.fire({ id: 1, windowId: 1 });
      events.groupUpdated.fire({ id: 1, windowId: 1 });
      events.storageChanged.fire({}, 'sync');
      events.external.fire('x');
      events.menuClicked.fire({ menuItemId: '1' }, undefined);
      await settle();

      expect(logger.error.mock.calls.map((call) => String(call[0]))).toEqual([
        '[commands.onCommand] handler failed:',
        '[windows.onCreated] handler failed:',
        '[tabs.onCreated] handler failed:',
        '[tabs.onAttached] handler failed:',
        '[tabs.onDetached] handler failed:',
        '[tabs.onActivated] handler failed:',
        '[tabs.onUpdated] handler failed:',
        '[tabGroups.onRemoved] handler failed:',
        '[tabGroups.onUpdated] handler failed:',
        '[storage.onChanged] handler failed:',
        '[runtime.onMessageExternal] handler failed:',
        '[contextMenus.onClicked] handler failed:',
      ]);
    });
  });
});
