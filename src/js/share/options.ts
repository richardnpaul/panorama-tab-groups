import { detectCapabilities, type CapabilityApi } from './capabilities.js';
import { isBoolean, isRecord, isString } from './guards.js';

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

// The narrow slice of the browser API this module uses. Reading the global at
// call time keeps it replaceable per test; the optional members are the
// capabilities that older browsers lack.
interface OptionsApi extends CapabilityApi {
  runtime: { getManifest(): { version: string } };
  storage: { sync: { get(keys: Options): Promise<Record<string, unknown>> } };
}

const api = (): OptionsApi => browser;

export function createDefaultOptions(
  manifestVersion: string,
  hasTabGroupsApi: boolean,
): Options {
  return {
    toolbarPosition: 'top',
    useNativeGroups: hasTabGroupsApi, // Default: enabled if API available
    shortcut: {
      'activate-next-group': { disabled: false },
      'activate-previous-group': { disabled: false },
      'manage-extension': { disabled: false },
    },
    theme: 'auto',
    view: parseInt(manifestVersion, 10) >= 1 ? 'popup' : 'freeform',
  };
}

export const defaultOptions: Options = createDefaultOptions(
  api().runtime.getManifest().version,
  detectCapabilities(api()).hasTabGroups,
);

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

/**
 * Return the current state of the options
 */
export async function loadOptions(): Promise<Options> {
  const stored = await api().storage.sync.get(defaultOptions);
  return parseOptions(stored, defaultOptions);
}

export const currentOptions = loadOptions();
