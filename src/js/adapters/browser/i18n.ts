import type { I18n } from '../../ports/i18n.js';

export interface I18nApi {
  i18n: { getMessage(messageName: string, substitutions?: string[]): string };
}

export function createBrowserI18n(getApi: () => I18nApi): I18n {
  return {
    getMessage: (messageName, substitutions) =>
      substitutions === undefined
        ? getApi().i18n.getMessage(messageName)
        : getApi().i18n.getMessage(messageName, [...substitutions]),
  };
}
