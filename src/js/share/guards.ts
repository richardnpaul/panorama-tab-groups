export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isString = (value: unknown): value is string =>
  typeof value === 'string';

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';

export const isNumber = (value: unknown): value is number =>
  typeof value === 'number';

/** What to tell of something that was thrown, which is not always an Error */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
