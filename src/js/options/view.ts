import { requireElement } from '../share/dom.js';

interface ViewApi {
  storage: { sync: { set(items: Record<string, unknown>): Promise<void> } };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
}

const api = (): ViewApi => browser;

export function showViewSpecificOptions(currentView: string): void {
  // The toolbar options only apply to the freeform view
  requireElement(Element, '#optionsToolbar').toggleAttribute(
    'hidden',
    currentView !== 'freeform',
  );
}

export async function saveOptionView(): Promise<void> {
  const currentView = requireElement(
    HTMLInputElement,
    'input[name="view"]:checked',
  ).value;
  await api().storage.sync.set({ view: currentView });

  await api().runtime.sendMessage({ action: 'refreshView' });

  showViewSpecificOptions(currentView);
}
