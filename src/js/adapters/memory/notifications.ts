import type { Notification, Notifications } from '../../ports/notifications.js';

export interface MemoryNotifications extends Notifications {
  /** The notifications on show, by id */
  readonly shown: Map<string, Notification>;
}

/** Notifications that are only remembered */
export function createMemoryNotifications(): MemoryNotifications {
  const shown = new Map<string, Notification>();

  return {
    shown,
    show(id, notification) {
      shown.set(id, { ...notification });
      return Promise.resolve();
    },
    clear(id) {
      shown.delete(id);
      return Promise.resolve();
    },
  };
}
