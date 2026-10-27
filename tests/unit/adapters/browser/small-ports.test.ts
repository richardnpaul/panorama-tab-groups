import { describe, expect, it, vi } from 'vitest';
import { createBrowserI18n } from '../../../../src/js/adapters/browser/i18n.js';
import { createBrowserMessaging } from '../../../../src/js/adapters/browser/messaging.js';
import {
  createBrowserTabs,
  type TabsApi,
} from '../../../../src/js/adapters/browser/tabs.js';

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
  const api = (overrides: Partial<TabsApi['tabs']> = {}): TabsApi => ({
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: 1, windowId: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: 50 }),
      hide: vi.fn().mockResolvedValue([]),
      show: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
  });

  describe('listIdsInCurrentWindow', () => {
    it('lists the ids of the tabs in the current window', async () => {
      const query = vi.fn().mockResolvedValue([{ id: 4 }, { id: 9 }]);
      const tabs = createBrowserTabs(() => api({ query }));

      await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([4, 9]);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({ currentWindow: true });
    });

    it('leaves out tabs that have no id', async () => {
      const query = vi.fn().mockResolvedValue([{ id: 4 }, {}, { id: 0 }]);
      const tabs = createBrowserTabs(() => api({ query }));

      await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([4, 0]);
    });

    it('gives an empty list for a window without tabs', async () => {
      const tabs = createBrowserTabs(() => api());

      await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([]);
    });
  });

  describe('listInCurrentWindow', () => {
    it('lists the tabs of the current window with what is needed to show them', async () => {
      const query = vi.fn().mockResolvedValue([
        { id: 4, pinned: true, lastAccessed: 100, title: 'ignored' },
        { id: 9, pinned: false, lastAccessed: 200 },
      ]);
      const tabs = createBrowserTabs(() => api({ query }));

      await expect(tabs.listInCurrentWindow()).resolves.toEqual([
        { id: 4, pinned: true, lastAccessed: 100 },
        { id: 9, pinned: false, lastAccessed: 200 },
      ]);

      expect(query).toHaveBeenCalledWith({ currentWindow: true });
    });

    it('leaves out tabs that have no id and uses 0 for a missing time', async () => {
      const query = vi
        .fn()
        .mockResolvedValue([{ pinned: false }, { id: 3, pinned: false }]);
      const tabs = createBrowserTabs(() => api({ query }));

      await expect(tabs.listInCurrentWindow()).resolves.toEqual([
        { id: 3, pinned: false, lastAccessed: 0 },
      ]);
    });
  });

  describe('get', () => {
    it('gives what is known about a tab', async () => {
      const get = vi.fn().mockResolvedValue({
        id: 5,
        windowId: 2,
        active: true,
        pinned: true,
        url: 'https://example.com/',
        pendingUrl: 'https://pending.example/',
        title: 'Example',
        groupId: 17,
        index: 4,
      });
      const tabs = createBrowserTabs(() => api({ get }));

      await expect(tabs.get(5)).resolves.toEqual({
        id: 5,
        windowId: 2,
        active: true,
        pinned: true,
        url: 'https://example.com/',
        pendingUrl: 'https://pending.example/',
        title: 'Example',
        browserGroupId: 17,
      });

      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith(5);
    });

    it('treats what the browser leaves out as not set', async () => {
      const tabs = createBrowserTabs(() =>
        api({ get: vi.fn().mockResolvedValue({ windowId: 2 }) }),
      );

      await expect(tabs.get(5)).resolves.toEqual({
        id: 5,
        windowId: 2,
        active: false,
        pinned: false,
        url: undefined,
        pendingUrl: undefined,
        title: undefined,
        browserGroupId: undefined,
      });
    });

    it('fails for a tab the browser says no window for', async () => {
      const tabs = createBrowserTabs(() =>
        api({ get: vi.fn().mockResolvedValue({ id: 5 }) }),
      );

      await expect(tabs.get(5)).rejects.toThrow('Tab 5 has no window');
    });

    it('passes on a failure', async () => {
      const failure = new Error('Invalid tab ID: 5');
      const tabs = createBrowserTabs(() =>
        api({ get: vi.fn().mockRejectedValue(failure) }),
      );

      await expect(tabs.get(5)).rejects.toBe(failure);
    });
  });

  describe('listInWindow', () => {
    it('lists the tabs of the window it is asked about', async () => {
      const query = vi.fn().mockResolvedValue([
        { id: 4, windowId: 9, active: true, groupId: -1 },
        { id: 6, windowId: 9, pinned: true, title: 'T' },
      ]);
      const tabs = createBrowserTabs(() => api({ query }));

      const listed = await tabs.listInWindow(9);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({ windowId: 9 });
      expect(listed).toEqual([
        {
          id: 4,
          windowId: 9,
          active: true,
          pinned: false,
          url: undefined,
          pendingUrl: undefined,
          title: undefined,
          browserGroupId: -1,
        },
        {
          id: 6,
          windowId: 9,
          active: false,
          pinned: true,
          url: undefined,
          pendingUrl: undefined,
          title: 'T',
          browserGroupId: undefined,
        },
      ]);
    });

    it('uses the window it asked about for a tab that does not say', async () => {
      const tabs = createBrowserTabs(() =>
        api({ query: vi.fn().mockResolvedValue([{ id: 4 }]) }),
      );

      expect((await tabs.listInWindow(9))[0]?.windowId).toBe(9);
    });

    it('leaves out tabs that have no id', async () => {
      const tabs = createBrowserTabs(() =>
        api({ query: vi.fn().mockResolvedValue([{ windowId: 9 }, { id: 2 }]) }),
      );

      expect((await tabs.listInWindow(9)).map(({ id }) => id)).toEqual([2]);
    });
  });

  describe('highlightedIdsInWindow and visibleIdsInWindow', () => {
    it('asks for the selected tabs of the window', async () => {
      const query = vi.fn().mockResolvedValue([{ id: 4 }, {}, { id: 9 }]);
      const tabs = createBrowserTabs(() => api({ query }));

      await expect(tabs.highlightedIdsInWindow(3)).resolves.toEqual([4, 9]);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({ windowId: 3, highlighted: true });
    });

    it('asks for the tabs of the window that are not hidden', async () => {
      const query = vi.fn().mockResolvedValue([{ id: 2 }, { id: 0 }, {}]);
      const tabs = createBrowserTabs(() => api({ query }));

      await expect(tabs.visibleIdsInWindow(3)).resolves.toEqual([2, 0]);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({ windowId: 3, hidden: false });
    });
  });

  describe('moveToEnd', () => {
    it('moves the tab after all the others', async () => {
      const move = vi.fn().mockResolvedValue(undefined);
      const tabs = createBrowserTabs(() => api({ move }));

      await tabs.moveToEnd(8);

      expect(move).toHaveBeenCalledTimes(1);
      expect(move).toHaveBeenCalledWith(8, { index: -1 });
    });

    it('passes on a failure', async () => {
      const failure = new Error('no such tab');
      const tabs = createBrowserTabs(() =>
        api({ move: vi.fn().mockRejectedValue(failure) }),
      );

      await expect(tabs.moveToEnd(8)).rejects.toBe(failure);
    });
  });

  describe('close', () => {
    it('closes the tab', async () => {
      const remove = vi.fn().mockResolvedValue(undefined);
      const tabs = createBrowserTabs(() => api({ remove }));

      await tabs.close(6);

      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith(6);
    });

    it('passes on a failure', async () => {
      const failure = new Error('already closed');
      const tabs = createBrowserTabs(() =>
        api({ remove: vi.fn().mockRejectedValue(failure) }),
      );

      await expect(tabs.close(6)).rejects.toBe(failure);
    });
  });

  describe('snapshotsInWindow', () => {
    it('gives what a backup keeps of the tabs of the window, in order', async () => {
      const query = vi.fn().mockResolvedValue([
        {
          id: 4,
          url: 'https://a/',
          title: 'A',
          index: 0,
          lastAccessed: 100,
          pinned: true,
          groupId: 8,
        },
        { id: 9, url: 'https://b/', title: 'B', index: 1, lastAccessed: 200 },
      ]);
      const tabs = createBrowserTabs(() => api({ query }));

      await expect(tabs.snapshotsInWindow(3)).resolves.toEqual([
        {
          id: 4,
          url: 'https://a/',
          title: 'A',
          index: 0,
          lastAccessed: 100,
          pinned: true,
        },
        {
          id: 9,
          url: 'https://b/',
          title: 'B',
          index: 1,
          lastAccessed: 200,
          pinned: false,
        },
      ]);
      expect(query).toHaveBeenCalledWith({ windowId: 3 });
    });

    it('uses the place in the list for a tab without an index, 0 for no time, and leaves out tabs without an id', async () => {
      const query = vi.fn().mockResolvedValue([{}, { id: 6 }]);
      const tabs = createBrowserTabs(() => api({ query }));

      await expect(tabs.snapshotsInWindow(3)).resolves.toEqual([
        {
          id: 6,
          url: undefined,
          title: undefined,
          index: 1,
          lastAccessed: 0,
          pinned: false,
        },
      ]);
    });
  });

  describe('create', () => {
    it('opens the page in the window, as asked, and gives the id', async () => {
      const create = vi.fn().mockResolvedValue({ id: 12 });
      const tabs = createBrowserTabs(() => api({ create }));
      const options = {
        url: 'https://a/',
        windowId: 3,
        active: false,
        discarded: true,
        pinned: false,
      };

      await expect(tabs.create(options)).resolves.toBe(12);

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(options);
    });

    it('fails when the browser gives the new tab no id', async () => {
      const tabs = createBrowserTabs(() =>
        api({ create: vi.fn().mockResolvedValue({}) }),
      );

      await expect(
        tabs.create({
          url: 'https://a/',
          windowId: 3,
          active: false,
          discarded: false,
          pinned: false,
        }),
      ).rejects.toThrow('The new tab for https://a/ has no id');
    });

    it('passes on a refusal', async () => {
      const failure = new Error('refused');
      const tabs = createBrowserTabs(() =>
        api({ create: vi.fn().mockRejectedValue(failure) }),
      );

      await expect(
        tabs.create({
          url: 'x',
          windowId: 1,
          active: false,
          discarded: false,
          pinned: false,
        }),
      ).rejects.toBe(failure);
    });
  });

  describe('open', () => {
    it('opens the page in a new tab and gives its id', async () => {
      const create = vi.fn().mockResolvedValue({ id: 31 });
      const tabs = createBrowserTabs(() => api({ create }));

      await expect(tabs.open('/view.html', true)).resolves.toBe(31);

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({ url: '/view.html', active: true });
    });

    it('can open it in the background', async () => {
      const create = vi.fn().mockResolvedValue({ id: 31 });
      const tabs = createBrowserTabs(() => api({ create }));

      await tabs.open('https://example.com/', false);

      expect(create).toHaveBeenCalledWith({
        url: 'https://example.com/',
        active: false,
      });
    });

    it('accepts the tab id 0', async () => {
      const tabs = createBrowserTabs(() =>
        api({ create: vi.fn().mockResolvedValue({ id: 0 }) }),
      );

      await expect(tabs.open('/a', true)).resolves.toBe(0);
    });

    it('fails when the browser gives the new tab no id', async () => {
      const tabs = createBrowserTabs(() =>
        api({ create: vi.fn().mockResolvedValue({}) }),
      );

      await expect(tabs.open('/a', true)).rejects.toThrow(
        'The new tab for /a has no id',
      );
    });
  });

  describe('activate', () => {
    it('makes the tab the active one', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      const tabs = createBrowserTabs(() => api({ update }));

      await tabs.activate(7);

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(7, { active: true });
    });

    it('passes on a failure', async () => {
      const failure = new Error('no such tab');
      const tabs = createBrowserTabs(() =>
        api({ update: vi.fn().mockRejectedValue(failure) }),
      );

      await expect(tabs.activate(7)).rejects.toBe(failure);
    });
  });

  describe('hide and show', () => {
    it('hides and shows the tabs', async () => {
      const hide = vi.fn().mockResolvedValue([1, 2]);
      const show = vi.fn().mockResolvedValue(undefined);
      const tabs = createBrowserTabs(() => api({ hide, show }));

      await tabs.hide([1, 2]);
      await tabs.show([3]);

      expect(hide).toHaveBeenCalledWith([1, 2]);
      expect(show).toHaveBeenCalledWith([3]);
    });

    it('passes on a failure', async () => {
      const failure = new Error('cannot hide');
      const tabs = createBrowserTabs(() =>
        api({
          hide: vi.fn().mockRejectedValue(failure),
          show: vi.fn().mockRejectedValue(failure),
        }),
      );

      await expect(tabs.hide([1])).rejects.toBe(failure);
      await expect(tabs.show([1])).rejects.toBe(failure);
    });
  });

  it('uses the browser that exists when it is called', async () => {
    let query = vi.fn().mockResolvedValue([{ id: 1 }]);
    const tabs = createBrowserTabs(() => api({ query }));
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

  it('puts the substitutions in the message, as a copy', () => {
    const getMessage = vi.fn().mockReturnValue('Close 3 tabs?');
    const i18n = createBrowserI18n(() => ({ i18n: { getMessage } }));
    const substitutions = ['3'];

    expect(i18n.getMessage('closeGroupWarning', substitutions)).toBe(
      'Close 3 tabs?',
    );

    expect(getMessage).toHaveBeenCalledWith('closeGroupWarning', ['3']);
    expect(getMessage.mock.calls[0]?.[1]).not.toBe(substitutions);
  });

  it('uses the browser that exists when it is called', () => {
    let getMessage = vi.fn().mockReturnValue('one');
    const i18n = createBrowserI18n(() => ({ i18n: { getMessage } }));
    getMessage = vi.fn().mockReturnValue('two');

    expect(i18n.getMessage('x')).toBe('two');
  });
});
