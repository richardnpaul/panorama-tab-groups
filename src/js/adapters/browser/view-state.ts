import type {
  LayoutMode,
  Thumbnail,
  ViewState,
} from '../../ports/view-state.js';
import { isNumber, isRecord, isString } from '../../share/guards.js';
import type { SessionsApi } from './group-state.js';

/** What was stored as a thumbnail: a record, or the picture alone in older versions */
function thumbnailOf(value: unknown): Thumbnail | undefined {
  if (isString(value)) {
    return { image: value, capturedAt: undefined };
  }
  return isRecord(value) && isString(value.thumbnail)
    ? {
        image: value.thumbnail,
        capturedAt: isNumber(value.capturedTime)
          ? value.capturedTime
          : undefined,
      }
    : undefined;
}

const isLayoutMode = (value: unknown): value is LayoutMode =>
  value === 'freeform' || value === 'tiling';

export function createBrowserViewState(getApi: () => SessionsApi): ViewState {
  const sessions = () => getApi().sessions;

  return {
    async thumbnail(tabId) {
      return thumbnailOf(await sessions().getTabValue(tabId, 'thumbnail'));
    },
    setThumbnail: (tabId, { image, capturedAt }) =>
      sessions().setTabValue(tabId, 'thumbnail', {
        thumbnail: image,
        capturedTime: capturedAt,
      }),
    async layoutMode(windowId) {
      const stored = await sessions().getWindowValue(windowId, 'layoutMode');
      return isLayoutMode(stored) ? stored : undefined;
    },
    setLayoutMode: (windowId, mode) =>
      sessions().setWindowValue(windowId, 'layoutMode', mode),
  };
}
