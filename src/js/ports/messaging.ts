export interface Messaging {
  /** Send a message to the extension's other pages and wait for the answer */
  send(message: object): Promise<unknown>;
}
