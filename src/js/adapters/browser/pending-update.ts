import type { PendingUpdate } from '../../ports/pending-update.js';
import type { SessionArea } from './group-state.js';

const SESSION_KEY = 'updatePending';

/** The part of `browser.storage` the flag lives in; Firefox before 115 has no `session` */
export interface PendingUpdateApi {
  storage?: { session?: SessionArea | undefined } | undefined;
}

export function createBrowserPendingUpdate(
  getApi: () => PendingUpdateApi,
): PendingUpdate {
  const area = () => getApi().storage?.session;

  return {
    async isPending() {
      const found = await area()?.get([SESSION_KEY]);
      return found?.[SESSION_KEY] === 1;
    },

    async set(pending) {
      if (pending) {
        await area()?.set({ [SESSION_KEY]: 1 });
      } else {
        await area()?.remove([SESSION_KEY]);
      }
    },
  };
}
