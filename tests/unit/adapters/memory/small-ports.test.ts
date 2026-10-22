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
    await expect(createMemoryTabs().listIdsInCurrentWindow()).resolves.toEqual(
      [],
    );
  });

  it('lists the tab ids it was given', async () => {
    const tabs = createMemoryTabs([3, 1, 2]);

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([3, 1, 2]);
  });

  it('lists the tab ids it was last told to have', async () => {
    const tabs = createMemoryTabs([1]);

    tabs.setIds([5, 6]);

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([5, 6]);
  });

  it('hands out a copy, so changing the list does not change the tabs', async () => {
    const tabs = createMemoryTabs([1, 2]);

    (await tabs.listIdsInCurrentWindow()).push(3);

    await expect(tabs.listIdsInCurrentWindow()).resolves.toEqual([1, 2]);
  });
});
