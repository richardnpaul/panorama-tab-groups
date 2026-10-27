import type { Toolbar } from '../../ports/toolbar.js';

export interface MemoryToolbar extends Toolbar {
  readonly titles: Map<number, string>;
  readonly badgeTexts: Map<number, string>;
  badgeColor: string | undefined;
  defaultBadgeText: string | undefined;
  popup: string | undefined;
  /** Make every call from now on fail with this */
  failWith(error: Error): void;
}

/** A toolbar button that remembers what it was told to show */
export function createMemoryToolbar(): MemoryToolbar {
  const titles = new Map<number, string>();
  const badgeTexts = new Map<number, string>();
  let failure: Error | undefined;

  const run = (action: () => void): Promise<void> => {
    if (failure) {
      return Promise.reject(failure);
    }
    action();
    return Promise.resolve();
  };

  const toolbar: MemoryToolbar = {
    titles,
    badgeTexts,
    badgeColor: undefined,
    defaultBadgeText: undefined,
    popup: undefined,
    failWith(error) {
      failure = error;
    },
    setTitle: (windowId, title) =>
      run(() => {
        titles.set(windowId, title);
      }),
    setBadgeText: (windowId, text) =>
      run(() => {
        badgeTexts.set(windowId, text);
      }),
    setDefaultBadgeText: (text) =>
      run(() => {
        toolbar.defaultBadgeText = text;
      }),
    setPopup: (popup) =>
      run(() => {
        toolbar.popup = popup;
      }),
    setBadgeBackgroundColor: (color) =>
      run(() => {
        toolbar.badgeColor = color;
      }),
  };
  return toolbar;
}
