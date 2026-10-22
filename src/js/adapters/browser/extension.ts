import type { Extension } from '../../ports/extension.js';

/** The part of `browser.runtime` the extension uses to know itself */
export interface ExtensionApi {
  runtime: {
    getURL(path: string): string;
    openOptionsPage(): Promise<void>;
  };
}

export function createBrowserExtension(getApi: () => ExtensionApi): Extension {
  return {
    urlOf: (path) => getApi().runtime.getURL(path),
    openOptionsPage: () => getApi().runtime.openOptionsPage(),
  };
}
