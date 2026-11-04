import type { OptionsStore } from '../ports/options.js';

/**
 * Whether native tab groups are to be used: the browser must have them, and the user must not
 * have switched them off. Where tabs cannot be hidden (Chromium) they are the only kind of
 * group, whatever is stored.
 */
export function createUseNativeGroups({
  hasTabGroups,
  hasTabHide,
  options,
}: {
  hasTabGroups: boolean;
  hasTabHide: boolean;
  options: Pick<OptionsStore, 'load'>;
}): () => Promise<boolean> {
  return async () =>
    hasTabGroups && (!hasTabHide || (await options.load()).useNativeGroups);
}
