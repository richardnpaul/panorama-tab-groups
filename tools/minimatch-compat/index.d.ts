// The replacement stays JavaScript because other packages load it as minimatch; this file lets its test be type-checked

export interface Options {
  dot?: boolean;
  nocase?: boolean;
  matchBase?: boolean;
}

export declare class Minimatch {
  constructor(pattern: string, options?: Options);
  match(path: string): boolean;
}

export declare function minimatch(
  path: string,
  pattern: string,
  options?: Options,
): boolean;
export declare function match(
  list: string[],
  pattern: string,
  options?: Options,
): string[];
export declare function filter(
  pattern: string,
  options?: Options,
): (path: string) => boolean;
export declare function braceExpand(
  pattern: string,
  options?: Options,
): string[];
export declare function escape(text: string): string;
export declare function unescape(text: string): string;
export declare function defaults(options: Options): typeof minimatch;
export declare const sep: string;
export declare const GLOBSTAR: unique symbol;
