import type { Windows } from '../../ports/windows.js';

export interface MemoryWindows extends Windows {
  setCurrent(windowId: number): void;
  setLastFocused(windowId: number): void;
  open(windowId: number): void;
  close(windowId: number): void;
}

/** A browser whose windows are whatever it was told they are */
export function createMemoryWindows(
  windowId: number,
  lastFocusedId: number = windowId,
): MemoryWindows {
  let current = windowId;
  let lastFocused = lastFocusedId;
  const open = new Set([windowId, lastFocusedId]);

  return {
    currentWindowId: () => Promise.resolve(current),
    lastFocusedWindowId: () => Promise.resolve(lastFocused),
    listIds: () => Promise.resolve([...open]),
    exists: (id) => Promise.resolve(open.has(id)),
    open(id) {
      open.add(id);
    },
    close(id) {
      open.delete(id);
    },
    setCurrent(next) {
      current = next;
      open.add(next);
    },
    setLastFocused(next) {
      lastFocused = next;
      open.add(next);
    },
  };
}
