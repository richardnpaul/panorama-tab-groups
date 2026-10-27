import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initDragScroll,
  type DragPointerEvent,
  type DragScrollDocument,
  type DragScrollElement,
  type DragScrollWindow,
} from '../../../src/js/view/dragscroll.js';

type Listener = (event: DragPointerEvent) => void;

function pointer(
  clientX: number,
  clientY: number,
  preventDefault = vi.fn(),
): DragPointerEvent {
  return { clientX, clientY, preventDefault };
}

function createListeners() {
  const byType = new Map<string, Listener[]>();
  return {
    add(type: string, listener: Listener): void {
      byType.set(type, [...(byType.get(type) ?? []), listener]);
    },
    fire(type: string, event: DragPointerEvent): void {
      (byType.get(type) ?? []).forEach((listener) => {
        listener(event);
      });
    },
    count(type: string): number {
      return (byType.get(type) ?? []).length;
    },
    typeCount(): number {
      return byType.size;
    },
  };
}

function createElement() {
  const listeners = createListeners();
  const element: DragScrollElement = {
    scrollLeft: 0,
    scrollTop: 0,
    addEventListener: (type: string, listener: Listener) => {
      listeners.add(type, listener);
    },
  };
  return { element, listeners };
}

function createWindow() {
  const listeners = createListeners();
  const win: DragScrollWindow = {
    addEventListener: (type: string, listener: Listener) => {
      listeners.add(type, listener);
    },
  };
  return { win, listeners };
}

function createDocument(
  readyState: string,
  elements: readonly DragScrollElement[],
) {
  const requestedClassNames: string[] = [];
  const doc: DragScrollDocument = {
    readyState,
    getElementsByClassName: (classNames: string) => {
      requestedClassNames.push(classNames);
      return elements;
    },
  };
  return { doc, requestedClassNames };
}

describe('view/dragscroll.ts', () => {
  let target: ReturnType<typeof createElement>;
  let browserWindow: ReturnType<typeof createWindow>;

  beforeEach(() => {
    target = createElement();
    browserWindow = createWindow();
  });

  describe('when to enable', () => {
    it('enables immediately when the document is already complete', () => {
      const { doc, requestedClassNames } = createDocument('complete', [
        target.element,
      ]);

      initDragScroll(doc, browserWindow.win);

      expect(requestedClassNames).toEqual(['dragscroll']);
      expect(target.listeners.count('mousedown')).toBe(1);
      expect(browserWindow.listeners.count('load')).toBe(0);
    });

    it.each(['loading', 'interactive'])(
      'waits for the load event while the document is %s',
      (readyState) => {
        const { doc, requestedClassNames } = createDocument(readyState, [
          target.element,
        ]);

        initDragScroll(doc, browserWindow.win);

        expect(requestedClassNames).toEqual([]);
        expect(target.listeners.typeCount()).toBe(0);
        expect(browserWindow.listeners.count('load')).toBe(1);

        browserWindow.listeners.fire('load', pointer(0, 0));

        expect(requestedClassNames).toEqual(['dragscroll']);
        expect(target.listeners.count('mousedown')).toBe(1);
      },
    );

    it('enables every element with the dragscroll class', () => {
      const other = createElement();

      initDragScroll(
        createDocument('complete', [target.element, other.element]).doc,
        browserWindow.win,
      );

      expect(target.listeners.count('mousedown')).toBe(1);
      expect(other.listeners.count('mousedown')).toBe(1);
      expect(browserWindow.listeners.count('mouseup')).toBe(2);
      expect(browserWindow.listeners.count('mousemove')).toBe(2);
    });

    it('does nothing when no element has the class', () => {
      initDragScroll(createDocument('complete', []).doc, browserWindow.win);

      expect(browserWindow.listeners.typeCount()).toBe(0);
    });
  });

  describe('dragging', () => {
    beforeEach(() => {
      initDragScroll(
        createDocument('complete', [target.element]).doc,
        browserWindow.win,
      );
      target.element.scrollLeft = 100;
      target.element.scrollTop = 200;
    });

    it('prevents the default mousedown behaviour', () => {
      const preventDefault = vi.fn();

      target.listeners.fire('mousedown', pointer(10, 10, preventDefault));

      expect(preventDefault).toHaveBeenCalledTimes(1);
    });

    it('scrolls opposite to the pointer movement while pressed', () => {
      target.listeners.fire('mousedown', pointer(50, 60));

      browserWindow.listeners.fire('mousemove', pointer(40, 90));

      expect(target.element.scrollLeft).toBe(110);
      expect(target.element.scrollTop).toBe(170);
    });

    it('measures each move from the previous pointer position', () => {
      target.listeners.fire('mousedown', pointer(50, 60));

      browserWindow.listeners.fire('mousemove', pointer(45, 62));
      browserWindow.listeners.fire('mousemove', pointer(43, 70));

      expect(target.element.scrollLeft).toBe(107);
      expect(target.element.scrollTop).toBe(190);
    });

    it('does not scroll when the pointer moves without being pressed', () => {
      browserWindow.listeners.fire('mousemove', pointer(10, 10));

      expect(target.element.scrollLeft).toBe(100);
      expect(target.element.scrollTop).toBe(200);
    });

    it('stops scrolling after mouseup', () => {
      target.listeners.fire('mousedown', pointer(50, 60));
      browserWindow.listeners.fire('mouseup', pointer(0, 0));

      browserWindow.listeners.fire('mousemove', pointer(0, 0));

      expect(target.element.scrollLeft).toBe(100);
      expect(target.element.scrollTop).toBe(200);
    });

    it('starts from the new position after a second press', () => {
      target.listeners.fire('mousedown', pointer(50, 60));
      browserWindow.listeners.fire('mousemove', pointer(40, 60));
      browserWindow.listeners.fire('mouseup', pointer(0, 0));
      target.listeners.fire('mousedown', pointer(10, 10));

      browserWindow.listeners.fire('mousemove', pointer(7, 4));

      expect(target.element.scrollLeft).toBe(113);
      expect(target.element.scrollTop).toBe(206);
    });
  });

  describe('multiple elements', () => {
    it('only scrolls the element that was pressed', () => {
      const other = createElement();
      initDragScroll(
        createDocument('complete', [target.element, other.element]).doc,
        browserWindow.win,
      );

      target.listeners.fire('mousedown', pointer(10, 10));
      browserWindow.listeners.fire('mousemove', pointer(5, 5));

      expect(target.element.scrollLeft).toBe(5);
      expect(target.element.scrollTop).toBe(5);
      expect(other.element.scrollLeft).toBe(0);
      expect(other.element.scrollTop).toBe(0);
    });
  });
});
