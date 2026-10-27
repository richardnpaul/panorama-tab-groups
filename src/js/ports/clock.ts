export interface Clock {
  /** Milliseconds since the epoch */
  now(): number;
}
