import { describe, expect, it } from 'vitest';
import { createMemoryMenus } from '../../../../src/js/adapters/memory/menus.js';
import type { MenuItem } from '../../../../src/js/ports/menus.js';

const item = (id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  title: `Item ${id}`,
  contexts: ['tab'],
  ...extra,
});

describe('adapters/memory/menus.ts', () => {
  it('starts with no items', () => {
    expect(createMemoryMenus().items).toEqual([]);
  });

  it('keeps the items in the order they were created', () => {
    const menus = createMemoryMenus();

    menus.create(item('b'));
    menus.create(item('a'));

    expect(menus.items.map(({ id }) => id)).toEqual(['b', 'a']);
  });

  it('refuses an id that is already in use', () => {
    const menus = createMemoryMenus();
    menus.create(item('a'));

    expect(() => {
      menus.create(item('a'));
    }).toThrow('ID already exists: a');
    expect(menus.items).toHaveLength(1);
  });

  it('stores a copy of what it was given', () => {
    const menus = createMemoryMenus();
    const given = item('a');

    menus.create(given);
    given.title = 'Changed';

    expect(menus.items[0]?.title).toBe('Item a');
  });

  it('removes an item, and puts a new one with the same id at the end', async () => {
    const menus = createMemoryMenus();
    menus.create(item('a'));
    menus.create(item('b'));

    await menus.remove('a');
    menus.create(item('a'));

    expect(menus.items.map(({ id }) => id)).toEqual(['b', 'a']);
  });

  it('fails to remove an item that is not there', async () => {
    const menus = createMemoryMenus();
    menus.create(item('a'));

    await expect(menus.remove('b')).rejects.toThrow(
      'Cannot find menu item with id b',
    );
    expect(menus.items).toHaveLength(1);
  });

  it('removes every item', async () => {
    const menus = createMemoryMenus();
    menus.create(item('a'));
    menus.create(item('b'));

    await menus.removeAll();

    expect(menus.items).toEqual([]);
  });

  it('changes the title of an item and nothing else', async () => {
    const menus = createMemoryMenus();
    menus.create(item('a', { parentId: 'root' }));
    menus.create(item('b'));

    await menus.update('a', { title: 'New' });

    expect(menus.items).toEqual([
      item('a', { parentId: 'root', title: 'New' }),
      item('b'),
    ]);
  });

  it('fails to update an item that is not there', async () => {
    const menus = createMemoryMenus();

    await expect(menus.update('a', { title: 'x' })).rejects.toThrow(
      'Cannot find menu item with id a',
    );
  });

  describe('as a browser without the "tab" context', () => {
    it('refuses an item for the "tab" context', () => {
      const menus = createMemoryMenus({ supportsTabContext: false });

      expect(() => {
        menus.create(item('a'));
      }).toThrow('Invalid value for argument 1');
      expect(menus.items).toEqual([]);
    });

    it('accepts an item for the "all" context', () => {
      const menus = createMemoryMenus({ supportsTabContext: false });

      menus.create(item('a', { contexts: ['all'] }));

      expect(menus.items).toHaveLength(1);
    });

    it('refuses an item that has "tab" among other contexts', () => {
      const menus = createMemoryMenus({ supportsTabContext: false });

      expect(() => {
        menus.create(item('a', { contexts: ['all', 'tab'] }));
      }).toThrow('Invalid value for argument 1');
    });
  });
});
