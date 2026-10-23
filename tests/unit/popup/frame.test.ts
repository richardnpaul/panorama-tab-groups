// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import { createFrame } from '../../../src/popup-view/frame.js';
import { elementById, setUpPopupPage } from '../../support/popup-page.js';

function setUp(
  options: { isAside?: boolean; onLeftAtStart?: () => void } = {},
) {
  setUpPopupPage();
  const scheduler = createMemoryScheduler();
  const main = createFrame({
    node: elementById('main-frame'),
    shell: elementById('frame-shell'),
    body: document.body,
    scheduler,
    isAside: false,
  });
  const aside = createFrame({
    node: elementById('aside-frame'),
    shell: elementById('frame-shell'),
    body: document.body,
    scheduler,
    isAside: options.isAside ?? true,
    ...(options.onLeftAtStart === undefined
      ? {}
      : { onLeftAtStart: options.onLeftAtStart }),
  });
  return { main, aside, scheduler };
}

const button = (label: string): HTMLButtonElement => {
  const made = document.createElement('button');
  made.textContent = label;
  return made;
};

const row = (...items: HTMLElement[]): HTMLElement => {
  const made = document.createElement('div');
  made.setAttribute('data-nav-row', '');
  made.append(...items);
  return made;
};

const press = (key: string, on: EventTarget): void => {
  on.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
};

describe('popup-view/frame.ts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('the content', () => {
    it('sets the header, the content and the footer from a node, a list of nodes', () => {
      const { main } = setUp();
      const one = button('one');
      const two = button('two');
      const three = button('three');

      main.setHeader(one);
      main.setContent([two, three]);
      main.setFooter([]);

      expect(main.node.querySelector('.frame-header')?.children).toHaveLength(
        1,
      );
      expect(main.node.querySelector('.frame-header > button')).toBe(one);
      expect(
        Array.from(main.node.querySelector('.frame-content')?.children ?? []),
      ).toEqual([two, three]);
      expect(main.node.querySelector('.frame-footer')?.children).toHaveLength(
        0,
      );
    });

    it('replaces what was there', () => {
      const { main } = setUp();
      const header = main.node.querySelector('.frame-header');
      const content = main.node.querySelector('.frame-content');
      const footer = main.node.querySelector('.frame-footer');
      main.setHeader(button('old header'));
      main.setContent(button('old content'));
      main.setFooter(button('old footer'));

      main.setHeader(button('new header'));
      main.setContent(button('new content'));
      main.setFooter(button('new footer'));

      expect(header?.textContent).toBe('new header');
      expect(content?.textContent).toBe('new content');
      expect(footer?.textContent).toBe('new footer');
    });

    it('does not set the content as markup', () => {
      const { main } = setUp();
      const made = document.createElement('p');
      made.textContent = '<img src=x onerror=alert(1)>';

      main.setContent(made);

      expect(main.node.querySelector('img')).toBeNull();
    });

    it('is told what is missing from the page', () => {
      document.body.innerHTML = '<main id="main-frame"></main>';

      expect(() =>
        createFrame({
          node: elementById('main-frame'),
          shell: document.body,
          body: document.body,
          scheduler: createMemoryScheduler(),
          isAside: false,
        }),
      ).toThrow('The frame has no .frame-header');
    });

    it('is told what is missing from the page for each part', () => {
      document.body.innerHTML =
        '<main id="main-frame"><header class="frame-header"></header></main>';
      const make = () =>
        createFrame({
          node: elementById('main-frame'),
          shell: document.body,
          body: document.body,
          scheduler: createMemoryScheduler(),
          isAside: false,
        });
      expect(make).toThrow('The frame has no .frame-content');

      document.body.innerHTML =
        '<main id="main-frame"><header class="frame-header"></header><section class="frame-content"></section></main>';
      expect(make).toThrow('The frame has no .frame-footer');
    });
  });

  describe('show', () => {
    it('brings the frame in and no longer shows the loading', () => {
      const { main } = setUp();
      expect(document.body.classList.contains('content-loading')).toBe(true);

      main.show();

      expect(main.node.classList.contains('frame--active')).toBe(true);
      expect(document.body.classList.contains('content-loading')).toBe(false);
    });

    it('shows that the loading is under way', () => {
      const { main } = setUp();
      document.body.classList.remove('content-loading');

      main.startLoading();

      expect(document.body.classList.contains('content-loading')).toBe(true);
    });

    it('keeps the shell for the main frame and moves it aside for an aside frame', () => {
      const { main, aside } = setUp();
      const shell = elementById('frame-shell');

      aside.show();
      expect(shell.classList.contains('frame-shell--aside-active')).toBe(true);

      main.show();
      expect(shell.classList.contains('frame-shell--aside-active')).toBe(false);
    });

    it('takes the other frames away after 100 ms', () => {
      const { main, aside, scheduler } = setUp();
      main.show();
      scheduler.advance(100);
      expect(aside.node.classList.contains('frame--active')).toBe(false);

      aside.show();
      scheduler.advance(99);
      expect(main.node.classList.contains('frame--active')).toBe(true);
      scheduler.advance(1);

      expect(main.node.classList.contains('frame--active')).toBe(false);
      expect(aside.node.classList.contains('frame--active')).toBe(true);
    });

    it('is not taken away by the timer of a frame that was brought in before', () => {
      const { main, aside, scheduler } = setUp();
      main.show();
      aside.show();

      scheduler.advance(100);

      expect(aside.node.classList.contains('frame--active')).toBe(true);
      expect(main.node.classList.contains('frame--active')).toBe(false);
    });

    it('is not taken away by the timer of a frame brought in earlier, whichever ran first', () => {
      const { main, aside, scheduler } = setUp();
      aside.show();
      scheduler.advance(50);
      main.show();

      scheduler.advance(50);
      expect(main.node.classList.contains('frame--active')).toBe(true);
      scheduler.advance(50);

      expect(main.node.classList.contains('frame--active')).toBe(true);
      expect(aside.node.classList.contains('frame--active')).toBe(false);
    });

    it('says it is shown after 200 ms', () => {
      const { main, scheduler } = setUp();
      const shown = vi.fn();

      main.show(shown);
      scheduler.advance(199);
      expect(shown).not.toHaveBeenCalled();
      scheduler.advance(1);

      expect(shown).toHaveBeenCalledTimes(1);
    });

    it('needs nobody to be told', () => {
      const { main, scheduler } = setUp();

      main.show();

      expect(() => {
        scheduler.advance(300);
      }).not.toThrow();
    });
  });

  describe('the keyboard', () => {
    function fill(frame: ReturnType<typeof setUp>['main']) {
      const a = button('a');
      const b = button('b');
      const c = button('c');
      const d = button('d');
      const e = button('e');
      const input = document.createElement('input');
      frame.setHeader([a, b, c]);
      frame.setContent([row(d, e), row(input)]);
      frame.setFooter(button('f'));
      document.body.append(frame.node);
      return { a, b, c, d, e, input };
    }

    it('marks the page as used with the keyboard on a key, and not on a click', () => {
      const { main } = setUp();
      const { a } = fill(main);

      press('x', a);
      expect(document.body.classList.contains('keyboard-navigation')).toBe(
        true,
      );

      main.node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(document.body.classList.contains('keyboard-navigation')).toBe(
        false,
      );
    });

    it('moves along a row, and round its ends', () => {
      const { main } = setUp();
      const { a, b, c } = fill(main);

      a.focus();
      press('ArrowRight', a);
      expect(document.activeElement).toBe(b);
      press('ArrowRight', b);
      expect(document.activeElement).toBe(c);
      press('ArrowRight', c);
      expect(document.activeElement).toBe(a);
      press('ArrowLeft', a);
      expect(document.activeElement).toBe(c);
      press('ArrowLeft', c);
      expect(document.activeElement).toBe(b);
    });

    it('moves up and down between rows, and round the ends', () => {
      const { main } = setUp();
      const { a, d, input } = fill(main);
      const footerButton = main.node.querySelector<HTMLElement>(
        '.frame-footer button',
      );

      a.focus();
      press('ArrowDown', a);
      expect(document.activeElement).toBe(d);
      press('ArrowDown', d);
      expect(document.activeElement).toBe(input);
      press('ArrowDown', input);
      expect(document.activeElement).toBe(footerButton);
      press('ArrowDown', footerButton ?? a);
      expect(document.activeElement).toBe(a);
      press('ArrowUp', a);
      expect(document.activeElement).toBe(footerButton);
    });

    it('keeps to the place along the row it was at, as far as the row goes', () => {
      const { main } = setUp();
      const { a, b, c, e, input } = fill(main);

      a.focus();
      press('ArrowRight', a);
      press('ArrowRight', b);
      expect(document.activeElement).toBe(c);
      press('ArrowDown', c);
      expect(document.activeElement).toBe(e);
      press('ArrowDown', e);
      expect(document.activeElement).toBe(input);
      press('ArrowUp', input);
      expect(document.activeElement).toBe(e);
    });

    it('does not go to what is hidden', () => {
      const { main } = setUp();
      const { a, b, c, d } = fill(main);
      b.hidden = true;

      a.focus();
      press('ArrowRight', a);
      expect(document.activeElement).toBe(c);
      press('ArrowDown', c);
      expect(document.activeElement).toBe(d.nextElementSibling);
    });

    it('does not move to a row with nothing to focus', () => {
      const { main } = setUp();
      const { a, d, e } = fill(main);
      d.hidden = true;
      e.hidden = true;

      a.focus();
      press('ArrowDown', a);

      expect(document.activeElement).toBe(a);
    });

    it('leaves other keys alone', () => {
      const { main } = setUp();
      const { a } = fill(main);

      a.focus();
      press('Enter', a);
      press('a', a);

      expect(document.activeElement).toBe(a);
    });

    it('leaves a key alone that comes from something that is in no row', () => {
      const { main } = setUp();
      fill(main);
      const outside = button('outside');
      main.node.append(outside);

      outside.focus();
      press('ArrowRight', outside);

      expect(document.activeElement).toBe(outside);
    });

    it('leaves a key alone that comes from something in a row that cannot have the focus', () => {
      const { main } = setUp();
      const { b } = fill(main);
      const plain = document.createElement('span');
      main.node.querySelector('[data-nav-row]')?.append(plain);

      b.focus();
      press('ArrowRight', plain);

      expect(document.activeElement).toBe(b);
    });

    it('leaves a key alone that comes from something that is not an element', () => {
      const { main } = setUp();
      const { a } = fill(main);
      const text = document.createTextNode('text');
      main.node.append(text);

      a.focus();
      press('ArrowRight', text);

      expect(document.activeElement).toBe(a);
    });

    it('tells that the left arrow was pressed at the start of a row, and does not move', () => {
      const onLeftAtStart = vi.fn();
      const { aside } = setUp({ onLeftAtStart });
      const { a, b } = fill(aside);

      b.focus();
      press('ArrowLeft', b);
      expect(onLeftAtStart).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(a);

      press('ArrowLeft', a);
      expect(onLeftAtStart).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(a);
    });

    it('goes round to the end of a row at its start when nobody is told', () => {
      const { main } = setUp();
      const { a, c } = fill(main);

      a.focus();
      press('ArrowLeft', a);

      expect(document.activeElement).toBe(c);
    });

    it('does not tell of the right arrow, or of the left arrow elsewhere than the start', () => {
      const onLeftAtStart = vi.fn();
      const { aside } = setUp({ onLeftAtStart });
      const { a, c } = fill(aside);

      c.focus();
      press('ArrowRight', c);
      expect(document.activeElement).toBe(a);

      press('ArrowDown', a);
      expect(onLeftAtStart).not.toHaveBeenCalled();
    });
  });
});
