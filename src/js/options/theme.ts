import { requireElement } from '../share/dom.js';

interface ThemeApi {
  storage: { sync: { set(items: Record<string, unknown>): Promise<void> } };
}

const api = (): ThemeApi => browser;

export default async function saveOptionTheme(): Promise<void> {
  const selectedTheme = requireElement(
    HTMLInputElement,
    'input[name="theme"]:checked',
  ).value;

  await api().storage.sync.set({ theme: selectedTheme });
}
