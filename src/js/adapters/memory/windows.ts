import type { Windows, WindowPlacement } from '../../ports/windows.js';

export interface MemoryWindows extends Windows {
  setCurrent(windowId: number): void;
  setLastFocused(windowId: number): void;
  open(windowId: number): void;
  close(windowId: number): void;
  /** Where each window was last placed */
  readonly placements: Map<number, WindowPlacement>;
  /** The id the next window made by `create` gets */
  nextId: number;
}

/** A browser whose windows are whatever it was told they are */
export function createMemoryWindows(
  windowId: number,
  lastFocusedId: number = windowId,
): MemoryWindows {
  let current = windowId;
  let lastFocused = lastFocusedId;
  const open = new Set([windowId, lastFocusedId]);
  const placements = new Map<number, WindowPlacement>();

  const self: MemoryWindows = {
    placements,
    nextId: 100,
    currentWindowId: () => Promise.resolve(current),
    lastFocusedWindowId: () => Promise.resolve(lastFocused),
    create() {
      const id = self.nextId;
      self.nextId += 1;
      open.add(id);
      return Promise.resolve(id);
    },
    place(id, placement) {
      placements.set(id, { ...placement });
      return Promise.resolve();
    },
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
  return self;
}
