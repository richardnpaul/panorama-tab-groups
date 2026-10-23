// The stub stays JavaScript because web-ext loads it as a package; this file lets its test be type-checked

export declare const UNAVAILABLE_MESSAGE: string;

export declare function createClient(): never;

declare const stub: { default: { createClient: typeof createClient } };
export default stub;
