import { isBoolean, isRecord, isString } from '../share/guards.js';

export interface ShortcutOption {
  disabled: boolean;
}

export interface Options {
  toolbarPosition: string;
  useNativeGroups: boolean;
  shortcut: Record<string, ShortcutOption>;
  theme: string;
  view: string;
}

// The look of the view when the user has chosen nothing; the appearance
// settings of the view read the same keys
export const DEFAULT_THEME = 'auto';
export const DEFAULT_TOOLBAR_POSITION = 'top';

export function createDefaultOptions(
  manifestVersion: string,
  hasTabGroupsApi: boolean,
): Options {
  return {
    toolbarPosition: DEFAULT_TOOLBAR_POSITION,
    useNativeGroups: hasTabGroupsApi, // Default: enabled if API available
    shortcut: {
      'activate-next-group': { disabled: false },
      'activate-previous-group': { disabled: false },
      'manage-extension': { disabled: false },
    },
    theme: DEFAULT_THEME,
    view: parseInt(manifestVersion, 10) >= 1 ? 'popup' : 'freeform',
  };
}

function isShortcutOption(value: unknown): value is ShortcutOption {
  return isRecord(value) && isBoolean(value.disabled);
}

function parseShortcuts(
  value: unknown,
  fallback: Options['shortcut'],
): Options['shortcut'] {
  if (!isRecord(value)) {
    return fallback;
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, option]) => {
      if (!isShortcutOption(option)) {
        return [];
      }
      const entry: [string, ShortcutOption] = [
        name,
        { disabled: option.disabled },
      ];
      return [entry];
    }),
  );
}

function pick<T>(
  value: unknown,
  fallback: T,
  isValid: (candidate: unknown) => candidate is T,
): T {
  return isValid(value) ? value : fallback;
}

/**
 * Turn what storage returned into options, falling back to the default for
 * every field that is missing or has the wrong type.
 */
export function parseOptions(stored: unknown, defaults: Options): Options {
  const values = isRecord(stored) ? stored : {};
  return {
    toolbarPosition: pick(
      values.toolbarPosition,
      defaults.toolbarPosition,
      isString,
    ),
    useNativeGroups: pick(
      values.useNativeGroups,
      defaults.useNativeGroups,
      isBoolean,
    ),
    shortcut: parseShortcuts(values.shortcut, defaults.shortcut),
    theme: pick(values.theme, defaults.theme, isString),
    view: pick(values.view, defaults.view, isString),
  };
}
