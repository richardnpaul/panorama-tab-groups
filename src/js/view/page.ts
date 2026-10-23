import type { Size } from '../core/layout.js';
import type { Page } from './controller.js';

/** The part of the window that is used */
export interface WindowLike {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly location: { reload: () => void };
}

/** The part of the document that is used */
export interface DocumentLike {
  readonly hidden: boolean;
}

/** The page the view is in, as the controller needs to know it */
export function createPage(
  doc: DocumentLike,
  win: WindowLike,
  searchInput: { readonly value: string },
): Page {
  return {
    isHidden: () => doc.hidden,
    reload: () => {
      win.location.reload();
    },
    viewportSize: (): Size => ({
      width: win.innerWidth,
      height: win.innerHeight,
    }),
    searchText: () => searchInput.value,
  };
}
