import type { Logger } from '../ports/logger.js';
import type { OptionsStore } from '../ports/options.js';
import type { Toolbar } from '../ports/toolbar.js';

const POPUP_PAGE = 'popup-view/index.html';

export interface ViewRefreshDeps {
  options: OptionsStore;
  toolbar: Pick<Toolbar, 'setPopup'>;
  logger: Pick<Logger, 'debug'>;
}

export interface ViewRefresh {
  /** Make the button open the popup, or just click, as the user chose */
  applyPopup: () => Promise<void>;
  /** The user changed how the view is shown: pages showing it should reload */
  refreshView: () => Promise<void>;
  /** Whether pages showing the view are to reload */
  isOrdered: () => boolean;
  /** A page reloaded */
  clear: () => void;
}

export function createViewRefresh({
  options,
  toolbar,
  logger,
}: ViewRefreshDeps): ViewRefresh {
  let ordered = false;

  async function applyPopup(): Promise<void> {
    const { view } = await options.load();
    await toolbar.setPopup(view === 'popup' ? POPUP_PAGE : '');
  }

  return {
    applyPopup,

    async refreshView() {
      logger.debug('Refresh Panorama Tab View');
      ordered = true;
      await applyPopup();
    },

    isOrdered: () => ordered,

    clear() {
      ordered = false;
    },
  };
}
