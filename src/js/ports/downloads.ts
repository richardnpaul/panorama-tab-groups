/** The browser's downloads */
export interface Downloads {
  /** Offer text to be saved as a file, asking the user where */
  saveFile(content: string, filename: string): Promise<void>;
}
