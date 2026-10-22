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
  const manager = createMenuManager({
    menus,
    groupState,
    windows: createMemoryWindows(WINDOW),
    i18n,
    logger,
  });
  return { manager, groupState, logger };
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
        { id: '1', title: '1: Work', parentId: 'send-tab', contexts: ['tab'] },
        {
          id: '2',
          title: '2: Play',
          parentId: 'send-tab',
          contexts: ['tab'],
        },
        {
          id: '-2',
          title: '-2: Ungrouped Tabs',
          parentId: 'send-tab',
          contexts: ['tab'],
        },
        expect.objectContaining({ id: 'refresh-spacer' }),
        expect.objectContaining({ id: 'refresh-groups' }),
      ]);
    });

    it.each([[''], [undefined]])(
      'names the menu "Send Tab to Group" when there is no translation (%j)',
      async (message) => {
        const { manager, menus } = await setUp({
          messages: message === undefined ? {} : { sendTabToGroup: message },
        });

        await manager.createMenuList();

        expect(menus.items[0]?.title).toBe('Send Tab to Group');
      },
    );

    it('starts from a clean menu', async () => {
      const menus = createMemoryMenus();
      menus.create({ id: 'stale', title: 'Stale', contexts: ['tab'] });
      menus.create({ id: 'send-tab', title: 'Old', contexts: ['tab'] });
      const { manager } = await setUp({ menus });

      await manager.createMenuList();

      expect(ids(menus)).toEqual([
        'send-tab',
        '1',
        '2',
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

    it('uses the groups of the window it is in', async () => {
      const { manager, menus, groupState } = await setUp();
      await groupState.setGroups(WINDOW + 1, [group(50)]);

      await manager.createMenuList();

      expect(ids(menus)).not.toContain('50');
    });

    it('works in a browser that has no tab context for menus', async () => {
      const browserMenu = createMemoryMenus({ supportsTabContext: false });
      const menus = createBrowserMenus(() => ({ contextMenus: browserMenu }));
      const { manager, logger } = await setUpWith(menus, {});

      await manager.createMenuList();

      expect(ids(browserMenu)).toEqual([
        'send-tab',
        '1',
        '2',
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
        groupId: '7',
        groupName: 'Seven',
      });

      expect(ids(menus)).toEqual([
        'send-tab',
        '1',
        '2',
        '7',
        'refresh-spacer',
        'refresh-groups',
      ]);
      expect(menus.items.find(({ id }) => id === '7')).toEqual({
        id: '7',
        title: '7: Seven',
        parentId: 'send-tab',
        contexts: ['tab'],
      });
    });

    it('accepts a group id that is a number', async () => {
      const { manager, menus } = await setUp();

      await manager.handleMenuChange({
        action: 'createMenuItem',
        groupId: 7,
        groupName: 'Seven',
      });

      expect(menus.items[0]?.id).toBe('7');
    });

    it('removes the item of a deleted group', async () => {
      const { manager, menus } = await setUp();
      await manager.createMenuList();

      await manager.handleMenuChange({
        action: 'removeMenuItem',
        groupId: '1',
      });

      expect(ids(menus)).toEqual([
        'send-tab',
        '2',
        'refresh-spacer',
        'refresh-groups',
      ]);
    });

    it('only warns when the item to remove is not there', async () => {
      const { manager, logger } = await setUp();

      await expect(
        manager.handleMenuChange({ action: 'removeMenuItem', groupId: 9 }),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Could not remove menu item 9:',
        'Cannot find menu item with id 9',
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

      await manager.handleMenuChange({ action: 'removeMenuItem', groupId: 1 });

      expect(logger.warn).toHaveBeenCalledWith(
        'Could not remove menu item 1:',
        'plain text',
      );
    });

    it('renames the item of a renamed group', async () => {
      const { manager, menus } = await setUp();
      await manager.createMenuList();

      await manager.handleMenuChange({
        action: 'updateMenuItem',
        groupId: '2',
        groupName: 'Renamed',
      });

      expect(menus.items.find(({ id }) => id === '2')?.title).toBe(
        '2: Renamed',
      );
    });

    it.each([
      ['an action it does not know', { action: 'somethingElse', groupId: '1' }],
      ['no action', { groupId: '1' }],
      ['a message that is not an object', 'createMenuItem'],
      ['no message', undefined],
      ['a create without a name', { action: 'createMenuItem', groupId: '1' }],
      ['a create without an id', { action: 'createMenuItem', groupName: 'x' }],
      [
        'a create with an id that is not text or a number',
        { action: 'createMenuItem', groupId: true, groupName: 'x' },
      ],
      ['an update without a name', { action: 'updateMenuItem', groupId: '1' }],
      ['a remove without an id', { action: 'removeMenuItem' }],
    ])('ignores %s', async (_name, message) => {
      const { manager, menus, logger } = await setUp();
      await manager.createMenuList();
      const before = JSON.stringify(menus.items);

      await manager.handleMenuChange(message);

      expect(JSON.stringify(menus.items)).toBe(before);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
