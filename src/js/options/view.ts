import type { Messaging } from '../ports/messaging.js';
import type { OptionsStore } from '../ports/options.js';
import { requireElement } from '../share/dom.js';

export function showViewSpecificOptions(currentView: string): void {
  // The toolbar options only apply to the freeform view
  requireElement(Element, '#optionsToolbar').toggleAttribute(
    'hidden',
    currentView !== 'freeform',
  );
}

/** Keep the view that is checked on the page, and have the open views follow */
export function createViewSaver({
  options,
  messaging,
}: {
  options: Pick<OptionsStore, 'save'>;
  messaging: Messaging;
}): () => Promise<void> {
  return async () => {
    const currentView = requireElement(
      HTMLInputElement,
      'input[name="view"]:checked',
    ).value;
    await options.save({ view: currentView });

    await messaging.send({ action: 'refreshView' });

    showViewSpecificOptions(currentView);
  };
}
