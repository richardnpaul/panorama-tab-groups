import type { Extension } from '../ports/extension.js';
import type { Logger } from '../ports/logger.js';
import type { Messaging } from '../ports/messaging.js';
import type { Notifications } from '../ports/notifications.js';
import type { Toolbar } from '../ports/toolbar.js';

const NOTIFICATION_ID = 'viewer-initializing';

export interface InitializationUiDeps {
  notifications: Notifications;
  toolbar: Pick<Toolbar, 'setDefaultBadgeText' | 'setBadgeBackgroundColor'>;
  messaging: Messaging;
  extension: Pick<Extension, 'urlOf'>;
  logger: Pick<Logger, 'debug'>;
}

/** What shows the user that the start-up is taking long */
export interface InitializationUi {
  isShowing: () => boolean;
  show: () => Promise<void>;
  hide: () => Promise<void>;
}

export function createInitializationUi({
  notifications,
  toolbar,
  messaging,
  extension,
  logger,
}: InitializationUiDeps): InitializationUi {
  let showing = false;

  // The view may not be open, and then there is nobody to tell
  const tellView = async (action: string): Promise<void> => {
    try {
      await messaging.send({ action });
    } catch {
      // Not open
    }
  };

  return {
    isShowing: () => showing,

    async show() {
      if (showing) {
        return;
      }
      showing = true;

      await notifications.show(NOTIFICATION_ID, {
        title: 'Tab Groups Viewer',
        message: 'Restoring tab groups...',
        iconUrl: extension.urlOf('icons/logo/logo-128.png'),
      });
      await toolbar.setDefaultBadgeText('...');
      await toolbar.setBadgeBackgroundColor('#FF9800');
      await tellView('showInitializationLoading');
      logger.debug('[Initialization] Loading UI displayed');
    },

    async hide() {
      if (!showing) {
        return;
      }

      await notifications.clear(NOTIFICATION_ID);
      await toolbar.setDefaultBadgeText('');
      await tellView('hideInitializationLoading');
      showing = false;
      logger.debug('[Initialization] Loading UI hidden');
    },
  };
}
