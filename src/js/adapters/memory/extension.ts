import type { Extension } from '../../ports/extension.js';

export interface MemoryExtension extends Extension {
  /** How many times the options page was opened */
  optionsOpened: number;
  /** How many times the extension was started again */
  reloads: number;
}

/** An extension whose files are under the given address */
export function createMemoryExtension(
  base = 'moz-extension://id/',
): MemoryExtension {
  const self: MemoryExtension = {
    optionsOpened: 0,
    reloads: 0,
    urlOf: (path) => `${base}${path}`,
    openOptionsPage() {
      self.optionsOpened += 1;
      return Promise.resolve();
    },
    reload() {
      self.reloads += 1;
    },
  };
  return self;
}
