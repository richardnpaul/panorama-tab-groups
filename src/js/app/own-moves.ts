/**
 * The tabs the add-on is moving between native groups, while it does. A move takes a tab out of
 * its native group for a moment (it goes to the end of the window first, and Chromium takes a
 * tab out of its group when it is moved past the group), and the browser says so: that is the
 * add-on's own doing, not the person's, and is not followed.
 */
export interface OwnMoves {
  /** Do the work, while these tabs count as being moved by the add-on */
  during: <T>(tabIds: readonly number[], work: () => Promise<T>) => Promise<T>;
  /** Whether the add-on is moving this tab now */
  includes: (tabId: number) => boolean;
}

export function createOwnMoves(): OwnMoves {
  // How many moves each tab is in, as two can overlap
  const moving = new Map<number, number>();

  const change = (tabIds: readonly number[], by: 1 | -1): void => {
    tabIds.forEach((id) => {
      const left = (moving.get(id) ?? 0) + by;
      if (left > 0) {
        moving.set(id, left);
      } else {
        moving.delete(id);
      }
    });
  };

  return {
    includes: (tabId) => moving.has(tabId),

    async during(tabIds, work) {
      change(tabIds, 1);
      try {
        return await work();
      } finally {
        change(tabIds, -1);
      }
    },
  };
}
