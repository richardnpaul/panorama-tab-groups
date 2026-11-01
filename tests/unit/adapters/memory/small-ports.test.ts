import { describe, expect, it } from 'vitest';
import { createMemoryMessaging } from '../../../../src/js/adapters/memory/messaging.js';
import { createMemoryTabs } from '../../../../src/js/adapters/memory/tabs.js';

describe('adapters/memory/messaging.ts', () => {
  it('records the messages in the order they were sent', async () => {
    const messaging = createMemoryMessaging();

    await messaging.send({ action: 'one' });
    await messaging.send({ action: 'two' });

    expect(messaging.sent).toEqual([{ action: 'one' }, { action: 'two' }]);
  });

  it('answers undefined until told what to answer', async () => {
    const messaging = createMemoryMessaging();

    await expect(messaging.send({})).resolves.toBeUndefined();
  });

  it('answers with what it was told to, for every message after that', async () => {
    const messaging = createMemoryMessaging();
    messaging.reply({ success: true });

    await expect(messaging.send({})).resolves.toEqual({ success: true });
    await expect(messaging.send({})).resolves.toEqual({ success: true });
  });

  it('fails with the error it was told to fail with', async () => {
    const messaging = createMemoryMessaging();
    const failure = new Error('no receiver');
    messaging.fail(failure);

    await expect(messaging.send({ action: 'x' })).rejects.toBe(failure);
    expect(messaging.sent).toEqual([{ action: 'x' }]);
  });

  it('goes back to answering after a failure when told to reply again', async () => {
    const messaging = createMemoryMessaging();
    messaging.fail(new Error('down'));
    messaging.reply('back');

    await expect(messaging.send({})).resolves.toBe('back');
  });
});

describe('adapters/memory/tabs.ts', () => {
  it('has no tabs to begin with', async () => {
    const tabs = createMemoryTabs();

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([]);
    await expect(tabs.listInCurrentWindow()).resolves.toEqual([]);
  });

  it('lists the tab ids it was given', async () => {
    const tabs = createMemoryTabs([3, 1, 2]);

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([3, 1, 2]);
  });

  it('makes plain tabs of ids, and keeps the tabs it is given as they are', async () => {
    const tabs = createMemoryTabs([
      4,
      { id: 5, pinned: true, lastAccessed: 99 },
    ]);

    await expect(tabs.listInCurrentWindow()).resolves.toEqual([
      { id: 4, pinned: false, lastAccessed: 0 },
      { id: 5, pinned: true, lastAccessed: 99 },
    ]);
  });

  it('lists the tabs of a window it was given details of, with the time each was last used', async () => {
    const tabs = createMemoryTabs();
    const detail = (id: number, windowId: number, pinned = false) => ({
      id,
      windowId,
      active: false,
      pinned,
      url: undefined,
      pendingUrl: undefined,
      title: undefined,
      browserGroupId: undefined,
    });
    tabs.setDetails([detail(1, 7), detail(2, 8), detail(3, 7, true)]);
    tabs.setLastAccessed({ 3: 40 });

    await expect(tabs.listSummariesInWindow(7)).resolves.toEqual([
      { id: 1, pinned: false, lastAccessed: 0 },
      { id: 3, pinned: true, lastAccessed: 40 },
    ]);
    await expect(tabs.listSummariesInWindow(9)).resolves.toEqual([]);
  });

  it('lists the tab ids it was last told to have', async () => {
    const tabs = createMemoryTabs([1]);

    tabs.setIds([5, 6]);

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([5, 6]);
    await expect(tabs.listInCurrentWindow()).resolves.toEqual([
      { id: 5, pinned: false, lastAccessed: 0 },
      { id: 6, pinned: false, lastAccessed: 0 },
    ]);
  });

  it('lists the tabs it was last told to have', async () => {
    const tabs = createMemoryTabs([1]);

    tabs.setTabs([{ id: 9, pinned: true, lastAccessed: 7 }]);

    await expect(tabs.listInCurrentWindow()).resolves.toEqual([
      { id: 9, pinned: true, lastAccessed: 7 },
    ]);
  });

  it('hands out copies, so changing what it gave does not change the tabs', async () => {
    const given = { id: 1, pinned: false, lastAccessed: 5 };
    const tabs = createMemoryTabs([given]);

    (await tabs.listIdsInCurrentWindow()).push(3);
    const listed = await tabs.listInCurrentWindow();
    const first = listed[0];
    if (first) {
      first.pinned = true;
    }
    given.lastAccessed = 99;

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([1]);
    await expect(tabs.listInCurrentWindow()).resolves.toEqual([
      { id: 1, pinned: false, lastAccessed: 5 },
    ]);
  });

  it('keeps a copy of the tabs it is told to have', async () => {
    const tabs = createMemoryTabs();
    const told = [{ id: 1, pinned: false, lastAccessed: 5 }];

    tabs.setTabs(told);
    told[0] = { id: 2, pinned: true, lastAccessed: 6 };

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([1]);
  });

  it('keeps track of hidden tabs and of what was done, in order', async () => {
    const tabs = createMemoryTabs([1, 2, 3]);

    await tabs.hide([1, 2]);
    await tabs.activate(3);
    await tabs.show([2]);

    expect([...tabs.hiddenIds]).toEqual([1]);
    expect(tabs.calls).toEqual(['hide 1,2', 'activate 3', 'show 2']);
  });
});
