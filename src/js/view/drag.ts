import { dropMarkFor, newGroupRect } from '../core/layout.js';
import type { GroupsStore } from '../app/groups-store.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import { newElement } from '../share/utils.js';
import type { GroupDragHandlers, GroupNodes } from './group-nodes.js';
import type { TabDragHandlers } from './tab-nodes.js';

const px = (value: number): string => `${String(value)}px`;

export interface DragDeps {
  groups: Pick<GroupsStore, 'getIds' | 'get' | 'create'>;
  // Given as what to ask for, since the nodes of groups are made with this
  groupNodes: () => Pick<
    GroupNodes,
    'make' | 'newTabOf' | 'resize' | 'updateFit' | 'insertTab'
  >;
  groupState: Pick<GroupState, 'getTabGroup'>;
  /**
   * Ask the background to put the tab in the group, next to a tab if it was dropped by one: it
   * moves it, as what the browser says of the move is taken for the person's doing elsewhere.
   * Gives whether it did.
   */
  placeTab: (
    tabId: number,
    groupId: number,
    beside?: { tabId: number; before: boolean },
  ) => Promise<boolean>;
  // The window the view is in
  windowId: () => number;
  logger: Pick<Logger, 'error'>;
}

export interface Drag {
  /** The mark that shows where a dragged tab will drop; it goes in the page */
  indicator: HTMLElement;
  tab: TabDragHandlers;
  group: GroupDragHandlers;
  /** A tab was dropped on the page outside of any group: make a group for it */
  outsideDrop: (event: DragEvent) => void;
  /** The browser moved a tab: show it where it is now */
  tabMoved: (tabId: number, moveInfo: { windowId: number }) => Promise<void>;
}

export function createDrag({
  groups,
  groupNodes,
  groupState,
  placeTab,
  windowId,
  logger,
}: DragDeps): Drag {
  const indicator = newElement('div', { class: 'drag_indicator' });

  // The tab being dragged, and the tab it is dragged over, with how many
  // elements of that tab have been entered and not yet left
  let dragged: HTMLElement | null = null;
  let over: HTMLElement | null = null;
  let entered = 0;
  let dropBefore = false;

  const report = (action: Promise<unknown>): void => {
    action.catch((error: unknown) => {
      logger.error('[View] A drag handler failed:', error);
    });
  };

  const hideIndicator = (): void => {
    indicator.classList.remove('show');
  };

  const updateAllFits = (): void => {
    groups.getIds().forEach((id) => {
      groupNodes().updateFit(groups.get(id));
    });
  };

  // The tab is shown where it was dropped at once; where the background did not move it, it is
  // shown again where it is
  async function place(
    tabId: number,
    groupId: number,
    beside?: { tabId: number; before: boolean },
  ): Promise<void> {
    const placed = await placeTab(tabId, groupId, beside).catch(
      (error: unknown) => {
        logger.error(`[View] Tab ${String(tabId)} could not be placed:`, error);
        return false;
      },
    );
    if (!placed) {
      await groupNodes().insertTab(tabId);
      updateAllFits();
    }
  }

  const idOfNode = (node: HTMLElement): number =>
    Number(node.getAttribute('tabId'));

  async function dropOnTab(): Promise<void> {
    if (dragged === null || over === null || dragged === over) {
      return;
    }
    const moved = dragged;
    const target = over;
    target.insertAdjacentElement(
      dropBefore ? 'beforebegin' : 'afterend',
      moved,
    );
    updateAllFits();

    // The tab joins the group of the tab it was dropped by
    const toTabId = idOfNode(target);
    const tabId = idOfNode(moved);
    const groupId = await groupState.getTabGroup(toTabId);
    if (groupId === undefined) {
      await groupNodes().insertTab(tabId);
      updateAllFits();
      return;
    }
    await place(tabId, groupId, { tabId: toTabId, before: dropBefore });
  }

  async function putTabInGroup(groupId: number): Promise<void> {
    const newTab = groupNodes().newTabOf(groupId);
    if (dragged === null || newTab === undefined) {
      return;
    }
    newTab.insertAdjacentElement('beforebegin', dragged);
    updateAllFits();

    await place(idOfNode(dragged), groupId);
  }

  const tab: TabDragHandlers = {
    start(event) {
      const node = event.currentTarget;
      if (!(node instanceof HTMLElement)) {
        return;
      }
      // Pinned tabs stay where they are
      if (node.classList.contains('pinned')) {
        event.preventDefault();
        return;
      }

      node.classList.add('drag');
      if (event.dataTransfer !== null) {
        const bounds = node.getBoundingClientRect();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/html', 'pvDragging');
        event.dataTransfer.setDragImage(
          node,
          bounds.width / 2,
          bounds.height / 2,
        );
      }
      dragged = node;
    },

    enter(event) {
      event.preventDefault();
      const node = event.currentTarget;
      if (!(node instanceof HTMLElement)) {
        return;
      }

      // Over another tab than before: the mark was for that one
      if (node !== over) {
        hideIndicator();
      }
      over = node;
      entered += 1;
    },

    leave(event) {
      event.preventDefault();
      entered -= 1;
      if (entered === 0) {
        hideIndicator();
        over = null;
      }
    },

    over(event) {
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = 'move';
      }

      if (over !== null && dragged !== over) {
        const mark = dropMarkFor(
          over.getBoundingClientRect(),
          event.clientX,
          window.scrollY,
        );
        indicator.classList.add('show');
        indicator.style.height = px(mark.height);
        indicator.style.top = px(mark.top);
        indicator.style.left = px(mark.left);
        dropBefore = mark.before;
      }
    },

    drop(event) {
      event.stopPropagation();
      report(dropOnTab());
    },

    end() {
      entered = 0;
      dragged?.classList.remove('drag');
      hideIndicator();
    },
  };

  const group: GroupDragHandlers = {
    over(event) {
      // Without this the browser does not allow a drop
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = 'move';
      }
      return false;
    },

    drop(event) {
      event.stopPropagation();
      const content = event.currentTarget;
      if (content instanceof HTMLElement) {
        report(putTabInGroup(Number(content.getAttribute('groupId'))));
      }
    },
  };

  async function makeGroupFor(event: DragEvent): Promise<void> {
    const created = await groups.create();
    created.rect = newGroupRect(
      { x: event.clientX, y: event.clientY },
      { width: window.innerWidth, height: window.innerHeight },
    );
    const element = groupNodes().make(created);
    if (event.target instanceof Node) {
      event.target.appendChild(element);
    }
    groupNodes().resize();

    await putTabInGroup(created.id);
    element.scrollIntoView({ behavior: 'smooth' });
  }

  return {
    indicator,
    tab,
    group,
    outsideDrop(event) {
      event.stopPropagation();
      report(makeGroupFor(event));
    },

    async tabMoved(tabId, moveInfo) {
      if (windowId() !== moveInfo.windowId) {
        return;
      }
      await groupNodes().insertTab(tabId);
      updateAllFits();
    },
  };
}
