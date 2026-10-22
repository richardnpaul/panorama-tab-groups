export interface Logger {
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}
