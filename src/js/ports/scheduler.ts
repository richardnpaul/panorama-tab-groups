export type TimerHandle = number;

export interface Scheduler {
  /** Run `callback` once, after at least `delayMs` milliseconds */
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  /** Cancel a timer; harmless if it already ran or was cancelled */
  clearTimeout(handle: TimerHandle): void;
}
