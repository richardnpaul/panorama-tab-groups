import type { Options } from '../core/options.js';

/** The user's settings */
export interface OptionsStore {
  load(): Promise<Options>;
  /** Keep the given options and leave the others as they are */
  save(changes: Partial<Options>): Promise<void>;
}
