export interface Windows {
  /** The id of the window the code is running in */
  currentWindowId(): Promise<number>;
}
