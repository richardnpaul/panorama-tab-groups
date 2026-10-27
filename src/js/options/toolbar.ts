import type { OptionsStore } from '../ports/options.js';
import { requireElement } from '../share/dom.js';

/** Keep the toolbar position that is checked on the page */
export function createToolbarSaver({
  options,
}: {
  options: Pick<OptionsStore, 'save'>;
}): () => Promise<void> {
  return async () => {
    await options.save({
      toolbarPosition: requireElement(
        HTMLInputElement,
        'input[name="toolbarPosition"]:checked',
      ).value,
    });
  };
}
