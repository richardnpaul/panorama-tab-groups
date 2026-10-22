/** The extension itself, as the browser knows it */
export interface Extension {
  /** The address of a file of the extension */
  urlOf(path: string): string;
  openOptionsPage(): Promise<void>;
}
