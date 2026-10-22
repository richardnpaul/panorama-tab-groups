export type MenuContext = 'tab' | 'all';

export interface MenuItem {
  id: string;
  title?: string;
  type?: 'separator';
  parentId?: string;
  contexts: MenuContext[];
}

/** The context menu of the browser */
export interface Menus {
  /** Throws if the id is already in use */
  create(item: MenuItem): void;
  /** Rejects if there is no such item */
  update(id: string, changes: { title: string }): Promise<void>;
  /** Rejects if there is no such item */
  remove(id: string): Promise<void>;
  removeAll(): Promise<void>;
}
