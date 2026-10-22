import type { StorageArea } from '../../src/js/adapters/browser/sessions-emulation.js';

/** A stand-in for `browser.storage.local`: it keeps copies, like the real one */
export function createFakeStorage(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(
    Object.entries(structuredClone(initial)),
  );
  const calls: string[] = [];

  const area: StorageArea = {
    get: (key) => {
      calls.push(`get ${key}`);
      return Promise.resolve(
        data.has(key) ? { [key]: structuredClone(data.get(key)) } : {},
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
