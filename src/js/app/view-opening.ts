import type { OpeningView } from '../core/tab-assignment.js';
import type { Clock } from '../ports/clock.js';
import type { Logger } from '../ports/logger.js';
import type { Scheduler, TimerHandle } from '../ports/scheduler.js';

/** How long a request for the view tab is waited on before it is forgotten */
export const VIEW_OPENING_TIMEOUT_MS = 5000;

export interface ViewOpeningDeps {
  clock: Clock;
  scheduler: Scheduler;
  logger: Pick<Logger, 'debug' | 'warn'>;
}

/** A request for the Panorama view tab, as it is waited on */
export interface PendingView {
  /** Remember which tab the browser opened */
  opened: (tabId: number) => void;
}

export interface ViewOpening {
  /** The request that has been made and not yet answered by the tab */
  current: () => OpeningView | null;
  /**
   * Start waiting for a view tab to appear in a window. The tab may be
   * announced before the browser says which one it is, so this comes first.
   */
  begin: (windowId: number) => PendingView;
  /** The tab appeared: stop waiting */
  finish: () => void;
  /** A tab was closed; the request is over if it was the one asked for */
  tabRemoved: (tabId: number) => void;
}

interface Request {
  view: OpeningView;
  timer: TimerHandle;
}

export function createViewOpening({
  clock,
  scheduler,
  logger,
}: ViewOpeningDeps): ViewOpening {
  let request: Request | null = null;

  function finish(): void {
    if (request !== null) {
      scheduler.clearTimeout(request.timer);
      request = null;
    }
  }

  return {
    current: () => request?.view ?? null,

    begin(windowId) {
      finish();
      const view: OpeningView = {
        tabId: null,
        windowId,
        creationTimestamp: clock.now(),
      };
      const timer = scheduler.setTimeout(() => {
        logger.warn('View tab creation timed out, clearing state');
        request = null;
      }, VIEW_OPENING_TIMEOUT_MS);
      request = { view, timer };

      return {
        // Harmless once the request is over: nothing refers to the view then
        opened(tabId) {
          view.tabId = tabId;
        },
      };
    },

    finish,

    tabRemoved(tabId) {
      if (request?.view.tabId === tabId) {
        logger.debug('View tab removed during creation, cleared state');
        finish();
      }
    },
  };
}
