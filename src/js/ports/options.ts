import type { Options } from '../share/options.js';

/** The user's settings */
export interface OptionsStore {
  load(): Promise<Options>;
}
