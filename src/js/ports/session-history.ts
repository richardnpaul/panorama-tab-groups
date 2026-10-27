/** The browser's record of tabs that were closed */
export interface SessionHistory {
  /** Rejects if the browser does not keep one, for example by the user's privacy settings */
  probe(): Promise<void>;
}
