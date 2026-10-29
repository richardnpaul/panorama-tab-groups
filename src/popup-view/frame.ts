import { isBackKey, isNavKey, navigate } from '../js/core/popup.js';
import { runsFromTheRight } from '../js/share/direction.js';
import type { Scheduler } from '../js/ports/scheduler.js';

// What can have the focus in a row of a frame
const FOCUSABLE = 'button:not([hidden]), input:not([hidden])';
const ROW = '[data-nav-row]';

// Time for a frame to slide in, and for the one it covers to be taken away
const SLIDE_IN_MS = 200;
const HIDE_OLD_MS = 100;

// The frame brought in last in each shell: only that one takes the others
// away, or a slow timer of an earlier frame would take it away itself
const shownLast = new WeakMap<HTMLElement, HTMLElement>();

export interface FrameDeps {
  /** The frame, which has a header, a content and a footer */
  node: HTMLElement;
  /** What the frames are in: a frame slides in over the others in it */
  shell: HTMLElement;
  body: HTMLElement;
  scheduler: Pick<Scheduler, 'setTimeout'>;
  /** A frame at the side slides in over the main one */
  isAside: boolean;
  /** The arrow that points back (the left one, the right one where text runs from the right) was pressed on the first thing of a row */
  onBackAtStart?: () => void;
}

export interface Frame {
  node: HTMLElement;
  setHeader(content: Node | readonly Node[]): void;
  setContent(content: Node | readonly Node[]): void;
  setFooter(content: Node | readonly Node[]): void;
  /** Show that the frame has something to load */
  startLoading(): void;
  /** Bring the frame in; `onShown` is told when it has slid in */
  show(onShown?: () => void): void;
}

const toNodes = (content: Node | readonly Node[]): Node[] =>
  content instanceof Node ? [content] : [...content];

function section(node: HTMLElement, selector: string): HTMLElement {
  const found = node.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`The frame has no ${selector}`);
  }
  return found;
}

export function createFrame({
  node,
  shell,
  body,
  scheduler,
  isAside,
  onBackAtStart,
}: FrameDeps): Frame {
  const header = section(node, '.frame-header');
  const content = section(node, '.frame-content');
  const footer = section(node, '.frame-footer');

  // The place in a row that moving up and down keeps to
  let wanted = 0;

  const rowsOf = (): HTMLElement[] =>
    Array.from(node.querySelectorAll<HTMLElement>(ROW));
  const itemsOf = (row: HTMLElement): HTMLElement[] =>
    Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE));

  function moveFocus(event: KeyboardEvent): void {
    const { target, key } = event;
    const row =
      target instanceof Element ? target.closest<HTMLElement>(ROW) : null;
    if (row === null || !isNavKey(key)) {
      return;
    }
    const column = itemsOf(row).findIndex((item) => item === target);
    if (column === -1) {
      return;
    }

    const rtl = runsFromTheRight(node.ownerDocument);
    if (isBackKey(key, rtl) && column === 0 && onBackAtStart !== undefined) {
      onBackAtStart();
      return;
    }

    const rows = rowsOf();
    const items = rows.map(itemsOf);
    const next = navigate(
      key,
      items.map((each) => each.length),
      { row: rows.indexOf(row), column, wanted },
      rtl,
    );
    if (next !== null) {
      wanted = next.wanted;
      items
        .flatMap((each, place) =>
          place === next.row ? each.filter((_, at) => at === next.column) : [],
        )
        .forEach((item) => {
          item.focus();
        });
    }
  }

  node.addEventListener('mousedown', () => {
    body.classList.remove('keyboard-navigation');
  });
  node.addEventListener('keyup', (event) => {
    body.classList.add('keyboard-navigation');
    moveFocus(event);
  });

  return {
    node,
    setHeader: (nodes) => {
      header.replaceChildren(...toNodes(nodes));
    },
    setContent: (nodes) => {
      content.replaceChildren(...toNodes(nodes));
    },
    setFooter: (nodes) => {
      footer.replaceChildren(...toNodes(nodes));
    },
    startLoading: () => {
      body.classList.add('content-loading');
    },

    show(onShown) {
      node.classList.add('frame--active');
      shownLast.set(shell, node);
      shell.classList.toggle('frame-shell--aside-active', isAside);
      scheduler.setTimeout(() => {
        onShown?.();
      }, SLIDE_IN_MS);
      scheduler.setTimeout(() => {
        Array.from(shell.children)
          .filter(
            (sibling) => shownLast.get(shell) === node && sibling !== node,
          )
          .forEach((sibling) => {
            sibling.classList.remove('frame--active');
          });
      }, HIDE_OLD_MS);
      body.classList.remove('content-loading');
    },
  };
}
