import { mostRecentOtherTab } from '../core/view.js';
import type { Extension } from '../ports/extension.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';
import type { ViewOpening } from './view-opening.js';

export interface ViewToggleDeps {
  tabs: Pick<
    Tabs,
    'listInWindow' | 'listInCurrentWindow' | 'activate' | 'open'
  >;
  windows: Pick<Windows, 'currentWindowId'>;
  extension: Pick<Extension, 'urlOf'>;
  viewOpening: Pick<ViewOpening, 'begin'>;
}

/**
 * Open the viewer tab, or return to the last open tab if the view is
 * the tab being looked at now.
 */
export function createViewToggle({
  tabs,
  windows,
  extension,
  viewOpening,
}: ViewToggleDeps): () => Promise<void> {
  async function leave(viewTabId: number): Promise<void> {
    const target = mostRecentOtherTab(
      await tabs.listInCurrentWindow(),
      viewTabId,
    );
    if (target !== undefined) {
      await tabs.activate(target);
    }
  }

  async function open(windowId: number): Promise<void> {
    // The request is registered before the tab is made, since the browser may
    // announce the tab before it says which one it is
    const pending = viewOpening.begin(windowId);
    pending.opened(await tabs.open('/view.html', true));
  }

  return async function toggleView() {
    const windowId = await windows.currentWindowId();
    const windowTabs = await tabs.listInWindow(windowId);
    const viewUrl = extension.urlOf('view.html');
    const viewTab = windowTabs.find(({ url }) => url === viewUrl);

    if (viewTab === undefined) {
      await open(windowId);
    } else if (viewTab.active) {
      await leave(viewTab.id);
    } else {
      await tabs.activate(viewTab.id);
    }
  };
}
