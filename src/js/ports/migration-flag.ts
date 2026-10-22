/** Whether the groups have been moved to native tab groups once already */
export interface MigrationFlag {
  isComplete(): Promise<boolean>;
  setComplete(complete: boolean): Promise<void>;
}
