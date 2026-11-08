import { describe, expect, it, vi } from 'vitest';
import { createBrowserMenus } from '../../../src/js/adapters/browser/menus.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMenus } from '../../../src/js/adapters/memory/menus.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createMenuManager } from '../../../src/js/app/menu-manager.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { MemoryMenus } from '../../../src/js/adapters/memory/menus.js';
import type { Menus } from '../../../src/js/ports/menus.js';

const WINDOW = 3;

const group = (id: number, name = `Group ${String(id)}`): Group => ({
  id,
  name,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

interface SetUpOptions {
  groups?: Group[] | null;
  messages?: Record<string, string>;
}

async function build(
  menus: Menus,
  { groups = [group(1), group(2)], messages = {} }: SetUpOptions,
) {
  const groupState = createMemoryGroupState();
  if (groups !== null) {
    await groupState.setGroups(WINDOW, groups);
  }
  const logger = { warn: vi.fn(), error: vi.fn() };
  const i18n = { getMessage: (name: string) => messages[name] ?? '' };
  const windows = createMemoryWindows(WINDOW);
  const manager = createMenuManager({
    menus,
    groupState,
    windows,
    i18n,
    logger,
  });
  return { manager, groupState, windows, logger };
}

/** A manager over in-memory menus, which the test can look into */
async function setUp({
  menus = createMemoryMenus(),
  ...options
}: SetUpOptions & { menus?: MemoryMenus } = {}) {
  return { ...(await build(menus, options)), menus };
}

/** A manager over menus the test supplies, to make them misbehave */
const setUpWith = build;

const ids = (menus: MemoryMenus) => menus.items.map(({ id }) => id);

describe('app/menu-manager.ts', () => {
  describe('addRefreshMenuItem', () => {
    it('adds a separator and the refresh item under the send-tab menu', async () => {
      const menus = createMemoryMenus();
      const { manager } = await setUp({
        menus,
        messages: { refreshGroups: 'Refresh groups' },
      });

      await manager.addRefreshMenuItem();

      expect(menus.items).toEqual([
        {
          id: 'refresh-spacer',
          type: 'separator',
          parentId: 'send-tab',
          contexts: ['tab'],
        },
        {
          id: 'refresh-groups',
          title: 'Refresh groups',
          parentId: 'send-tab',
          contexts: ['tab'],
        },
      ]);
    });

    it('puts the refresh item last, replacing the ones that were there', async () => {
      const menus = createMemoryMenus();
      const { manager } = await setUp({ menus });
      await manager.addRefreshMenuItem();
      menus.create({ id: 'later', title: 'Later', contexts: ['tab'] });

      await manager.addRefreshMenuItem();

      expect(ids(menus)).toEqual(['later', 'refresh-spacer', 'refresh-groups']);
    });

    it('works when there is nothing to replace', async () => {
      const { manager, menus } = await setUp();

      await expect(manager.addRefreshMenuItem()).resolves.toBeUndefined();

      expect(ids(menus)).toEqual(['refresh-spacer', 'refresh-groups']);
    });

    it('works when only one of the two was there', async () => {
      const menus = createMemoryMenus();
      menus.create({ id: 'refresh-groups', title: 'Old', contexts: ['tab'] });
      const { manager } = await setUp({ menus });

      await manager.addRefreshMenuItem();

      expect(ids(menus)).toEqual(['refresh-spacer', 'refresh-groups']);
      expect(menus.items[1]?.title).toBe('');
    });

    it('removes the old items before it creates the new ones', async () => {
      const order: string[] = [];
      const real = createMemoryMenus();
      const menus: Menus = {
        create: (item) => {
          order.push(`create ${item.id}`);
          real.create(item);
        },
        update: (id, changes) => real.update(id, changes),
        remove: async (id) => {
          order.push(`remove ${id}`);
          await real.remove(id);
        },
        removeAll: () => real.removeAll(),
      };
      real.create({ id: 'refresh-groups', title: 'x', contexts: ['tab'] });
      real.create({
        id: 'refresh-spacer',
        type: 'separator',
        contexts: ['tab'],
      });
      const { manager } = await setUpWith(menus, {});

      await manager.addRefreshMenuItem();

      expect(order).toEqual([
        'remove refresh-groups',
        'remove refresh-spacer',
        'create refresh-spacer',
        'create refresh-groups',
      ]);
    });
  });

  describe('createMenuList', () => {
    it('makes a send-tab menu with an item for each group of the window', async () => {
      const { manager, menus } = await setUp({
        groups: [
          group(1, 'Work'),
          group(2, 'Play'),
          group(-2, 'Ungrouped Tabs'),
        ],
        messages: { sendTabToGroup: 'Send tab to group' },
      });

      await manager.createMenuList();

      expect(menus.items).toEqual([
        { id: 'send-tab', title: 'Send tab to group', contexts: ['tab'] },
        {
          id: '3:1',
          title: '1: Work',
          parentId: 'send-tab',
          contexts: ['tab'],
        },
        {
          id: '3:2',
          title: '2: Play',
          parentId: 'send-tab',
          contexts: ['tab'],
        },
        {
          id: '3:-2',
          title: '-2: Ungrouped Tabs',
          parentId: 'send-tab',
          contexts: ['tab'],
        },
        expect.objectContaining({ id: 'refresh-spacer' }),
        expect.objectContaining({ id: 'refresh-groups' }),
      ]);
    });

    it('starts from a clean menu', async () => {
      const menus = createMemoryMenus();
      menus.create({ id: 'stale', title: 'Stale', contexts: ['tab'] });
      menus.create({ id: 'send-tab', title: 'Old', contexts: ['tab'] });
      const { manager } = await setUp({ menus });

      await manager.createMenuList();

      expect(ids(menus)).toEqual([
        'send-tab',
        '3:1',
        '3:2',
        'refresh-spacer',
        'refresh-groups',
      ]);
    });

    it('stops after the send-tab menu when the window has no groups yet', async () => {
      const { manager, menus, logger } = await setUp({ groups: null });

      await manager.createMenuList();

      expect(ids(menus)).toEqual(['send-tab']);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('uses the groups of the window it is in, even when another window shares group numbers', async () => {
      const { manager, menus, groupState, windows } = await setUp({
        groups: [group(0, 'First Window Zero')],
      });
      await groupState.setGroups(WINDOW + 1, [group(0, 'Second Window Zero')]);

      await manager.createMenuList();
      expect(ids(menus)).toEqual([
        'send-tab',
        '3:0',
        'refresh-spacer',
        'refresh-groups',
      ]);

      windows.setCurrent(WINDOW + 1);
      await manager.createMenuList();
      expect(ids(menus)).toEqual([
        'send-tab',
        '4:0',
        'refresh-spacer',
        'refresh-groups',
      ]);

      await manager.createMenuList(WINDOW);
      expect(ids(menus)).toEqual([
        'send-tab',
        '3:0',
        'refresh-spacer',
        'refresh-groups',
      ]);
    });

    it('serializes overlapping menu rebuilds so their items do not interleave', async () => {
      const { manager, menus, groupState, windows } = await setUp({
        groups: [group(0, 'Win 3')],
      });
      await groupState.setGroups(WINDOW + 1, [group(0, 'Win 4')]);

      const firstRebuild = manager.createMenuList();
      windows.setCurrent(WINDOW + 1);
      const secondRebuild = manager.createMenuList();

      await Promise.all([firstRebuild, secondRebuild]);

      expect(ids(menus)).toEqual([
        'send-tab',
        '4:0',
        'refresh-spacer',
        'refresh-groups',
      ]);
    });

    it('works in a browser that has no tab context for menus', async () => {
      const browserMenu = createMemoryMenus({ supportsTabContext: false });
      const menus = createBrowserMenus(() => ({ contextMenus: browserMenu }));
      const { manager, logger } = await setUpWith(menus, {});

      await manager.createMenuList();

      expect(ids(browserMenu)).toEqual([
        'send-tab',
        '3:1',
        '3:2',
        'refresh-spacer',
        'refresh-groups',
      ]);
      expect(
        browserMenu.items.every(({ contexts }) => contexts[0] === 'all'),
      ).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('reports a failure instead of throwing, and stops there', async () => {
      const failure = new Error('menus are gone');
      const menus: Menus = {
        create: () => undefined,
        update: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        removeAll: () => Promise.reject(failure),
      };
      const { manager, logger } = await setUpWith(menus, {});

      await expect(manager.createMenuList()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create menu list:',
        failure,
      );
    });

    it('reports a failure to read the groups', async () => {
      const { manager, groupState, logger } = await setUp();
      const failure = new Error('no sessions');
      vi.spyOn(groupState, 'getGroups').mockRejectedValue(failure);

      await manager.createMenuList();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create menu list:',
        failure,
      );
    });
  });

  describe('handleMenuChange', () => {
    it('adds an item for a new group and keeps the refresh item last', async () => {
      const { manager, menus } = await setUp();
      await manager.createMenuList();

      await manager.handleMenuChange({
        action: 'createMenuItem',
        windowId: WINDOW,
        groupId: 7,
        groupName: 'Seven',
      });

      expect(ids(menus)).toEqual([
        'send-tab',
        '3:1',
        '3:2',
        '3:7',
        'refresh-spacer',
        'refresh-groups',
      ]);
      expect(menus.items.find(({ id }) => id === '3:7')).toEqual({
        id: '3:7',
        title: '7: Seven',
        parentId: 'send-tab',
        contexts: ['tab'],
      });
    });

    it('removes the item of a deleted group', async () => {
      const { manager, menus } = await setUp();
      await manager.createMenuList();

      await manager.handleMenuChange({
        action: 'removeMenuItem',
        windowId: WINDOW,
        groupId: 1,
      });

      expect(ids(menus)).toEqual([
        'send-tab',
        '3:2',
        'refresh-spacer',
        'refresh-groups',
      ]);
    });

    it('only warns when the item to remove is not there', async () => {
      const { manager, logger } = await setUp();

      await expect(
        manager.handleMenuChange({
          action: 'removeMenuItem',
          windowId: WINDOW,
          groupId: 9,
        }),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Could not remove menu item 3:9:',
        'Cannot find menu item with id 3:9',
      );
    });

    it('warns with the thing that was thrown when it is not an error', async () => {
      const menus: Menus = {
        create: () => undefined,
        update: () => Promise.resolve(),
        remove: vi.fn().mockRejectedValue('plain text'),
        removeAll: () => Promise.resolve(),
      };
      const { manager, logger } = await setUpWith(menus, {});

      await manager.handleMenuChange({
        action: 'removeMenuItem',
        windowId: WINDOW,
        groupId: 1,
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Could not remove menu item 3:1:',
        'plain text',
      );
    });

    it('renames the item of a renamed group', async () => {
      const { manager, menus } = await setUp();
      await manager.createMenuList();

      await manager.handleMenuChange({
        action: 'updateMenuItem',
        windowId: WINDOW,
        groupId: 2,
        groupName: 'Renamed',
      });

      expect(menus.items.find(({ id }) => id === '3:2')?.title).toBe(
        '2: Renamed',
      );
    });

    it('ignores a change from a window that does not have the focus', async () => {
      const { manager, menus, logger } = await setUp();
      await manager.createMenuList();
      const before = JSON.stringify(menus.items);

      await manager.handleMenuChange({
        action: 'createMenuItem',
        windowId: WINDOW + 1,
        groupId: 1,
        groupName: 'Other Window Group',
      });
      await manager.handleMenuChange({
        action: 'updateMenuItem',
        windowId: WINDOW + 1,
        groupId: 1,
        groupName: 'Renamed Other',
      });
      await manager.handleMenuChange({
        action: 'removeMenuItem',
        windowId: WINDOW + 1,
        groupId: 1,
      });

      expect(JSON.stringify(menus.items)).toBe(before);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('continues processing subsequent changes after a change rejects', async () => {
      const { manager, menus } = await setUp();
      await manager.createMenuList();

      await expect(
        manager.handleMenuChange({
          action: 'updateMenuItem',
          windowId: WINDOW,
          groupId: 99,
          groupName: 'Missing',
        }),
      ).rejects.toThrow('Cannot find menu item with id 3:99');

      await manager.handleMenuChange({
        action: 'updateMenuItem',
        windowId: WINDOW,
        groupId: 1,
        groupName: 'Still Works',
      });

      expect(menus.items.find(({ id }) => id === '3:1')?.title).toBe(
        '1: Still Works',
      );
    });
  });
});
