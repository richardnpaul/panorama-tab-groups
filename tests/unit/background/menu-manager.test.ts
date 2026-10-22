import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryMenus } from '../../../src/js/adapters/memory/menus.js';
import { createFakeSessions } from '../../support/fake-sessions.js';

const group = (id: number, name: string) => ({
  id,
  name,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

async function load({ supportsTabContext = true } = {}) {
  vi.resetModules();
  const fake = createFakeSessions();
  fake.windowValues.set(fake.slot(5, 'groups'), [group(1, 'Work')]);
  const contextMenus = createMemoryMenus({ supportsTabContext });
  Object.assign(globalThis, {
    browser: {
      contextMenus,
      sessions: fake.api.sessions,
      windows: { getCurrent: () => Promise.resolve({ id: 5 }) },
      i18n: {
        getMessage: (name: string) =>
          ({ sendTabToGroup: 'Send', refreshGroups: 'Refresh' })[name] ?? '',
      },
    },
  });
  const manager = await import('../../../src/js/background/menu-manager.js');
  return { manager, contextMenus, ...fake };
}

describe('background/menu-manager.ts', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'browser');
  });

  it('builds the menu from the groups of the current window', async () => {
    const { manager, contextMenus } = await load();

    await manager.createMenuList();

    expect(contextMenus.items.map(({ id, title }) => [id, title])).toEqual([
      ['send-tab', 'Send'],
      ['1', '1: Work'],
      ['refresh-spacer', undefined],
      ['refresh-groups', 'Refresh'],
    ]);
  });

  it('shows the groups the way the browser state keeps them', async () => {
    const { manager, contextMenus, windowValues, slot } = await load();
    windowValues.set(slot(5, 'groups'), [group(2, 'Play'), group(3, 'Rest')]);

    await manager.createMenuList();

    expect(contextMenus.items.map(({ id }) => id)).toEqual([
      'send-tab',
      '2',
      '3',
      'refresh-spacer',
      'refresh-groups',
    ]);
  });

  it('adds, renames and removes menu items when the view says so', async () => {
    const { manager, contextMenus } = await load();
    await manager.createMenuList();

    await manager.handleMenuChange({
      action: 'createMenuItem',
      groupId: '4',
      groupName: 'Four',
    });
    await manager.handleMenuChange({
      action: 'updateMenuItem',
      groupId: '4',
      groupName: 'Quatre',
    });
    await manager.handleMenuChange({ action: 'removeMenuItem', groupId: '1' });

    expect(contextMenus.items.map(({ id, title }) => [id, title])).toEqual([
      ['send-tab', 'Send'],
      ['4', '4: Quatre'],
      ['refresh-spacer', undefined],
      ['refresh-groups', 'Refresh'],
    ]);
  });

  it('refreshes the refresh item on its own', async () => {
    const { manager, contextMenus } = await load();

    await manager.addRefreshMenuItem();

    expect(contextMenus.items.map(({ id }) => id)).toEqual([
      'refresh-spacer',
      'refresh-groups',
    ]);
  });

  it('works in a browser that has no tab context for menus', async () => {
    const { manager, contextMenus } = await load({ supportsTabContext: false });

    await manager.createMenuList();

    expect(contextMenus.items).toHaveLength(4);
    expect(
      contextMenus.items.every(({ contexts }) => contexts[0] === 'all'),
    ).toBe(true);
  });

  it('logs to the console when the menu cannot be built', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { manager, contextMenus } = await load();
    const failure = new Error('menus are gone');
    contextMenus.removeAll = () => Promise.reject(failure);

    await manager.createMenuList();

    expect(error).toHaveBeenCalledWith('Failed to create menu list:', failure);
    error.mockRestore();
  });

  it('warns on the console about a menu item it cannot remove', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { manager } = await load();

    await manager.handleMenuChange({ action: 'removeMenuItem', groupId: '9' });

    expect(warn).toHaveBeenCalledWith(
      'Could not remove menu item 9:',
      'Cannot find menu item with id 9',
    );
    warn.mockRestore();
  });
});
