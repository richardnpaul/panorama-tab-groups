// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ViewTab } from '../../../src/js/ports/view-tabs.js';
import { requireElement } from '../../../src/js/share/dom.js';
import { createTabList } from '../../../src/popup-view/tab-list.js';
import { flush } from '../../support/popup-page.js';

const tab = (id: number, extra: Partial<ViewTab> = {}): ViewTab => ({
  id,
  windowId: 1,
  index: id,
  title: `Title ${String(id)}`,
  url: `https://t${String(id)}.test/`,
  favIconUrl: `https://t${String(id)}.test/icon.png`,
  pinned: false,
  discarded: false,
  lastAccessed: 0,
  ...extra,
});

function setUp() {
  const open = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const logger = { error: vi.fn() };
  const i18n = { getMessage: vi.fn((name: string) => `[${name}]`) };
  const render = createTabList({ i18n, logger, open, close });
  return { render, open, close, logger, i18n };
}

const options = {
  hideCloseButton: false,
  lastUsedTabId: undefined,
  selectedTabId: undefined,
};

const query = (root: ParentNode, selector: string): HTMLElement =>
  requireElement(HTMLElement, selector, root);
const queryImage = (root: ParentNode, selector: string): HTMLImageElement =>
  requireElement(HTMLImageElement, selector, root);

describe('popup-view/tab-list.ts', () => {
  it('makes a list with an item for each tab, in order', () => {
    const { render } = setUp();

    const list = render([tab(1), tab(2), tab(3)], options);

    expect(list.tagName).toBe('UL');
    expect(list.classList.contains('list')).toBe(true);
    expect(
      Array.from(list.children).map((item) => item.getAttribute('data-tab')),
    ).toEqual(['1', '2', '3']);
  });

  it('makes an empty list for no tabs', () => {
    expect(setUp().render([], options).children).toHaveLength(0);
  });

  it('makes each item a row of the keyboard to move in', () => {
    const item = setUp().render([tab(1)], options).children[0];

    expect(item?.tagName).toBe('LI');
    expect(item?.getAttribute('data-nav-row')).toBe('');
    expect(item?.className).toBe('list__item list__item--tab');
  });

  it('shows the title, with the title and the address when the pointer rests on it', () => {
    const list = setUp().render([tab(1)], options);

    const link = query(list, '.list__link');
    expect(link.tagName).toBe('BUTTON');
    expect(link.title).toBe('Title 1\nhttps://t1.test/');
    expect(query(link, 'span').textContent).toBe('Title 1');
  });

  it('shows only the title when the tab has no address', () => {
    const list = setUp().render([tab(1, { url: undefined })], options);

    expect(query(list, '.list__link').title).toBe('Title 1');
  });

  it('shows the icon of the site, 16 pixels square, with no description', () => {
    const list = setUp().render([tab(1)], options);

    const icon = queryImage(list, 'img.tab__icon');
    expect(icon.getAttribute('src')).toBe('https://t1.test/icon.png');
    expect(icon.getAttribute('width')).toBe('16');
    expect(icon.getAttribute('height')).toBe('16');
    expect(icon.getAttribute('alt')).toBe('');
  });

  it('shows no address for the icon of a tab that has none', () => {
    const list = setUp().render([tab(1, { favIconUrl: undefined })], options);

    expect(query(list, 'img').hasAttribute('src')).toBe(false);
  });

  it('shows the text of a tab as text', () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const list = setUp().render(
      [tab(1, { title: hostile, url: hostile, favIconUrl: undefined })],
      options,
    );

    expect(query(list, '.list__link span').textContent).toBe(hostile);
    expect(list.querySelectorAll('img')).toHaveLength(1);
    expect(list.querySelector('script')).toBeNull();
    expect(query(list, '.list__link').title).toBe(`${hostile}\n${hostile}`);
  });

  it('marks the tab used last', () => {
    const list = setUp().render([tab(1), tab(2), tab(3)], {
      ...options,
      lastUsedTabId: 2,
    });

    expect(
      Array.from(list.children).map((item) =>
        item.classList.contains('list__item--highlight'),
      ),
    ).toEqual([false, true, false]);
  });

  it('selects the tab asked for, until the tab has the focus', () => {
    const list = setUp().render([tab(1), tab(2), tab(3)], {
      ...options,
      selectedTabId: 2,
    });
    const selected = () =>
      Array.from(list.children).map((item) =>
        item.classList.contains('list__item--selected'),
      );
    expect(selected()).toEqual([false, true, false]);

    list.querySelectorAll('.list__link')[0]?.dispatchEvent(new Event('blur'));
    expect(selected()).toEqual([false, true, false]);
    list.querySelectorAll('.list__link')[1]?.dispatchEvent(new Event('blur'));
    expect(selected()).toEqual([false, false, false]);
  });

  it('selects nothing unless asked', () => {
    const list = setUp().render([tab(1), tab(2)], options);

    expect(list.querySelector('.list__item--selected')).toBeNull();
  });

  it('has a button to close each tab, named in the language of the user', () => {
    const { render, i18n } = setUp();

    const list = render([tab(1)], options);

    const close = query(list, '.list__close');
    expect(close.tagName).toBe('BUTTON');
    expect(close.title).toBe('[closeTab]');
    expect(close.hidden).toBe(false);
    expect(i18n.getMessage).toHaveBeenCalledWith('closeTab');
  });

  it('hides the button to close the tabs when asked', () => {
    const list = setUp().render([tab(1)], {
      ...options,
      hideCloseButton: true,
    });

    expect(query(list, '.list__close').hidden).toBe(true);
  });

  describe('a click on the tab', () => {
    it('opens the tab, and the click does nothing else', () => {
      const { render, open, close } = setUp();
      const wanted = tab(2);
      const list = render([tab(1), wanted], options);
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });

      list.querySelectorAll('.list__link')[1]?.dispatchEvent(event);

      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(wanted);
      expect(close).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('reports a failure', async () => {
      const { render, open, logger } = setUp();
      const failure = new Error('gone');
      open.mockRejectedValue(failure);
      const list = render([tab(1)], options);

      query(list, '.list__link').dispatchEvent(new MouseEvent('click'));
      await flush();

      expect(logger.error).toHaveBeenCalledWith(
        '[Popup] A tab action failed:',
        failure,
      );
    });
  });

  describe('a click on the button to close', () => {
    it('closes the tab and takes it from the list', async () => {
      const { render, open, close } = setUp();
      const doomed = tab(2);
      const list = render([tab(1), doomed, tab(3)], options);
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });

      list.querySelectorAll('.list__close')[1]?.dispatchEvent(event);
      await flush();

      expect(close).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith(doomed);
      expect(open).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(
        Array.from(list.children).map((item) => item.getAttribute('data-tab')),
      ).toEqual(['1', '3']);
    });

    it('leaves the tab in the list until it is closed', async () => {
      const { render, close } = setUp();
      let finish: () => void = () => undefined;
      close.mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const list = render([tab(1)], options);

      query(list, '.list__close').dispatchEvent(new MouseEvent('click'));
      await flush();
      expect(list.children).toHaveLength(1);

      finish();
      await flush();
      expect(list.children).toHaveLength(0);
    });

    it('keeps the tab in the list and reports it when the tab could not be closed', async () => {
      const { render, close, logger } = setUp();
      const failure = new Error('no');
      close.mockRejectedValue(failure);
      const list = render([tab(1)], options);

      query(list, '.list__close').dispatchEvent(new MouseEvent('click'));
      await flush();

      expect(list.children).toHaveLength(1);
      expect(logger.error).toHaveBeenCalledWith(
        '[Popup] A tab action failed:',
        failure,
      );
    });
  });
});
