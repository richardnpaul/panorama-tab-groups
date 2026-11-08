import type { SessionArea } from '../../src/js/adapters/browser/group-state.js';

/** A stand-in for `browser.storage.session`: it keeps copies, like the real one, in `values` */
export function createFakeSessionArea(values = new Map<string, unknown>()) {
  const area: SessionArea = {
    get: (keys) =>
      Promise.resolve(
        Object.fromEntries(
          (keys ?? [...values.keys()]).flatMap((key) =>
            values.has(key) ? [[key, structuredClone(values.get(key))]] : [],
          ),
        ),
      ),
    set: (items) => {
      Object.entries(structuredClone(items)).forEach(([key, value]) => {
        values.set(key, value);
      });
      return Promise.resolve();
    },
    remove: (keys) => {
      keys.forEach((key) => {
        values.delete(key);
      });
      return Promise.resolve();
    },
  };

  return { area, values };
}
