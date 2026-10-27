/**
 * A value that other things need before it can be made, because it needs them:
 * they are given what it will do later, and it is bound once it exists.
 */
export interface Late<T> {
  get: () => T;
  bind: (value: T) => void;
}

export function createLate<T>(): Late<T> {
  let bound: { value: T } | undefined;

  return {
    get() {
      if (bound === undefined) {
        throw new Error('This is not ready yet');
      }
      return bound.value;
    },
    bind(value) {
      bound = { value };
    },
  };
}
