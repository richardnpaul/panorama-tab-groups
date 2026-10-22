import type { Messaging } from '../../ports/messaging.js';

export interface MemoryMessaging extends Messaging {
  /** Every message sent so far, in order */
  readonly sent: object[];
  /** Answer every message from now on with this */
  reply(answer: unknown): void;
  /** Fail every message from now on with this */
  fail(error: Error): void;
}

/** Messaging that records what is sent and answers as it is told to */
export function createMemoryMessaging(): MemoryMessaging {
  const sent: object[] = [];
  let outcome: () => Promise<unknown> = () => Promise.resolve(undefined);

  return {
    sent,
    send(message) {
      sent.push(message);
      return outcome();
    },
    reply(answer) {
      outcome = () => Promise.resolve(answer);
    },
    fail(error) {
      outcome = () => Promise.reject(error);
    },
  };
}
