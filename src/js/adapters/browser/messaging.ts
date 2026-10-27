import type { Messaging } from '../../ports/messaging.js';

export interface RuntimeApi {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
}

export function createBrowserMessaging(getApi: () => RuntimeApi): Messaging {
  return {
    send: (message) => getApi().runtime.sendMessage(message),
  };
}
