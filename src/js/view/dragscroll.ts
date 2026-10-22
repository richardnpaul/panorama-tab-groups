/**
 * Scroll an area by dragging it with the mouse.
 *
 * Replaces the vendored `dragscroll` 0.0.8 (MIT, asvd). Only the behaviour the
 * view uses is kept: elements carrying the `dragscroll` class scroll while the
 * primary pointer is held down on them.
 */

const DRAGSCROLL_CLASS = 'dragscroll';

export interface DragPointerEvent {
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
}

export interface DragScrollElement {
  scrollLeft: number;
  scrollTop: number;
  addEventListener(
    type: 'mousedown',
    listener: (event: DragPointerEvent) => void,
  ): void;
}

export interface DragScrollDocument {
  readonly readyState: string;
  getElementsByClassName(classNames: string): Iterable<DragScrollElement>;
}

export interface DragScrollWindow {
  addEventListener(type: 'load' | 'mouseup', listener: () => void): void;
  addEventListener(
    type: 'mousemove',
    listener: (event: DragPointerEvent) => void,
  ): void;
}

function enableDragScroll(
  element: DragScrollElement,
  win: DragScrollWindow,
): void {
  let pressed = false;
  let lastX = 0;
  let lastY = 0;

  element.addEventListener('mousedown', (event) => {
    pressed = true;
    lastX = event.clientX;
    lastY = event.clientY;
    event.preventDefault();
  });

  win.addEventListener('mouseup', () => {
    pressed = false;
  });

  win.addEventListener('mousemove', (event) => {
    if (!pressed) {
      return;
    }
    element.scrollLeft -= event.clientX - lastX;
    element.scrollTop -= event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  });
}

export function initDragScroll(
  doc: DragScrollDocument,
  win: DragScrollWindow,
): void {
  const enableAll = () => {
    Array.from(doc.getElementsByClassName(DRAGSCROLL_CLASS)).forEach(
      (element) => {
        enableDragScroll(element, win);
      },
    );
  };

  if (doc.readyState === 'complete') {
    enableAll();
  } else {
    win.addEventListener('load', enableAll);
  }
}
