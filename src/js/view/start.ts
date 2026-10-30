import { createAppearanceSettings } from '../adapters/browser/appearance-settings.js';
import { createExclusively } from '../adapters/browser/exclusive.js';
import { createBrowserExtension } from '../adapters/browser/extension.js';
import { createBrowserI18n } from '../adapters/browser/i18n.js';
import { createBrowserMessaging } from '../adapters/browser/messaging.js';
import { createBrowserTabs } from '../adapters/browser/tabs.js';
import { registerViewListeners } from '../adapters/browser/view-events.js';
import { createBrowserViewState } from '../adapters/browser/view-state.js';
import { createBrowserViewTabs } from '../adapters/browser/view-tabs.js';
import { createBrowserWindows } from '../adapters/browser/windows.js';
import { systemClock } from '../adapters/system/clock.js';
import { createSystemScheduler } from '../adapters/system/scheduler.js';
import { createGroupsStore } from '../app/groups-store.js';
import { stateManager } from '../background/StateManager.js';
import { requireElementById } from '../share/dom.js';
import { createViewController } from './controller.js';
import { createDrag } from './drag.js';
import { initDragScroll } from './dragscroll.js';
import { createGroupNodes, type GroupNodes } from './group-nodes.js';
import { createLate } from './late.js';
import { applyLanguage } from '../share/direction.js';
import { createLeaveView } from './leave-view.js';
import { createPage } from './page.js';
import { createTabNodes } from './tab-nodes.js';
import { applyAppearance } from './theme.js';
import {
  createImageLoader,
  createThumbnailShrinker,
} from './thumbnail-image.js';

// The buttons of the toolbar, with the message that names each
const BUTTON_TITLES = [
  ['newGroup', 'newGroupButton'],
  ['settings', 'settingsButton'],
  ['tiling', 'tilingButton'],
  ['freeform', 'freeformButton'],
] as const;

/**
 * Show the view: all the groups of the window and the tabs in them,
 * ready for the user to move them about, and responding to what the browser
 * says of the tabs.
 */
async function initView(): Promise<void> {
  const logger = console;
  const i18n = createBrowserI18n(() => browser);
  applyLanguage(i18n, document.documentElement);
  const viewTabs = createBrowserViewTabs(() => browser);
  const viewState = createBrowserViewState(() => browser);
  const messaging = createBrowserMessaging(() => browser);

  BUTTON_TITLES.forEach(([id, message]) => {
    requireElementById(HTMLElement, id).title = i18n.getMessage(message);
  });
  document.title = i18n.getMessage('viewTitle');
  requireElementById(HTMLInputElement, 'tab-search').placeholder =
    i18n.getMessage('searchForTab_placeholder');

  const windowId = await createBrowserWindows(() => browser).currentWindowId();
  const viewTabId = await viewTabs.currentId();
  const groupsNode = requireElementById(HTMLElement, 'groups');
  const pinnedNode = requireElementById(HTMLElement, 'pinnedTabs');
  const searchInput = requireElementById(HTMLInputElement, 'tab-search');

  // The groups are known before any node is made for them
  const groups = await createGroupsStore(
    {
      groupState: stateManager,
      messaging,
      tabs: createBrowserTabs(() => browser),
      clock: systemClock,
      i18n,
      logger,
    },
    windowId,
  );

  const leaveView = createLeaveView({
    tabs: viewTabs,
    pathname: () => window.location.pathname,
    logger,
  });

  // The nodes of groups are made with the dragging that works on them
  const groupNodesLate = createLate<GroupNodes>();
  const drag = createDrag({
    groups,
    groupNodes: groupNodesLate.get,
    groupState: stateManager,
    tabs: viewTabs,
    windowId: () => windowId,
    logger,
  });
  const tabNodes = createTabNodes({
    tabs: viewTabs,
    viewState,
    i18n,
    drag: drag.tab,
    leaveView,
    imageLoads: createImageLoader(() => new Image()),
    logger,
  });
  const groupNodes = createGroupNodes({
    groups,
    tabs: viewTabs,
    groupState: stateManager,
    tabNodes,
    drag: drag.group,
    i18n,
    clock: systemClock,
    confirm: (message) => window.confirm(message),
    leaveView,
    layoutMode: () => viewState.layoutMode(windowId),
    exclusively: createExclusively(undefined),
    logger,
  });
  groupNodesLate.bind(groupNodes);

  const controller = createViewController({
    tabs: viewTabs,
    viewState,
    messaging,
    groupState: stateManager,
    groups,
    groupNodes,
    tabNodes,
    leaveView,
    shrinkImage: createThumbnailShrinker({
      newImage: () => new Image(),
      newCanvas: () => document.createElement('canvas'),
    }),
    scheduler: createSystemScheduler(),
    clock: systemClock,
    logger,
    windowId,
    viewTabId,
    groupsNode,
    page: createPage(document, window, searchInput),
  });

  // An event has nobody to report a failure to
  const report = (action: Promise<unknown>): void => {
    action.catch((error: unknown) => {
      logger.error('[View] An event handler failed:', error);
    });
  };

  groupsNode.appendChild(drag.indicator);

  // The nodes must be there before the layout mode places them
  await tabNodes.init(viewTabId);
  await groupNodes.init(groupsNode, pinnedNode);
  await controller.setLayoutMode('freeform');
  report(controller.captureThumbnails());

  const extension = createBrowserExtension(() => browser);
  const onClick = (id: string, handler: () => Promise<unknown>): void => {
    requireElementById(HTMLElement, id).addEventListener('click', () => {
      report(handler());
    });
  };
  onClick('newGroup', () => controller.createGroup());
  onClick('settings', () => extension.openOptionsPage());
  onClick('freeform', () => controller.setLayoutMode('freeform'));
  onClick('tiling', () => controller.setLayoutMode('tiling'));
  searchInput.addEventListener('input', () => {
    report(controller.search());
  });

  // A click of the middle button behind the groups makes a new group
  groupsNode.addEventListener('auxclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.target === groupsNode && event.button === 1) {
      report(controller.createGroup({ x: event.clientX, y: event.clientY }));
    }
  });
  document.addEventListener('visibilitychange', () => {
    report(controller.visibilityChanged());
  });

  initDragScroll(document, window);
  window.addEventListener('resize', () => {
    groupNodes.resize();
  });
  document.addEventListener('keydown', (event) => {
    report(controller.keyDown(event));
  });

  registerViewListeners(
    browser,
    windowId,
    {
      tabCreated: controller.tabCreated,
      tabRemoved: controller.tabRemoved,
      tabUpdated: controller.tabUpdated,
      tabMoved: drag.tabMoved,
      tabAttached: controller.tabAttached,
      tabDetached: controller.tabDetached,
    },
    logger,
  );

  groupsNode.addEventListener('dragover', (event) => {
    if ('dataTransfer' in event) {
      drag.group.over(event);
    }
  });
  groupsNode.addEventListener('drop', (event) => {
    if ('dataTransfer' in event) {
      drag.outsideDrop(event);
    }
  });
  groupsNode.addEventListener('dblclick', (event) => {
    report(controller.doubleClick(event));
  });
  groupsNode.addEventListener('click', (event) => {
    controller.singleClick(event);
  });

  document.body.classList.add('view-ready');
}

/** Dress the page as the user wants, then show the view */
export async function startView(): Promise<void> {
  await applyAppearance({
    body: document.body,
    systemPrefersDark: window.matchMedia('(prefers-color-scheme: dark)'),
    settings: createAppearanceSettings(() => browser),
  });
  await initView();
}
