import type { Windows } from '../../ports/windows.js';

export interface MemoryWindows extends Windows {
  setCurrent(windowId: number): void;
}

/** A browser whose current window is whatever it was told it is */
export function createMemoryWindows(windowId: number): MemoryWindows {
  let current = windowId;

  return {
    currentWindowId: () => Promise.resolve(current),
    setCurrent(next) {
      current = next;
    },
  };
}
