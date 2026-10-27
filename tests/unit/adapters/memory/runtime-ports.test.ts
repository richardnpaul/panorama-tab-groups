import { describe, expect, it } from 'vitest';
import { createMemoryExtension } from '../../../../src/js/adapters/memory/extension.js';
import { createMemoryMigrationFlag } from '../../../../src/js/adapters/memory/migration-flag.js';
import { createMemoryNotifications } from '../../../../src/js/adapters/memory/notifications.js';
import { createMemorySessionHistory } from '../../../../src/js/adapters/memory/session-history.js';

describe('adapters/memory/notifications.ts', () => {
  it('remembers what is shown and forgets what is cleared', async () => {
    const notifications = createMemoryNotifications();

    await notifications.show('a', { title: 'A', message: 'm', iconUrl: 'i' });
    await notifications.show('b', { title: 'B', message: 'm', iconUrl: 'i' });
    await notifications.clear('a');

    expect([...notifications.shown.keys()]).toEqual(['b']);
  });

  it('keeps its own copy of a notification', async () => {
    const notifications = createMemoryNotifications();
    const shown = { title: 'A', message: 'm', iconUrl: 'i' };

    await notifications.show('a', shown);
    shown.title = 'changed';

    expect(notifications.shown.get('a')?.title).toBe('A');
  });
});

describe('adapters/memory/extension.ts', () => {
  it('puts the path after the address it has', () => {
    expect(createMemoryExtension().urlOf('view.html')).toBe(
      'moz-extension://id/view.html',
    );
    expect(createMemoryExtension('chrome-extension://x/').urlOf('a')).toBe(
      'chrome-extension://x/a',
    );
  });

  it('counts how often the options page was opened', async () => {
    const extension = createMemoryExtension();

    await extension.openOptionsPage();
    await extension.openOptionsPage();

    expect(extension.optionsOpened).toBe(2);
  });
});

describe('adapters/memory/session-history.ts', () => {
  it('is there until it is disabled', async () => {
    const history = createMemorySessionHistory();

    await expect(history.probe()).resolves.toBeUndefined();
    history.disable('privacy');

    await expect(history.probe()).rejects.toThrow(new Error('privacy'));
  });
});

describe('adapters/memory/migration-flag.ts', () => {
  it('is not complete at first', async () => {
    await expect(createMemoryMigrationFlag().isComplete()).resolves.toBe(false);
  });

  it('can start out complete', async () => {
    await expect(createMemoryMigrationFlag(true).isComplete()).resolves.toBe(
      true,
    );
  });

  it('is set and unset', async () => {
    const flag = createMemoryMigrationFlag();

    await flag.setComplete(true);
    await expect(flag.isComplete()).resolves.toBe(true);
    await flag.setComplete(false);
    await expect(flag.isComplete()).resolves.toBe(false);
  });

  it('fails once told to, and changes nothing', async () => {
    const flag = createMemoryMigrationFlag();
    const failure = new Error('no');
    flag.failWith(failure);

    await expect(flag.isComplete()).rejects.toBe(failure);
    await expect(flag.setComplete(true)).rejects.toBe(failure);
  });
});
