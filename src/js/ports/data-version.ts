/** The version of the shape of the add-on's stored data, for the whole profile */
export interface DataVersion {
  /** None before version 2, which is the first that stored one */
  read(): Promise<number | undefined>;
  write(version: number): Promise<void>;
}
