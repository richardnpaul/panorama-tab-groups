/** Runs a task by itself: no other task of the same kind overlaps it */
export type Exclusively = <T>(task: () => Promise<T>) => Promise<T>;

/** The part of the Web Locks API (`navigator.locks`) that is used */
export interface Locks {
  request: <T>(name: string, callback: () => Promise<T>) => Promise<T>;
}

const LOCK_NAME = 'tgv-sessions';

/**
 * Tasks that read and write the same storage must take turns, and not only
 * within one page: the background, the view and the options page all run in
 * their own contexts, and a write from one that overlaps a write from another
 * loses one of them. Locks are shared by all the contexts of the extension;
 * without them, tasks can only take turns within this context.
 */
export function createExclusively(locks: Locks | undefined): Exclusively {
  if (locks !== undefined) {
    return (task) => locks.request(LOCK_NAME, task);
  }

  let queue: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = queue.then(task);
    // A failed task must not stop the ones after it
    queue = run.catch(() => undefined);
    return run;
  };
}
