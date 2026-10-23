import type { Downloads } from '../../ports/downloads.js';

/** The part of `browser.downloads` the extension uses */
export interface DownloadsApi {
  downloads: {
    download(options: {
      url: string;
      filename: string;
      conflictAction: 'uniquify';
      saveAs: boolean;
    }): Promise<unknown>;
  };
}

/** Makes a link that the browser can download a piece of text from */
export type ObjectUrlMaker = (content: string) => string;

export function createBrowserDownloads(
  getApi: () => DownloadsApi,
  makeUrl: ObjectUrlMaker,
): Downloads {
  return {
    async saveFile(content, filename) {
      await getApi().downloads.download({
        url: makeUrl(content),
        filename,
        conflictAction: 'uniquify',
        saveAs: true,
      });
    },
  };
}
