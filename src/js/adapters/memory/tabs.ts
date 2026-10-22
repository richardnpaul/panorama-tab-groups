import type { Tabs } from '../../ports/tabs.js';

export interface MemoryTabs extends Tabs {
  setIds(ids: readonly number[]): void;
}

/** A window whose tabs are whatever it was told they are */
export function createMemoryTabs(ids: readonly number[] = []): MemoryTabs {
  let current = [...ids];

  return {
    listIdsInCurrentWindow: () => Promise.resolve([...current]),
    setIds(next) {
      current = [...next];
    },
  };
}
