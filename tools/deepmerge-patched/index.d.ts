// The replacement stays JavaScript because addons-linter loads it as a package; this file lets its test be type-checked

export interface Options {
  arrayMerge?: (
    target: unknown[],
    source: unknown[],
    options: Options,
  ) => unknown[];
  clone?: boolean;
  customMerge?: (key: string | symbol) => unknown;
  isMergeableObject?: (value: unknown) => boolean;
  cloneUnlessOtherwiseSpecified?: (value: unknown, options: Options) => unknown;
}

declare function deepmerge(
  target: unknown,
  source: unknown,
  options?: Options,
): unknown;
declare namespace deepmerge {
  function all(array: unknown, options?: Options): unknown;
}
export default deepmerge;
