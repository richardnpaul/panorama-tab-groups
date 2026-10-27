import type { OptionsStore } from '../ports/options.js';

/**
 * Whether native tab groups are to be used: the browser must have them, and
 * the user must not have switched them off.
 */
export function createUseNativeGroups({
  hasTabGroups,
  options,
}: {
  hasTabGroups: boolean;
  options: Pick<OptionsStore, 'load'>;
}): () => Promise<boolean> {
  return async () => hasTabGroups && (await options.load()).useNativeGroups;
}
