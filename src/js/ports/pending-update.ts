/**
 * Whether a new version of the add-on is waiting for the add-on to start again. It is kept where it
 * outlasts the background being unloaded (which happens after a short idle time), and not an
 * update: the browser clears it when the add-on is updated or started again.
 */
export interface PendingUpdate {
  isPending(): Promise<boolean>;
  set(pending: boolean): Promise<void>;
}
