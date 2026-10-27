/** A picture of a tab kept to show it by, and when it was taken */
export interface Thumbnail {
  image: string;
  // Milliseconds since the epoch; not known for pictures kept by older versions
  capturedAt: number | undefined;
}

export type LayoutMode = 'freeform' | 'tiling';

/** What the view remembers about the tabs and the window */
export interface ViewState {
  thumbnail(tabId: number): Promise<Thumbnail | undefined>;
  setThumbnail(tabId: number, thumbnail: Thumbnail): Promise<void>;
  layoutMode(windowId: number): Promise<LayoutMode | undefined>;
  setLayoutMode(windowId: number, mode: LayoutMode): Promise<void>;
}
