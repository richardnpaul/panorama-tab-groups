import type { MenuItem, Menus } from '../../ports/menus.js';

/** The part of `browser.contextMenus` the extension uses */
export interface MenusApi {
  contextMenus: {
    create(item: MenuItem): unknown;
    update(id: string, changes: { title: string }): Promise<void>;
    remove(id: string): Promise<void>;
    removeAll(): Promise<void>;
  };
}

export function createBrowserMenus(getApi: () => MenusApi): Menus {
  const menus = () => getApi().contextMenus;

  return {
    create(item) {
      try {
        menus().create(item);
      } catch {
        // Chromium has no 'tab' context for menus; the whole page will do there
        menus().create({ ...item, contexts: ['all'] });
      }
    },
    update: (id, changes) => menus().update(id, changes),
    remove: (id) => menus().remove(id),
    removeAll: () => menus().removeAll(),
  };
}
