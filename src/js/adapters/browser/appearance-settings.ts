import { isRecord, isString } from '../../share/guards.js';

/** The part of the browser the settings of the look of the view are kept in */
export interface AppearanceStorageApi {
  storage: {
    sync: {
      get(defaults: {
        useDarkTheme: boolean;
        theme: string;
        toolbarPosition: string;
      }): Promise<Record<string, unknown>>;
      set(items: { useDarkTheme: null; theme: string }): Promise<void>;
    };
    onChanged: {
      addListener(
        listener: (
          changes: Record<string, { newValue?: unknown } | undefined>,
          areaName: string,
        ) => void,
      ): void;
    };
  };
}

const DEFAULTS = { useDarkTheme: false, theme: 'auto', toolbarPosition: 'top' };

export function createAppearanceSettings(getApi: () => AppearanceStorageApi) {
  const storage = () => getApi().storage;

  return {
    async read() {
      const stored: unknown = await storage().sync.get(DEFAULTS);
      const values = isRecord(stored) ? stored : {};
      return {
        useDarkTheme: values.useDarkTheme === true,
        theme: isString(values.theme) ? values.theme : DEFAULTS.theme,
        toolbarPosition: isString(values.toolbarPosition)
          ? values.toolbarPosition
          : DEFAULTS.toolbarPosition,
      };
    },

    saveDarkTheme: () =>
      storage().sync.set({ useDarkTheme: null, theme: 'dark' }),

    onChange(
      listener: (changes: { theme?: string; toolbarPosition?: string }) => void,
    ) {
      storage().onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync') {
          return;
        }
        const theme = changes.theme?.newValue;
        const toolbarPosition = changes.toolbarPosition?.newValue;
        listener({
          ...(isString(theme) ? { theme } : {}),
          ...(isString(toolbarPosition) ? { toolbarPosition } : {}),
        });
      });
    },
  };
}
