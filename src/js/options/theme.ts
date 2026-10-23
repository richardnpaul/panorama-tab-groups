import type { OptionsStore } from '../ports/options.js';
import { requireElement } from '../share/dom.js';

/** Keep the theme that is checked on the page */
export function createThemeSaver({
  options,
}: {
  options: Pick<OptionsStore, 'save'>;
}): () => Promise<void> {
  return async () => {
    const selectedTheme = requireElement(
      HTMLInputElement,
      'input[name="theme"]:checked',
    ).value;

    await options.save({ theme: selectedTheme });
  };
}
