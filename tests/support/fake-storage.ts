import type { StorageArea } from '../../src/js/adapters/browser/sessions-emulation.js';

/** A stand-in for `browser.storage.local`: it keeps copies, like the real one */
export function createFakeStorage(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(
    Object.entries(structuredClone(initial)),
  );
  const calls: string[] = [];

  const area: StorageArea = {
    get: (keys) => {
      calls.push(`get ${keys.join(',')}`);
      return Promise.resolve(
        Object.fromEntries(
          keys.flatMap((key) =>
            data.has(key) ? [[key, structuredClone(data.get(key))]] : [],
          ),
        ),
      );
    },
    set: (items) => {
      calls.push(`set ${Object.keys(items).join(',')}`);
      Object.entries(structuredClone(items)).forEach(([key, value]) => {
        data.set(key, value);
      });
      return Promise.resolve();
    },
  };

  return { area, data, calls };
}
