export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isString = (value: unknown): value is string =>
  typeof value === 'string';

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';

export const isNumber = (value: unknown): value is number =>
  typeof value === 'number';

/**
 * A version of the stored data: a whole number from 1. Anything else read back is no version, so a
 * stored 0, a fraction or `Infinity` cannot skip the migrations or count them from the end.
 */
export const isDataVersion = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 1;

/** What to tell of something that was thrown, which is not always an Error */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
