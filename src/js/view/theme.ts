import { classesWithPrefix, effectiveTheme } from '../core/view-nav.js';

/** What the view looks at to be dressed as the user wants */
export interface AppearanceDeps {
  body: { classList: DOMTokenList };
  systemPrefersDark: {
    readonly matches: boolean;
    addEventListener: (type: 'change', listener: () => void) => void;
  };
  settings: {
    read: () => Promise<{
      // Set by versions that only had a dark and a light theme
      useDarkTheme: boolean;
      theme: string;
      toolbarPosition: string;
    }>;
    // Remember that the old setting for the dark theme is now the theme
    saveDarkTheme: () => Promise<void>;
    // Told when the user changes the theme or the place of the toolbar
    onChange: (
      listener: (changes: { theme?: string; toolbarPosition?: string }) => void,
    ) => void;
  };
}

/**
 * Dress the page as the user wants, and keep it so: with the theme (following
 * the system when it is 'auto') and the toolbar at the place chosen.
 */
export async function applyAppearance({
  body,
  systemPrefersDark,
  settings,
}: AppearanceDeps): Promise<void> {
  const replaceClass = (prefix: string, value: string): void => {
    classesWithPrefix(Array.from(body.classList), prefix).forEach((name) => {
      body.classList.remove(name);
    });
    body.classList.add(`${prefix}-${value}`);
  };

  let theme: string;
  const setTheme = (next: string): void => {
    theme = next;
    replaceClass('theme', effectiveTheme(theme, systemPrefersDark.matches));
  };

  const stored = await settings.read();
  if (stored.useDarkTheme) {
    await settings.saveDarkTheme();
  }
  setTheme(stored.useDarkTheme ? 'dark' : stored.theme);
  replaceClass('toolbar', stored.toolbarPosition);

  systemPrefersDark.addEventListener('change', () => {
    if (theme === 'auto') {
      setTheme('auto');
    }
  });
  settings.onChange((changes) => {
    if (changes.theme !== undefined) {
      setTheme(changes.theme);
    }
    if (changes.toolbarPosition !== undefined) {
      replaceClass('toolbar', changes.toolbarPosition);
    }
  });
}
