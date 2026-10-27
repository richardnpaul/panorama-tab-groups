import type { Shortcut, Shortcuts } from '../../ports/shortcuts.js';

export interface MemoryShortcuts extends Shortcuts {
  /** What was done, in order: `update first Ctrl+Y`, `reset first` */
  readonly calls: string[];
}

/** Commands kept in memory; the ones it starts with are what a reset goes back to */
export function createMemoryShortcuts(
  initial: readonly Shortcut[] = [],
): MemoryShortcuts {
  let current = initial.map((shortcut) => ({ ...shortcut }));
  const calls: string[] = [];

  const set = (name: string, shortcut: string) => {
    current = current.map((entry) =>
      entry.name === name ? { name, shortcut } : entry,
    );
  };

  return {
    calls,
    getAll: () => Promise.resolve(current.map((entry) => ({ ...entry }))),
    update(name, shortcut) {
      calls.push(`update ${name} ${shortcut}`);
      set(name, shortcut);
      return Promise.resolve();
    },
    reset(name) {
      calls.push(`reset ${name}`);
      const original = initial.find((entry) => entry.name === name);
      if (original !== undefined) {
        set(name, original.shortcut);
      }
      return Promise.resolve();
    },
  };
}
