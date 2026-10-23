/** A command of the extension and the keys that run it */
export interface Shortcut {
  name: string;
  // Empty when no keys run the command
  shortcut: string;
}

/** The keyboard shortcuts of the extension's commands */
export interface Shortcuts {
  getAll(): Promise<Shortcut[]>;
  /** Run the command with these keys from now on */
  update(name: string, shortcut: string): Promise<void>;
  /** Go back to the keys the extension came with */
  reset(name: string): Promise<void>;
}
