import { afterEach, describe, expect, it, vi } from 'vitest';

/** An event that remembers that a listener was added to it */
const event = () => ({ addListener: vi.fn() });

function fakeBrowser() {
  return {
    action: { onClicked: event() },
    commands: { onCommand: event() },
    windows: { onCreated: event() },
    tabs: {
      onCreated: event(),
      onAttached: event(),
      onDetached: event(),
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
    },
    storage: { onChanged: event() },
    runtime: {
      onMessage: event(),
      onMessageExternal: event(),
      onInstalled: event(),
    },
    contextMenus: { onClicked: event() },
  };
}

type FakeBrowser = ReturnType<typeof fakeBrowser>;

const listenerCount = (browser: FakeBrowser): number[] => [
  browser.action.onClicked.addListener.mock.calls.length,
  browser.commands.onCommand.addListener.mock.calls.length,
  browser.windows.onCreated.addListener.mock.calls.length,
  browser.tabs.onCreated.addListener.mock.calls.length,
  browser.tabs.onAttached.addListener.mock.calls.length,
  browser.tabs.onDetached.addListener.mock.calls.length,
  browser.tabs.onActivated.addListener.mock.calls.length,
  browser.tabs.onUpdated.addListener.mock.calls.length,
  browser.tabs.onRemoved.addListener.mock.calls.length,
  browser.storage.onChanged.addListener.mock.calls.length,
  browser.runtime.onMessage.addListener.mock.calls.length,
  browser.runtime.onMessageExternal.addListener.mock.calls.length,
  browser.runtime.onInstalled.addListener.mock.calls.length,
  browser.contextMenus.onClicked.addListener.mock.calls.length,
];

async function load(init: () => Promise<void>) {
  vi.resetModules();
  const browser = fakeBrowser();
  const handlers = { marker: 'handlers' };
  const register = vi.fn();
  vi.stubGlobal('browser', browser);
  vi.doMock('../../../src/js/polyfill.js', () => ({}));
  vi.doMock('../../../src/js/adapters/browser/events.js', () => ({
    registerListeners: register,
  }));
  vi.doMock('../../../src/js/background/compose.js', () => ({
    composeBackground: () => ({ handlers, init }),
  }));
  await import('../../../src/js/background/main.js');
  return { browser, handlers, register };
}

describe('background/main.ts', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/js/polyfill.js');
    vi.doUnmock('../../../src/js/adapters/browser/events.js');
    vi.doUnmock('../../../src/js/background/compose.js');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands the browser and the handlers over to be listened with, as soon as it is loaded', async () => {
    const { browser, handlers, register } = await load(() => Promise.resolve());

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(browser, handlers, console);
  });

  it('starts up after it has listened, not before', async () => {
    const order: string[] = [];
    vi.resetModules();
    vi.stubGlobal('browser', fakeBrowser());
    vi.doMock('../../../src/js/polyfill.js', () => ({}));
    vi.doMock('../../../src/js/adapters/browser/events.js', () => ({
      registerListeners: () => {
        order.push('listen');
      },
    }));
    vi.doMock('../../../src/js/background/compose.js', () => ({
      composeBackground: () => ({
        handlers: {},
        init: () => {
          order.push('init');
          return Promise.resolve();
        },
      }),
    }));

    await import('../../../src/js/background/main.js');

    expect(order).toEqual(['listen', 'init']);
  });

  it('says so when the start-up fails, rather than leaving it unhandled', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const failure = new Error('no windows');

    await load(() => Promise.reject(failure));
    await Promise.resolve();
    await Promise.resolve();

    expect(error).toHaveBeenCalledWith(
      '[Initialization] Start-up failed:',
      failure,
    );
  });

  it('does not touch the events itself', async () => {
    const { browser } = await load(() => Promise.resolve());

    expect(listenerCount(browser).every((count) => count === 0)).toBe(true);
  });
});
