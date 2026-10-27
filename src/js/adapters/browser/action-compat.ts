interface WithWindow {
  tabId?: number | undefined;
  windowId?: number | undefined;
}

// The same shapes as the details of browser.action.setTitle / setBadgeText
export interface TitleDetails extends WithWindow {
  title: string | null;
}

export interface BadgeTextDetails extends WithWindow {
  text: string | null;
}

/**
 * Chromium does not accept a window id for the toolbar button, so a call that
 * names one is made again without it (`withoutWindow` leaves it out). Anything
 * else that goes wrong is passed on.
 */
export function retryWithoutWindowId<D extends WithWindow>(
  original: (details: D) => Promise<void>,
  withoutWindow: (details: D) => D,
): (details: D) => Promise<void> {
  return async (details) => {
    try {
      await original(details);
    } catch (error) {
      if (details.windowId === undefined) {
        throw error;
      }
      await original(withoutWindow(details));
    }
  };
}
