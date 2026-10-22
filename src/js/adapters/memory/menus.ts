import type { MenuItem, Menus } from '../../ports/menus.js';

export interface MemoryMenus extends Menus {
  /** The items, in the order they would be shown */
  readonly items: MenuItem[];
}

export interface MemoryMenusOptions {
  // Chromium has no 'tab' context, and refuses items that name it
  supportsTabContext?: boolean;
}

// What throws inside becomes a rejection, as the browser reports these errors
const settle = (action: () => void): Promise<void> =>
  new Promise((resolve) => {
    action();
    resolve();
  });

/** A context menu that keeps its items in memory and refuses what a real one refuses */
export function createMemoryMenus({
  supportsTabContext = true,
}: MemoryMenusOptions = {}): MemoryMenus {
  const items: MenuItem[] = [];

  const find = (id: string): MenuItem => {
    const found = items.find((item) => item.id === id);
    if (found === undefined) {
      throw new Error(`Cannot find menu item with id ${id}`);
    }
    return found;
  };

  return {
    items,

    create(item) {
      if (!supportsTabContext && item.contexts.includes('tab')) {
        throw new Error('Invalid value for argument 1');
      }
      if (items.some(({ id }) => id === item.id)) {
        throw new Error(`ID already exists: ${item.id}`);
      }
      items.push({ ...item });
    },

    update: (id, changes) =>
      settle(() => {
        find(id).title = changes.title;
      }),

    remove: (id) =>
      settle(() => {
        items.splice(items.indexOf(find(id)), 1);
      }),

    removeAll() {
      items.length = 0;
      return Promise.resolve();
    },
  };
}
