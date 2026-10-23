import type {
  LayoutMode,
  Thumbnail,
  ViewState,
} from '../../ports/view-state.js';

/** View state kept in memory, with values copied in and out */
export function createMemoryViewState(): ViewState {
  const thumbnails = new Map<number, Thumbnail>();
  const layoutModes = new Map<number, LayoutMode>();

  return {
    thumbnail: (tabId) => {
      const found = thumbnails.get(tabId);
      return Promise.resolve(found && { ...found });
    },
    setThumbnail(tabId, thumbnail) {
      thumbnails.set(tabId, { ...thumbnail });
      return Promise.resolve();
    },
    layoutMode: (windowId) => Promise.resolve(layoutModes.get(windowId)),
    setLayoutMode(windowId, mode) {
      layoutModes.set(windowId, mode);
      return Promise.resolve();
    },
  };
}
