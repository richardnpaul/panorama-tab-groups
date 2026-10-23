import type { Exclusively } from '../adapters/browser/exclusive.js';
import type { GroupsStore } from '../app/groups-store.js';
import {
  boxOf,
  planTiles,
  stackingOf,
  tilePosition,
  transformRect,
  type Edges,
} from '../core/layout.js';
import { tabToPutBefore } from '../core/view-nav.js';
import type { Clock } from '../ports/clock.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { LayoutMode } from '../ports/view-state.js';
import type { ViewTabs } from '../ports/view-tabs.js';
import { getPluralForm, newElement } from '../share/utils.js';
import type { TabNodes } from './tab-nodes.js';

/** What happens as a tab is dragged over a group or dropped in it */
export interface GroupDragHandlers {
  over: (event: DragEvent) => boolean;
  drop: (event: DragEvent) => void;
}

export type GroupsApi = Pick<
  GroupsStore,
  'getIds' | 'get' | 'forEach' | 'remove' | 'rename' | 'transform' | 'setActive'
>;

export interface GroupNodesDeps {
  groups: GroupsApi;
  tabs: Pick<ViewTabs, 'list' | 'get' | 'openNew'>;
  groupState: Pick<GroupState, 'getTabGroup'>;
  tabNodes: Pick<TabNodes, 'elementOf'>;
  drag: GroupDragHandlers;
  i18n: I18n;
  clock: Clock;
  // Ask the user to confirm something
  confirm: (message: string) => boolean;
  leaveView: () => Promise<void>;
  layoutMode: () => Promise<LayoutMode | undefined>;
  // Changes to the tabs of the groups take turns
  exclusively: Exclusively;
  logger: Pick<Logger, 'debug' | 'warn' | 'error'>;
}

/** The parts of the node of a group that the rest of the view works with */
interface GroupNode {
  group: HTMLElement;
  content: HTMLElement;
  newtab: HTMLElement;
  tabCount: HTMLElement;
}

export interface GroupNodes {
  /** Make the node of a group; it is not in the page until it is put there */
  make: (group: Group) => HTMLElement;
  /** The element the tabs of a group are in */
  contentOf: (groupId: number) => HTMLElement | undefined;
  /** The tabs shown in a group, in the order they are shown */
  tabIdsOf: (groupId: number) => number[];
  /** The button that makes a new tab in a group, which is last in its content */
  newTabOf: (groupId: number) => HTMLElement | undefined;
  /** Lay out the tabs of a group in its content, and count them */
  updateFit: (group: Group | null) => void;
  /** Put every group where it is, with the one given as it is being dragged */
  resize: (draggedId?: number, draggedRect?: Group['rect']) => void;
  /** Bring a group in front of the others */
  raise: (groupId: number) => void;
  /** Delete a group, asking first if it has tabs */
  close: (group: Group) => Promise<void>;
  /** Make the nodes of the groups of the user, and show the tabs in them */
  init: (groupsNode: HTMLElement, pinnedNode: HTMLElement) => Promise<void>;
  /** Put every tab of the window where it belongs */
  fill: () => Promise<void>;
  /** Put a tab that was added or moved in its place in its group */
  insertTab: (tabId: number) => Promise<void>;
}

const px = (value: number): string => `${String(value)}px`;

// The handles for resizing a group, by the edges that follow the pointer
const HANDLES: readonly { name: string; edges: Partial<Edges> }[] = [
  { name: 'top', edges: { top: true } },
  { name: 'right', edges: { right: true } },
  { name: 'bottom', edges: { bottom: true } },
  { name: 'left', edges: { left: true } },
  { name: 'topRight', edges: { top: true, right: true } },
  { name: 'bottomRight', edges: { bottom: true, right: true } },
  { name: 'bottomLeft', edges: { bottom: true, left: true } },
  { name: 'topLeft', edges: { top: true, left: true } },
];

const NO_EDGES: Edges = {
  top: false,
  right: false,
  bottom: false,
  left: false,
};
const ALL_EDGES: Edges = { top: true, right: true, bottom: true, left: true };

// Whether an event is one of a drag: only those carry what is being dragged
const isDragEvent = (event: Event): event is DragEvent =>
  'dataTransfer' in event;

export function createGroupNodes({
  groups,
  tabs,
  groupState,
  tabNodes,
  drag,
  i18n,
  clock,
  confirm,
  leaveView,
  layoutMode,
  exclusively,
  logger,
}: GroupNodesDeps): GroupNodes {
  const nodes = new Map<number, GroupNode>();
  let pinnedContent: HTMLElement | undefined;

  // A handler has nobody to report a failure to
  const report = (action: Promise<unknown>): void => {
    action.catch((error: unknown) => {
      logger.error('[View] A group handler failed:', error);
    });
  };

  function updateFit(group: Group | null): void {
    const node = group === null ? undefined : nodes.get(group.id);
    if (node === undefined) {
      return;
    }

    // The last child is the button for a new tab
    const children = Array.from(node.content.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    node.tabCount.replaceChildren(
      document.createTextNode(String(children.length - 1)),
    );

    const rect = node.content.getBoundingClientRect();
    const plan = planTiles(
      { width: rect.width, height: rect.height },
      children.length,
    );
    node.newtab.style.display = plan.deck ? 'none' : 'block';

    children.forEach((child, index) => {
      const { left, top } = tilePosition(plan, index);
      child.classList.toggle('small', plan.small);
      child.style.width = px(plan.width);
      child.style.height = px(plan.height);
      child.style.left = px(left);
      child.style.top = px(top);
      child.style.zIndex = String(index);
    });
  }

  function resize(draggedId?: number, draggedRect?: Group['rect']): void {
    groups.forEach((group) => {
      const node = nodes.get(group.id)?.group;
      const space = node?.parentElement?.getBoundingClientRect();
      if (node === undefined || space === undefined) {
        return;
      }

      const rect =
        draggedRect !== undefined && draggedId === group.id
          ? draggedRect
          : group.rect;
      const box = boxOf(rect, { width: space.width, height: space.height });
      node.style.top = px(box.top);
      node.style.right = px(box.right);
      node.style.bottom = px(box.bottom);
      node.style.left = px(box.left);
      node.style.zIndex = stackingOf(group);

      updateFit(group);
    });
  }

  // Move or resize a group with the pointer, which follows it until it is let go
  async function transformGroup(
    group: Group,
    node: HTMLElement,
    edges: Edges,
    handle: HTMLElement,
  ): Promise<void> {
    // The groups are placed by the tiling, not by the user
    if ((await layoutMode()) !== 'freeform') {
      return;
    }

    document.body.setAttribute(
      'style',
      `cursor: ${window.getComputedStyle(handle).cursor}`,
    );
    const space = node.parentElement?.getBoundingClientRect();
    if (space === undefined) {
      return;
    }

    // Where the pointer was at the first move, and the group as of the last
    let origin: { x: number; y: number } | undefined;
    let latest: Group['rect'] | undefined;

    const onMove = (event: MouseEvent): void => {
      event.preventDefault();
      const point = {
        x: event.pageX / space.width,
        y: event.pageY / space.height,
      };
      if (origin === undefined) {
        origin = point;
        report(groups.transform(group.id, group.rect));
      }

      const others: Group['rect'][] = [];
      groups.forEach((other) => {
        if (other.id !== group.id) {
          others.push(other.rect);
        }
      });
      latest = transformRect({
        start: group.rect,
        edges,
        from: origin,
        to: point,
        others,
        space: { width: space.width, height: space.height },
      });
      resize(group.id, latest);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener(
      'mouseup',
      () => {
        if (latest !== undefined) {
          report(groups.transform(group.id, latest));
        }
        document.body.removeAttribute('style');
        document.removeEventListener('mousemove', onMove);
      },
      { once: true },
    );
  }

  function removeNode(groupId: number): void {
    nodes.get(groupId)?.group.remove();
    nodes.delete(groupId);
  }

  async function close(group: Group): Promise<void> {
    const node = nodes.get(group.id);
    // The last child is the button for a new tab
    const tabCount = (node?.content.children.length ?? 1) - 1;

    if (tabCount > 0) {
      const warning = getPluralForm(
        tabCount,
        i18n.getMessage('closeGroupWarning', [String(tabCount)]),
      );
      if (!confirm(warning ?? '')) {
        return;
      }
    }

    await groups.remove(group.id);
    removeNode(group.id);

    // The tabs went with the group, so the window goes to another
    const [first] = groups.getIds();
    if (tabCount > 0 && first !== undefined) {
      await groups.setActive(first);
    }
  }

  function make(group: Group): HTMLElement {
    const handles = HANDLES.map((handle) => ({
      ...handle,
      element: newElement('div', { class: handle.name }),
    }));

    const name = newElement('span', { class: 'name', content: group.name });
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.setAttribute('value', group.name);
    const tabCount = newElement('span', { class: 'tab_count' });
    const closeButton = newElement('div', {
      class: 'close',
      title: i18n.getMessage('closeGroup'),
    });
    const header = newElement(
      'div',
      { class: 'header', title: i18n.getMessage('dragGroup') },
      [
        name,
        input,
        newElement('span', { class: 'spacer' }),
        newElement('span', { class: 'group_id', content: group.id }),
        tabCount,
        closeButton,
      ],
    );

    const newtab = newElement('div', { class: 'newtab' }, [
      newElement('div', { class: 'inner' }),
    ]);
    const content = newElement(
      'div',
      { class: 'content transition', groupId: group.id },
      [newtab],
    );
    content.addEventListener('dragover', (event) => {
      if (isDragEvent(event)) {
        drag.over(event);
      }
    });
    content.addEventListener('drop', (event) => {
      if (isDragEvent(event)) {
        drag.drop(event);
      }
    });

    const inner = newElement('div', { class: 'inner' }, [
      ...handles.map(({ element }) => element),
      header,
      content,
    ]);
    const node = newElement('div', { class: 'group' }, [inner]);

    closeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      report(close(group));
    });

    newtab.addEventListener('click', (event) => {
      event.stopPropagation();
      report(
        groups
          .setActive(group.id)
          .then(() => tabs.openNew())
          .then(leaveView),
      );
    });
    // A press on the button must not move the whole group
    newtab.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });

    // The whole group is moved by pressing anywhere in it, except while its
    // name is being edited
    let editing = false;
    inner.addEventListener('mousedown', (event) => {
      if (editing) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      report(transformGroup(group, node, ALL_EDGES, header));
    });

    header.addEventListener('dblclick', () => {
      if (!editing) {
        editing = true;
        header.classList.add('edit');
        input.setSelectionRange(0, input.value.length);
        input.focus();
      }
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      header.classList.remove('edit');
      input.setSelectionRange(0, 0);
      name.replaceChildren(document.createTextNode(input.value));
      report(groups.rename(group.id, input.value));
      editing = false;
    });

    handles.forEach(({ edges, element }) => {
      element.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        report(transformGroup(group, node, { ...NO_EDGES, ...edges }, element));
      });
    });

    nodes.set(group.id, { group: node, content, newtab, tabCount });
    return node;
  }

  async function fillAll(): Promise<void> {
    const listed = await tabs.list();
    const placed = await Promise.all(
      listed.map(async (tab) => ({
        tab,
        place: tab.pinned
          ? ('pinned' as const)
          : await groupState.getTabGroup(tab.id),
      })),
    );

    const pinned = document.createDocumentFragment();
    const fragments = new Map<number, DocumentFragment>();
    groups.forEach((group) => {
      fragments.set(group.id, document.createDocumentFragment());
    });

    const fragmentFor = (
      place: number | 'pinned' | undefined,
    ): DocumentFragment | undefined => {
      if (place === 'pinned') {
        return pinned;
      }
      return place === undefined ? undefined : fragments.get(place);
    };

    placed.forEach(({ tab, place }) => {
      const element = tabNodes.elementOf(tab.id);
      // A tab with no group, or in the view's own, is not shown in any group
      const fragment = fragmentFor(place);
      if (element !== undefined && fragment !== undefined) {
        fragment.appendChild(element);
      }
    });

    groups.forEach((group) => {
      const node = nodes.get(group.id);
      const fragment = fragments.get(group.id);
      if (node !== undefined && fragment !== undefined) {
        node.content.insertBefore(fragment, node.newtab);
        updateFit(group);
      }
    });
    pinnedContent?.appendChild(pinned);
  }

  async function placeTab(tabId: number): Promise<void> {
    const tab = await tabs.get(tabId);
    const groupId = await groupState.getTabGroup(tab.id);
    // A tab that is in no group, or in one that is not shown, is not placed
    const node = groupId === undefined ? undefined : nodes.get(groupId);
    const element = tabNodes.elementOf(tab.id);
    if (node === undefined || element === undefined) {
      return;
    }

    // The tabs of the group that are shown, with their places in the window
    const shown = (await tabs.list()).filter(({ id }) =>
      node.content.contains(tabNodes.elementOf(id) ?? null),
    );
    const before = tabToPutBefore(tab.index, shown);
    const neighbour =
      before === undefined ? undefined : tabNodes.elementOf(before);
    node.content.insertBefore(element, neighbour ?? node.newtab);
  }

  return {
    make,
    contentOf: (groupId) => nodes.get(groupId)?.content,
    tabIdsOf: (groupId) =>
      Array.from(nodes.get(groupId)?.content.children ?? []).flatMap((child) =>
        child.hasAttribute('tabId')
          ? [Number(child.getAttribute('tabId'))]
          : [],
      ),
    newTabOf: (groupId) => nodes.get(groupId)?.newtab,
    updateFit,
    resize,
    raise(groupId) {
      const group = groups.get(groupId);
      const node = nodes.get(groupId);
      if (group === null || node === undefined) {
        return;
      }
      const lastMoved = clock.now();
      group.lastMoved = lastMoved;
      node.group.style.zIndex = stackingOf({ id: groupId, lastMoved });
    },
    close,

    async init(groupsNode, pinnedNode) {
      groups.forEach((group) => {
        // The system groups are not shown
        if (group.id >= 0) {
          groupsNode.appendChild(make(group));
        } else {
          logger.debug(
            `[View] Skipping system group ${String(group.id)} (${group.name}) from UI`,
          );
        }
      });
      pinnedContent = pinnedNode;
      await exclusively(fillAll);
    },

    fill: () => exclusively(fillAll),
    insertTab: (tabId) => exclusively(() => placeTab(tabId)),
  };
}
