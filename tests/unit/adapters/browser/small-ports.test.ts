import { describe, expect, it, vi } from 'vitest';
import { createBrowserI18n } from '../../../../src/js/adapters/browser/i18n.js';
import { createBrowserMessaging } from '../../../../src/js/adapters/browser/messaging.js';
import { createBrowserTabs } from '../../../../src/js/adapters/browser/tabs.js';

describe('adapters/browser/messaging.ts', () => {
  it('sends the message through the runtime and gives back the answer', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    const messaging = createBrowserMessaging(() => ({
      runtime: { sendMessage },
    }));

    await expect(messaging.send({ action: 'ping' })).resolves.toEqual({
      success: true,
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ action: 'ping' });
  });

  it('passes on a failure to deliver', async () => {
    const failure = new Error('no receiver');
    const messaging = createBrowserMessaging(() => ({
      runtime: { sendMessage: vi.fn().mockRejectedValue(failure) },
    }));

    await expect(messaging.send({})).rejects.toBe(failure);
  });

  it('uses the browser that exists when it is called', async () => {
    const first = vi.fn().mockResolvedValue('first');
    const second = vi.fn().mockResolvedValue('second');
    let current = first;
    const messaging = createBrowserMessaging(() => ({
      runtime: { sendMessage: current },
    }));
    current = second;

    await expect(messaging.send({})).resolves.toBe('second');
    expect(first).not.toHaveBeenCalled();
  });
});

describe('adapters/browser/tabs.ts', () => {
  it('lists the ids of the tabs in the current window', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 4 }, { id: 9 }]);
    const tabs = createBrowserTabs(() => ({ tabs: { query } }));

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([4, 9]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ currentWindow: true });
  });

  it('leaves out tabs that have no id', async () => {
    const tabs = createBrowserTabs(() => ({
      tabs: { query: vi.fn().mockResolvedValue([{ id: 4 }, {}, { id: 0 }]) },
    }));

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([4, 0]);
  });

  it('gives an empty list for a window without tabs', async () => {
    const tabs = createBrowserTabs(() => ({
      tabs: { query: vi.fn().mockResolvedValue([]) },
    }));

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([]);
  });

  it('uses the browser that exists when it is called', async () => {
    let query = vi.fn().mockResolvedValue([{ id: 1 }]);
    const tabs = createBrowserTabs(() => ({ tabs: { query } }));
    query = vi.fn().mockResolvedValue([{ id: 2 }]);

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([2]);
  });
});

describe('adapters/browser/i18n.ts', () => {
  it('asks the browser for the translated message', () => {
    const getMessage = vi.fn().mockReturnValue('Gruppe');
    const i18n = createBrowserI18n(() => ({ i18n: { getMessage } }));

    expect(i18n.getMessage('defaultGroupName')).toBe('Gruppe');

    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(getMessage).toHaveBeenCalledWith('defaultGroupName');
  });

  it('uses the browser that exists when it is called', () => {
    let getMessage = vi.fn().mockReturnValue('one');
    const i18n = createBrowserI18n(() => ({ i18n: { getMessage } }));
    getMessage = vi.fn().mockReturnValue('two');

    expect(i18n.getMessage('x')).toBe('two');
  });
});
