import { requireElement } from '../share/dom.js';

interface ToolbarApi {
  storage: { sync: { set(items: Record<string, unknown>): Promise<void> } };
}

const api = (): ToolbarApi => browser;

export default async function saveOptionToolbarPosition(): Promise<void> {
  await api().storage.sync.set({
    toolbarPosition: requireElement(
      HTMLInputElement,
      'input[name="toolbarPosition"]:checked',
    ).value,
  });
}
