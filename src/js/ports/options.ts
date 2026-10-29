import type { Options } from '../core/options.js';

/** The user's settings */
export interface OptionsStore {
  load(): Promise<Options>;
  /**
   * Whether a value for the option was ever stored, as against `load` giving its
   * default: the user has chosen, or the add-on has decided for them
   */
  isSet(name: keyof Options): Promise<boolean>;
  /** Keep the given options and leave the others as they are */
  save(changes: Partial<Options>): Promise<void>;
}
