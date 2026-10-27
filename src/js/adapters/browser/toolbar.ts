import type { Toolbar } from '../../ports/toolbar.js';

/** The part of `browser.action` the extension uses */
export interface ToolbarApi {
  action: {
    setTitle(details: { title: string; windowId: number }): Promise<void>;
    setBadgeText(details: { text: string; windowId?: number }): Promise<void>;
    setPopup(details: { popup: string }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  };
}

export function createBrowserToolbar(getApi: () => ToolbarApi): Toolbar {
  return {
    setTitle: (windowId, title) =>
      getApi().action.setTitle({ title, windowId }),
    setBadgeText: (windowId, text) =>
      getApi().action.setBadgeText({ text, windowId }),
    setDefaultBadgeText: (text) => getApi().action.setBadgeText({ text }),
    setBadgeBackgroundColor: (color) =>
      getApi().action.setBadgeBackgroundColor({ color }),
    setPopup: (popup) => getApi().action.setPopup({ popup }),
  };
}
