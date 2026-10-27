import type { Extension } from '../../ports/extension.js';

export interface MemoryExtension extends Extension {
  /** How many times the options page was opened */
  optionsOpened: number;
}

/** An extension whose files are under the given address */
export function createMemoryExtension(
  base = 'moz-extension://id/',
): MemoryExtension {
  const self: MemoryExtension = {
    optionsOpened: 0,
    urlOf: (path) => `${base}${path}`,
    openOptionsPage() {
      self.optionsOpened += 1;
      return Promise.resolve();
    },
  };
  return self;
}
