export interface Tabs {
  /** The ids of the tabs in the window the code is running in */
  listIdsInCurrentWindow(): Promise<number[]>;
}
