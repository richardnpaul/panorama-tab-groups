import { createBrowserI18n } from '../adapters/browser/i18n.js';
import { createBrowserMenus } from '../adapters/browser/menus.js';
import { createBrowserWindows } from '../adapters/browser/windows.js';
import { createMenuManager } from '../app/menu-manager.js';
import { stateManager } from './StateManager.js';

const menuManager = createMenuManager({
  menus: createBrowserMenus(() => browser),
  groupState: stateManager,
  windows: createBrowserWindows(() => browser),
  i18n: createBrowserI18n(() => browser),
  logger: console,
});

export const { addRefreshMenuItem, createMenuList, handleMenuChange } =
  menuManager;
