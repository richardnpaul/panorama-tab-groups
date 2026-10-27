import type { GroupsStore } from '../app/groups-store.js';
import { newGroupRect, tilingRects, type Size } from '../core/layout.js';
import {
  neighbourTabId,
  searchedTabId,
  type NavGroup,
} from '../core/view-nav.js';
import type { Clock } from '../ports/clock.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Messaging } from '../ports/messaging.js';
import type { Scheduler } from '../ports/scheduler.js';
import type { LayoutMode, ViewState } from '../ports/view-state.js';
import type { ViewTab, ViewTabs } from '../ports/view-tabs.js';
import { isRecord } from '../share/guards.js';
import type { GroupNodes } from './group-nodes.js';
import type { TabNodes } from './tab-nodes.js';

/** What the controller needs of the page it works in */
export interface Page {
  isHidden: () => boolean;
  reload: () => void;
  viewportSize: () => Size;
  // What the user has typed in the search box
  searchText: () => string;
}

export interface ViewControllerDeps {
  tabs: ViewTabs;
  viewState: Pick<ViewState, 'thumbnail' | 'setThumbnail' | 'setLayoutMode'>;
  messaging: Messaging;
  groupState: Pick<GroupState, 'getTabGroup'>;
  groups: Pick<GroupsStore, 'getIds' | 'get' | 'create' | 'transform'>;
  groupNodes: Pick<
    GroupNodes,
    | 'make'
    | 'resize'
    | 'updateFit'
    | 'raise'
    | 'close'
    | 'insertTab'
    | 'fill'
    | 'tabIdsOf'
  >;
  tabNodes: Pick<
    TabNodes,
    | 'make'
    | 'update'
    | 'updateFavicon'
    | 'updateThumbnail'
    | 'select'
    | 'selectMostRecent'
    | 'selectedId'
    | 'remove'
  >;
  // Close the view when the user has gone to a tab
  leaveView: () => Promise<void>;
  // A picture of a tab made small, for showing it by
  shrinkImage: (picture: string) => Promise<string>;
  scheduler: Scheduler;
  clock: Clock;
  logger: Pick<Logger, 'debug' | 'warn' | 'error'>;
  windowId: number;
  // The tab the view is in
  viewTabId: number;
  // Where the nodes of the groups go
  groupsNode: HTMLElement;
  page: Page;
}

export interface ViewController {
  setLayoutMode: (mode: LayoutMode) => Promise<void>;
  captureThumbnails: () => Promise<void>;
  createGroup: (point?: { x: number; y: number }) => Promise<void>;
  search: () => Promise<void>;
  keyDown: (event: { key: string }) => Promise<void>;
  tabCreated: (tab: ViewTab) => Promise<void>;
  tabRemoved: (tabId: number, removeInfo: { windowId: number }) => void;
  tabUpdated: (
    tabId: number,
    changeInfo: object,
    tab: ViewTab,
  ) => Promise<void>;
  tabAttached: (
    tabId: number,
    attachInfo: { newWindowId: number },
  ) => Promise<void>;
  tabDetached: (tabId: number, detachInfo: { oldWindowId: number }) => void;
  doubleClick: (event: MouseEvent) => Promise<void>;
  singleClick: (event: MouseEvent) => void;
  /** The page was shown again: reload it if it is out of date */
  visibilityChanged: () => Promise<void>;
}

// How often, and how long between, a new tab is looked up in its group: the
// background gives it one a moment after the browser reports the tab
const GROUP_LOOKUPS = 20;
const GROUP_LOOKUP_DELAY_MS = 100;

const CONTENT_CLASSES = 'content transition';

export function createViewController({
  tabs,
  viewState,
  messaging,
  groupState,
  groups,
  groupNodes,
  tabNodes,
  leaveView,
  shrinkImage,
  scheduler,
  clock,
  logger,
  windowId,
  viewTabId,
  groupsNode,
  page,
}: ViewControllerDeps): ViewController {
  // Set when the tabs changed while the page was hidden
  let pendingReload = false;

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      scheduler.setTimeout(resolve, ms);
    });

  const updateAllFits = (): void => {
    groups.getIds().forEach((id) => {
      groupNodes.updateFit(groups.get(id));
    });
  };

  async function activateTiling(): Promise<void> {
    const ids = groups.getIds();
    await Promise.all(
      tilingRects(ids.length).flatMap((rect, index) =>
        ids.slice(index, index + 1).map(async (id) => {
          await groups.transform(id, rect);
          groupNodes.resize(id, rect);
        }),
      ),
    );
  }

  async function setLayoutMode(mode: LayoutMode): Promise<void> {
    await viewState.setLayoutMode(windowId, mode);
    if (mode === 'tiling') {
      await activateTiling();
    } else {
      groupNodes.resize();
    }
  }

  async function captureThumbnail(tab: ViewTab): Promise<void> {
    const cached = await viewState.thumbnail(tab.id);
    // A new picture only when there is none, or the tab was used since
    if (
      cached?.capturedAt !== undefined &&
      cached.capturedAt >= tab.lastAccessed
    ) {
      return;
    }

    const picture = await tabs.capture(tab.id);
    if (picture === undefined) {
      return;
    }
    const image = await shrinkImage(picture);
    await tabNodes.updateThumbnail(tab.id, image);
    await viewState.setThumbnail(tab.id, {
      image,
      capturedAt: clock.now(),
    });
  }

  async function captureThumbnails(): Promise<void> {
    await Promise.all((await tabs.list()).map(captureThumbnail));
  }

  async function createGroup(point = { x: 75, y: 75 }): Promise<void> {
    const group = await groups.create();
    group.rect = newGroupRect(point, page.viewportSize());

    const element = groupNodes.make(group);
    groupsNode.appendChild(element);
    groupNodes.resize();
    element.scrollIntoView({ behavior: 'smooth' });
  }

  async function addToGroup(tab: ViewTab, attempt = 0): Promise<void> {
    const groupId = await groupState.getTabGroup(tab.id);
    const group = groupId === undefined ? null : groups.get(groupId);

    if (group === null) {
      // The background may not have put the tab in a group yet, or the group
      // may be one the view does not show
      if (attempt < GROUP_LOOKUPS) {
        logger.debug(
          `[View] tabCreated: No group yet for tab ${String(tab.id)}, retrying (attempt ${String(attempt + 1)}/${String(GROUP_LOOKUPS)})...`,
        );
        await delay(GROUP_LOOKUP_DELAY_MS);
        await addToGroup(tab, attempt + 1);
        return;
      }
      logger.warn(
        `[View] tabCreated: Skipping tab ${String(tab.id)} - its group ${String(groupId)} not found in view`,
      );
      return;
    }

    logger.debug(
      `[View] tabCreated: Adding tab ${String(tab.id)} to group ${String(group.id)} in view`,
    );
    await groupNodes.insertTab(tab.id);
    groupNodes.updateFit(group);
  }

  async function tabCreated(tab: ViewTab): Promise<void> {
    if (tab.windowId !== windowId) {
      return;
    }
    tabNodes.make(tab);
    tabNodes.update(tab);
    await tabNodes.updateFavicon(tab);
    await addToGroup(tab);
  }

  // The tabs shown in each group, in the order the groups are shown
  const navGroups = (): NavGroup[] =>
    groups
      .getIds()
      .map((groupId) => ({ groupId, tabIds: groupNodes.tabIdsOf(groupId) }));

  const hasClasses = (target: EventTarget | null): target is HTMLElement =>
    target instanceof HTMLElement && target.className === CONTENT_CLASSES;

  const groupIdOf = (element: HTMLElement): number =>
    Number(element.getAttribute('groupid'));

  async function keyDown({ key }: { key: string }): Promise<void> {
    const selected = tabNodes.selectedId();
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const next = neighbourTabId(
        navGroups(),
        selected,
        key === 'ArrowRight' ? 1 : -1,
      );
      if (next !== undefined) {
        tabNodes.select(next);
      }
    } else if (key === 'Enter' && selected !== -1) {
      await tabs.activate(selected);
      await leaveView();
    }
  }

  return {
    setLayoutMode,

    captureThumbnails,
    createGroup,

    async search() {
      tabNodes.select(
        searchedTabId(
          await tabs.list(),
          page.searchText(),
          tabNodes.selectedId(),
        ),
      );
    },

    keyDown,

    tabCreated,

    tabRemoved(tabId, { windowId: removedFrom }) {
      // The tab the view is in is closed with the page
      if (removedFrom === windowId && tabId !== viewTabId) {
        tabNodes.remove(tabId);
        updateAllFits();
      }
    },

    async tabUpdated(_tabId, changeInfo, tab) {
      tabNodes.update(tab);
      await tabNodes.updateFavicon(tab);

      if ('pinned' in changeInfo) {
        // The pinned tabs are not always updated by the above, so the page
        // is shown again from the start
        if (page.isHidden()) {
          pendingReload = true;
        } else {
          page.reload();
        }
        await groupNodes.fill();
        tabNodes.update(tab);
      }
    },

    async tabAttached(tabId, { newWindowId }) {
      if (newWindowId === windowId) {
        await tabCreated(await tabs.get(tabId));
      }
    },

    tabDetached(tabId, { oldWindowId }) {
      if (oldWindowId === windowId) {
        tabNodes.remove(tabId);
        updateAllFits();
      }
    },

    async doubleClick(event) {
      const { target } = event;
      if (hasClasses(target)) {
        const group = groups.get(groupIdOf(target));
        if (group !== null) {
          await groupNodes.close(group);
        }
      } else if (target instanceof HTMLElement && target.id === 'groups') {
        await createGroup({ x: event.clientX, y: event.clientY });
      }
    },

    singleClick(event) {
      if (hasClasses(event.target)) {
        groupNodes.raise(groupIdOf(event.target));
      }
      event.stopPropagation();
    },

    async visibilityChanged() {
      if (page.isHidden()) {
        return;
      }

      const answer = await messaging.send({ action: 'checkViewRefresh' });
      const ordered = isRecord(answer) && answer.viewRefreshOrdered === true;
      if (pendingReload || ordered) {
        await messaging.send({ action: 'clearViewRefresh' });
        page.reload();
        return;
      }

      await tabNodes.selectMostRecent(viewTabId);
      await captureThumbnails();
    },
  };
}
