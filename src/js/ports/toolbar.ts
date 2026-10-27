/** The extension's button in the browser toolbar */
export interface Toolbar {
  setTitle(windowId: number, title: string): Promise<void>;
  setBadgeText(windowId: number, text: string): Promise<void>;
  /** The badge for the windows that have none of their own */
  setDefaultBadgeText(text: string): Promise<void>;
  setBadgeBackgroundColor(color: string): Promise<void>;
  /** The page the button opens; the empty string for none, so it just clicks */
  setPopup(popup: string): Promise<void>;
}
