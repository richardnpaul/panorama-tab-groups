import type { Windows } from '../../ports/windows.js';

export interface WindowsApi {
  windows: { getCurrent(): Promise<{ id?: number | undefined }> };
}

export function createBrowserWindows(getApi: () => WindowsApi): Windows {
  return {
    async currentWindowId() {
      const { id } = await getApi().windows.getCurrent();
      if (id === undefined) {
        throw new Error('No current window');
      }
      return id;
    },
  };
}
