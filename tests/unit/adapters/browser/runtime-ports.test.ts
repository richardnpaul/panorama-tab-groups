import { describe, expect, it, vi } from 'vitest';
import { createBrowserExtension } from '../../../../src/js/adapters/browser/extension.js';
import { createBrowserMigrationFlag } from '../../../../src/js/adapters/browser/migration-flag.js';
import { createBrowserNotifications } from '../../../../src/js/adapters/browser/notifications.js';
import { createBrowserSessionHistory } from '../../../../src/js/adapters/browser/session-history.js';

describe('adapters/browser/notifications.ts', () => {
  const api = () => ({
    notifications: {
      create: vi.fn().mockResolvedValue('id'),
      clear: vi.fn().mockResolvedValue(true),
    },
  });

  it('shows a basic notification with the title, message and icon', async () => {
    const browser = api();
    const notifications = createBrowserNotifications(() => browser);

    await notifications.show('n1', {
      title: 'Title',
      message: 'Message',
      iconUrl: 'icon.png',
    });

    expect(browser.notifications.create).toHaveBeenCalledTimes(1);
    expect(browser.notifications.create).toHaveBeenCalledWith('n1', {
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Title',
      message: 'Message',
    });
  });

  it('clears a notification', async () => {
    const browser = api();
    const notifications = createBrowserNotifications(() => browser);

    await notifications.clear('n1');

    expect(browser.notifications.clear).toHaveBeenCalledTimes(1);
    expect(browser.notifications.clear).toHaveBeenCalledWith('n1');
  });

  it('passes on failures', async () => {
    const failure = new Error('no');
    const notifications = createBrowserNotifications(() => ({
      notifications: {
        create: vi.fn().mockRejectedValue(failure),
        clear: vi.fn().mockRejectedValue(failure),
      },
    }));

    await expect(
      notifications.show('n', { title: 't', message: 'm', iconUrl: 'i' }),
    ).rejects.toBe(failure);
    await expect(notifications.clear('n')).rejects.toBe(failure);
  });

  it('uses the browser that exists when it is called', async () => {
    const first = api();
    const second = api();
    let current = first;
    const notifications = createBrowserNotifications(() => current);
    current = second;

    await notifications.clear('n');

    expect(first.notifications.clear).not.toHaveBeenCalled();
    expect(second.notifications.clear).toHaveBeenCalledTimes(1);
  });
});

describe('adapters/browser/extension.ts', () => {
  const api = () => ({
    runtime: {
      getURL: vi.fn((path: string) => `moz-extension://id/${path}`),
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
    },
  });

  it('gives the address of a file of the extension', () => {
    const browser = api();
    const extension = createBrowserExtension(() => browser);

    expect(extension.urlOf('view.html')).toBe('moz-extension://id/view.html');
    expect(browser.runtime.getURL).toHaveBeenCalledWith('view.html');
  });

  it('opens the options page', async () => {
    const browser = api();
    const extension = createBrowserExtension(() => browser);

    await extension.openOptionsPage();

    expect(browser.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it('passes on a failure to open the options page', async () => {
    const failure = new Error('no');
    const browser = api();
    browser.runtime.openOptionsPage.mockRejectedValue(failure);
    const extension = createBrowserExtension(() => browser);

    await expect(extension.openOptionsPage()).rejects.toBe(failure);
  });

  it('uses the browser that exists when it is called', () => {
    const first = api();
    const second = api();
    let current = first;
    const extension = createBrowserExtension(() => current);
    current = second;

    extension.urlOf('a');

    expect(first.runtime.getURL).not.toHaveBeenCalled();
    expect(second.runtime.getURL).toHaveBeenCalledTimes(1);
  });
});

describe('adapters/browser/session-history.ts', () => {
  it('asks for one closed session', async () => {
    const getRecentlyClosed = vi.fn().mockResolvedValue([]);
    const history = createBrowserSessionHistory(() => ({
      sessions: { getRecentlyClosed },
    }));

    await history.probe();

    expect(getRecentlyClosed).toHaveBeenCalledTimes(1);
    expect(getRecentlyClosed).toHaveBeenCalledWith({ maxResults: 1 });
  });

  it('fails when the history is not available', async () => {
    const failure = new Error('disabled');
    const history = createBrowserSessionHistory(() => ({
      sessions: { getRecentlyClosed: vi.fn().mockRejectedValue(failure) },
    }));

    await expect(history.probe()).rejects.toBe(failure);
  });
});

describe('adapters/browser/migration-flag.ts', () => {
  const api = (stored: Record<string, unknown> = {}) => ({
    storage: {
      local: {
        get: vi.fn().mockResolvedValue(stored),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  });

  it('is complete when the stored flag is true', async () => {
    const browser = api({ hybridGroupsMigrationComplete: true });
    const flag = createBrowserMigrationFlag(() => browser);

    await expect(flag.isComplete()).resolves.toBe(true);

    expect(browser.storage.local.get).toHaveBeenCalledWith(
      'hybridGroupsMigrationComplete',
    );
  });

  it.each([[false], [undefined], ['yes'], [1]])(
    'is not complete when the stored flag is %s',
    async (value) => {
      const flag = createBrowserMigrationFlag(() =>
        api({ hybridGroupsMigrationComplete: value }),
      );

      await expect(flag.isComplete()).resolves.toBe(false);
    },
  );

  it('is not complete when nothing is stored', async () => {
    const flag = createBrowserMigrationFlag(() => api());

    await expect(flag.isComplete()).resolves.toBe(false);
  });

  it('stores the flag', async () => {
    const browser = api();
    const flag = createBrowserMigrationFlag(() => browser);

    await flag.setComplete(true);
    await flag.setComplete(false);

    expect(browser.storage.local.set.mock.calls).toEqual([
      [{ hybridGroupsMigrationComplete: true }],
      [{ hybridGroupsMigrationComplete: false }],
    ]);
  });

  it('passes on failures', async () => {
    const failure = new Error('no');
    const flag = createBrowserMigrationFlag(() => ({
      storage: {
        local: {
          get: vi.fn().mockRejectedValue(failure),
          set: vi.fn().mockRejectedValue(failure),
        },
      },
    }));

    await expect(flag.isComplete()).rejects.toBe(failure);
    await expect(flag.setComplete(true)).rejects.toBe(failure);
  });
});
