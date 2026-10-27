// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const startOptions = vi.fn<() => Promise<void>>();

async function load() {
  vi.resetModules();
  const order: string[] = [];
  let domReady: (() => void) | undefined;
  vi.doMock('../../../src/js/polyfill.js', () => {
    order.push('polyfill');
    return {};
  });
  vi.doMock('../../../src/js/options/start.js', () => {
    order.push('start');
    return { startOptions };
  });
  vi.spyOn(document, 'addEventListener').mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'DOMContentLoaded' && typeof listener === 'function') {
        domReady = () => {
          listener(new Event('DOMContentLoaded'));
        };
      }
    },
  );
  await import('../../../src/js/options/index.js');
  return { order, domReady };
}

describe('options/index.ts', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/js/polyfill.js');
    vi.doUnmock('../../../src/js/options/start.js');
    vi.restoreAllMocks();
    startOptions.mockReset();
  });

  it('loads the polyfill before anything that uses the browser', async () => {
    const { order } = await load();

    expect(order).toEqual(['polyfill', 'start']);
  });

  it('starts when the page has loaded, not before', async () => {
    startOptions.mockResolvedValue(undefined);
    const { domReady } = await load();

    expect(startOptions).not.toHaveBeenCalled();
    domReady?.();

    expect(startOptions).toHaveBeenCalledTimes(1);
  });

  it('logs a failure to start instead of leaving it unhandled', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const failure = new Error('storage is gone');
    startOptions.mockRejectedValue(failure);
    const { domReady } = await load();

    domReady?.();

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        '[Options] Event handler failed:',
        failure,
      );
    });
  });
});
