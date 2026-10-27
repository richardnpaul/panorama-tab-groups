import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { ViewState } from '../ports/view-state.js';
import type { ViewTab, ViewTabs } from '../ports/view-tabs.js';
import { newElement } from '../share/utils.js';

/** What happens as a tab is dragged about; each is the listener of a drag event */
export interface TabDragHandlers {
  start: (event: DragEvent) => void;
  enter: (event: DragEvent) => void;
  over: (event: DragEvent) => void;
  leave: (event: DragEvent) => void;
  drop: (event: DragEvent) => void;
  end: (event: DragEvent) => void;
}

export interface TabNodesDeps {
  tabs: Pick<ViewTabs, 'list' | 'activate' | 'close'>;
  viewState: Pick<ViewState, 'thumbnail'>;
  i18n: I18n;
  drag: TabDragHandlers;
  // Close the view when the user has gone to a tab
  leaveView: () => Promise<void>;
  // Settles if the picture loads, rejects if it cannot
  imageLoads: (url: string) => Promise<void>;
  logger: Pick<Logger, 'error'>;
}

interface TabNode {
  tab: HTMLElement;
  inner: HTMLElement;
  thumbnail: HTMLElement;
  favicon: HTMLElement;
  name: HTMLElement;
}

export interface TabNodes {
  /** Make the node of a tab, which is not in the page until it is put there */
  make: (tab: ViewTab) => void;
  /** The node of a tab, if there is one */
  elementOf: (tabId: number) => HTMLElement | undefined;
  update: (tab: ViewTab) => void;
  updateFavicon: (tab: ViewTab) => Promise<void>;
  /** Show the thumbnail given, or the one that was kept if none is given */
  updateThumbnail: (tabId: number, image?: string) => Promise<void>;
  /** Mark the node of the tab as the selected one, and no other */
  select: (tabId: number) => void;
  /** Select the tab used most recently, other than the one given */
  selectMostRecent: (otherThan: number) => Promise<void>;
  /** The selected tab, or -1 if none is */
  selectedId: () => number;
  remove: (tabId: number) => void;
  /** Make the nodes of all the tabs of the window, and select a tab */
  init: (viewTabId: number) => Promise<void>;
}

// Where Firefox keeps the pictures of its own pages; they cannot be shown here
const FIREFOX_SKIN = 'chrome://mozapps/skin/';

export function createTabNodes({
  tabs,
  viewState,
  i18n,
  drag,
  leaveView,
  imageLoads,
  logger,
}: TabNodesDeps): TabNodes {
  const nodes = new Map<number, TabNode>();
  let selected = -1;

  // A handler has nobody to report a failure to
  const report = (action: Promise<unknown>): void => {
    action.catch((error: unknown) => {
      logger.error('[View] A tab handler failed:', error);
    });
  };

  function make(tab: ViewTab): void {
    const thumbnail = newElement('div', { class: 'thumbnail' });
    const favicon = newElement('div', { class: 'favicon' });
    const close = newElement('div', {
      class: 'close',
      title: i18n.getMessage('closeTab'),
    });
    const name = newElement('div', { class: 'name' });
    const inner = newElement('div', { class: 'inner' }, [
      thumbnail,
      favicon,
      close,
      name,
    ]);
    const node = newElement(
      'div',
      { class: 'tab', draggable: 'true', tabId: tab.id },
      [inner],
    );

    node.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      report(tabs.activate(tab.id).then(leaveView));
    });
    node.addEventListener('auxclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      // The middle button
      if (event.button === 1) {
        report(tabs.close(tab.id));
      }
    });
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      report(tabs.close(tab.id));
    });

    node.addEventListener('dragstart', drag.start);
    node.addEventListener('dragenter', drag.enter);
    node.addEventListener('dragover', drag.over);
    node.addEventListener('dragleave', drag.leave);
    node.addEventListener('drop', drag.drop);
    node.addEventListener('dragend', drag.end);

    // The whole content of a group is moved by dragging it, but a tab dragged
    // from it moves just the tab
    node.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });

    nodes.set(tab.id, { tab: node, inner, thumbnail, favicon, name });
  }

  function update(tab: ViewTab): void {
    const node = nodes.get(tab.id);
    if (node === undefined) {
      return;
    }

    node.name.replaceChildren(document.createTextNode(tab.title));
    node.inner.title = tab.title;
    node.tab.classList.toggle('inactive', tab.discarded);
    node.tab.classList.toggle('pinned', tab.pinned);
    if (tab.pinned) {
      // Pinned tabs are not sized by their group
      node.tab.style.width = '';
      node.tab.style.height = '';
    }
  }

  async function updateFavicon(tab: ViewTab): Promise<void> {
    const node = nodes.get(tab.id);
    if (node === undefined) {
      return;
    }

    const url = tab.favIconUrl;
    if (
      url === undefined ||
      url === '' ||
      url.startsWith(FIREFOX_SKIN) ||
      url === tab.url
    ) {
      node.favicon.classList.remove('visible');
      return;
    }

    try {
      await imageLoads(url);
      node.favicon.style.backgroundImage = `url(${url})`;
      node.favicon.classList.add('visible');
    } catch {
      node.favicon.style.backgroundImage = '';
      node.favicon.classList.remove('visible');
    }
  }

  async function updateThumbnail(tabId: number, image?: string): Promise<void> {
    const node = nodes.get(tabId);
    if (node === undefined) {
      return;
    }

    const shown = image ?? (await viewState.thumbnail(tabId))?.image;
    node.thumbnail.style.backgroundImage =
      shown === undefined || shown === '' ? '' : `url(${shown})`;
  }

  function select(tabId: number): void {
    const node = nodes.get(tabId);
    if (node === undefined) {
      return;
    }
    nodes.forEach((each) => {
      each.tab.classList.remove('selected');
    });
    node.tab.classList.add('selected');
    selected = tabId;
  }

  async function selectMostRecent(otherThan: number): Promise<void> {
    const listed = await tabs.list();
    listed.forEach(({ id }) => {
      nodes.get(id)?.tab.classList.remove('selected');
    });

    const [latest] = listed
      .filter(({ id }) => id !== otherThan)
      .sort((first, second) => second.lastAccessed - first.lastAccessed);
    if (latest !== undefined && nodes.has(latest.id)) {
      nodes.get(latest.id)?.tab.classList.add('selected');
      selected = latest.id;
    }
  }

  return {
    make,
    elementOf: (tabId) => nodes.get(tabId)?.tab,
    update,
    updateFavicon,
    updateThumbnail,
    select,
    selectMostRecent,
    selectedId: () => selected,

    remove(tabId) {
      nodes.get(tabId)?.tab.remove();
      nodes.delete(tabId);
    },

    async init(viewTabId) {
      await Promise.all(
        (await tabs.list()).map(async (tab) => {
          make(tab);
          update(tab);
          await updateFavicon(tab);
          await updateThumbnail(tab.id);
        }),
      );
      await selectMostRecent(viewTabId);
    },
  };
}
