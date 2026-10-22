import type { Notifications } from '../../ports/notifications.js';

/** The part of `browser.notifications` the extension uses */
export interface NotificationsApi {
  notifications: {
    create(
      id: string,
      options: {
        type: 'basic';
        iconUrl: string;
        title: string;
        message: string;
      },
    ): Promise<unknown>;
    clear(id: string): Promise<unknown>;
  };
}

export function createBrowserNotifications(
  getApi: () => NotificationsApi,
): Notifications {
  return {
    async show(id, { title, message, iconUrl }) {
      await getApi().notifications.create(id, {
        type: 'basic',
        iconUrl,
        title,
        message,
      });
    },
    async clear(id) {
      await getApi().notifications.clear(id);
    },
  };
}
