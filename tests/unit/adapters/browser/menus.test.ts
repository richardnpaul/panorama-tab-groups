import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserMenus,
  type MenusApi,
} from '../../../../src/js/adapters/browser/menus.js';
import type { MenuItem } from '../../../../src/js/ports/menus.js';

const item: MenuItem = {
  id: 'one',
  title: 'One',
  parentId: 'root',
  contexts: ['tab'],
};

function setUp(create = vi.fn()) {
  const contextMenus = {
    create,
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    removeAll: vi.fn().mockResolvedValue(undefined),
  };
  const api: MenusApi = { contextMenus };
  return { menus: createBrowserMenus(() => api), contextMenus };
}

describe('adapters/browser/menus.ts', () => {
  describe('create', () => {
    it('creates the item as it is', () => {
      const { menus, contextMenus } = setUp();

      menus.create(item);

      expect(contextMenus.create).toHaveBeenCalledTimes(1);
      expect(contextMenus.create).toHaveBeenCalledWith(item);
    });

    it('creates a separator', () => {
      const { menus, contextMenus } = setUp();
      const separator: MenuItem = {
        id: 'spacer',
        type: 'separator',
        contexts: ['tab'],
      };

      menus.create(separator);

      expect(contextMenus.create).toHaveBeenCalledWith(separator);
    });

    it('tries again with the "all" context where the browser has no "tab" context', () => {
      const create = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('Invalid value for argument 1');
        })
        .mockReturnValueOnce(1);
      const { menus } = setUp(create);

      menus.create(item);

      expect(create).toHaveBeenCalledTimes(2);
      expect(create).toHaveBeenNthCalledWith(1, item);
      expect(create).toHaveBeenNthCalledWith(2, { ...item, contexts: ['all'] });
    });

    it('asks for the whole page, once, however many contexts there were', () => {
      const create = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('nope');
        })
        .mockReturnValueOnce(1);
      const { menus } = setUp(create);

      menus.create({ ...item, contexts: ['tab', 'all'] });

      expect(create).toHaveBeenNthCalledWith(2, { ...item, contexts: ['all'] });
    });

    it('fails if it does not work the second time either', () => {
      const failure = new Error('still no');
      const create = vi.fn().mockImplementation(() => {
        throw failure;
      });
      const { menus } = setUp(create);

      expect(() => {
        menus.create(item);
      }).toThrow(failure);
      expect(create).toHaveBeenCalledTimes(2);
    });
  });

  describe('the rest', () => {
    it('updates the title of an item', async () => {
      const { menus, contextMenus } = setUp();

      await menus.update('one', { title: 'New' });

      expect(contextMenus.update).toHaveBeenCalledWith('one', { title: 'New' });
    });

    it('removes an item', async () => {
      const { menus, contextMenus } = setUp();

      await menus.remove('one');

      expect(contextMenus.remove).toHaveBeenCalledWith('one');
    });

    it('removes every item', async () => {
      const { menus, contextMenus } = setUp();

      await menus.removeAll();

      expect(contextMenus.removeAll).toHaveBeenCalledTimes(1);
    });

    it('passes on failures', async () => {
      const failure = new Error('no such item');
      const { menus, contextMenus } = setUp();
      contextMenus.update.mockRejectedValue(failure);
      contextMenus.remove.mockRejectedValue(failure);
      contextMenus.removeAll.mockRejectedValue(failure);

      await expect(menus.update('x', { title: 't' })).rejects.toBe(failure);
      await expect(menus.remove('x')).rejects.toBe(failure);
      await expect(menus.removeAll()).rejects.toBe(failure);
    });
  });

  it('uses the browser that exists when it is called', async () => {
    const first = setUp();
    const second = setUp();
    let current: MenusApi = { contextMenus: first.contextMenus };
    const menus = createBrowserMenus(() => current);
    current = { contextMenus: second.contextMenus };

    await menus.removeAll();

    expect(first.contextMenus.removeAll).not.toHaveBeenCalled();
    expect(second.contextMenus.removeAll).toHaveBeenCalledTimes(1);
  });
});
