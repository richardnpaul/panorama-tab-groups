// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import type {
  PopupGroup,
  PopupSnapshot,
} from '../../../src/js/app/popup-service.js';
import type { ViewTab } from '../../../src/js/ports/view-tabs.js';
import { createFrame } from '../../../src/popup-view/frame.js';
import { createGroupsFrame } from '../../../src/popup-view/groups-frame.js';
import { createTabList } from '../../../src/popup-view/tab-list.js';
import {
  elementById,
  flush,
  setUpPopupPage,
} from '../../support/popup-page.js';
import { requireElement } from '../../../src/js/share/dom.js';

const MESSAGES: Record<string, string> = {
  tabCount: 'one=$1 tab|other=$1 tabs',
  closeGroupWarning: 'one=Close $1 tab?|other=Close $1 tabs?',
  closeGroup: 'Close group',
  closeTab: 'Close tab',
  searchForTab_placeholder: 'Search for a tab...',
  searchForTab_noResults: 'No results',
  settingsButton: 'Settings',
  newGroupButton: 'New group',
};

// The language of the browser and the messages in it; English unless a test says otherwise
const RUSSIAN: Record<string, string> = {
  tabCount: 'one=$1 вкладка|few=$1 вкладки|many=$1 вкладок',
  closeGroupWarning:
    'one=Закрыть $1?|few=Закрыть $1 вкладки?|many=Закрыть $1 вкладок?',
};
let locale = 'en';
let messages = MESSAGES;

const i18n = {
  getMessage: (name: string, substitutions: readonly string[] = []) =>
    name === '@@ui_locale'
      ? locale
      : (messages[name] ?? name).replaceAll('$1', substitutions[0] ?? ''),
};

/** The browser is set to Russian, which has a form of its own for 2 to 4 and one for 5 and more */
const inRussian = (): void => {
  locale = 'ru';
  messages = { ...MESSAGES, ...RUSSIAN };
};

const tab = (id: number, title = `Title ${String(id)}`): ViewTab => ({
  id,
  windowId: 1,
  index: id,
  title,
  url: `https://t${String(id)}.test/`,
  favIconUrl: undefined,
  pinned: false,
  discarded: false,
  lastAccessed: 0,
});

const group = (id: number, name: string, tabs: ViewTab[]): PopupGroup => ({
  id,
  name,
  tabs,
});

const GROUPS = [
  group(1, 'Work', [tab(10, 'Alpha docs'), tab(11, 'Beta')]),
  group(2, 'Home', [tab(20, 'Gamma')]),
  group(3, 'Empty', []),
];

function setUp(
  snapshot: PopupSnapshot = {
    groups: GROUPS,
    lastUsed: { tabId: 20, groupId: 2 },
  },
) {
  setUpPopupPage();
  locale = 'en';
  messages = MESSAGES;
  const scheduler = createMemoryScheduler();
  const frame = createFrame({
    node: elementById('main-frame'),
    shell: elementById('frame-shell'),
    body: document.body,
    scheduler,
    isAside: false,
  });
  const logger = { error: vi.fn() };
  const openTab = vi.fn().mockResolvedValue(undefined);
  const service = {
    snapshot: vi.fn().mockResolvedValue(snapshot),
    showGroup: vi.fn().mockResolvedValue(undefined),
    createGroup: vi.fn().mockResolvedValue(9),
    addNewTab: vi.fn().mockResolvedValue(undefined),
    removeGroup: vi.fn().mockResolvedValue(true),
    moveGroup: vi.fn().mockResolvedValue(undefined),
  };
  const extension = { openOptionsPage: vi.fn().mockResolvedValue(undefined) };
  const closePopup = vi.fn();
  const confirm = vi.fn().mockReturnValue(true);
  const openDetail = vi.fn();
  const tabList = createTabList({
    i18n,
    logger,
    open: openTab,
    close: vi.fn().mockResolvedValue(undefined),
  });
  const groupsFrame = createGroupsFrame({
    frame,
    service,
    tabList,
    i18n,
    logger,
    extension,
    openTab,
    closePopup,
    confirm,
    openDetail,
  });
  return {
    ...groupsFrame,
    frame,
    scheduler,
    service,
    extension,
    closePopup,
    confirm,
    openDetail,
    openTab,
    logger,
  };
}

const content = () => elementById('main-frame').querySelector('.frame-content');
const items = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('.frame-content .list__item'),
  );
const zones = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('.frame-content .drop-zone'),
  );
const search = (): HTMLInputElement => {
  const found = document.querySelector<HTMLInputElement>('input[type=search]');
  if (found === null) {
    throw new Error('No search');
  }
  return found;
};
const type = (text: string): void => {
  const input = search();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (element: Element | null | undefined): void => {
  element?.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
};
const query = (root: ParentNode, selector: string): HTMLElement =>
  requireElement(HTMLElement, selector, root);
const dragEvent = (
  type_: string,
  dataTransfer: { setData: (...args: string[]) => void } | null = {
    setData: vi.fn(),
  },
): Event => {
  const event = new Event(type_, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
};

describe('popup-view/groups-frame.ts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('the groups', () => {
    it('shows the loading until the groups are known, then shows the frame', async () => {
      const env = setUp();
      let known: (snapshot: PopupSnapshot) => void = () => undefined;
      env.service.snapshot.mockReturnValue(
        new Promise<PopupSnapshot>((resolve) => {
          known = resolve;
        }),
      );
      document.body.classList.remove('content-loading');

      const rendering = env.render();
      expect(document.body.classList.contains('content-loading')).toBe(true);
      expect(items()).toHaveLength(0);

      known({ groups: GROUPS, lastUsed: null });
      await rendering;

      expect(document.body.classList.contains('content-loading')).toBe(false);
      expect(
        elementById('main-frame').classList.contains('frame--active'),
      ).toBe(true);
      expect(items()).toHaveLength(3);
    });

    it('lists the groups in order, with the number of tabs', async () => {
      const env = setUp();

      await env.render();

      expect(items().map((item) => item.id)).toEqual([
        'group-1',
        'group-2',
        'group-3',
      ]);
      expect(
        items().map(
          (item) => item.querySelector('.list__link span')?.textContent,
        ),
      ).toEqual(['Work', 'Home', 'Empty']);
      expect(
        items().map(
          (item) => item.querySelector('.list__link--extend span')?.textContent,
        ),
      ).toEqual(['2 tabs', '1 tab', '0 tabs']);
    });

    it('makes each group a row to move in, that can be dragged', async () => {
      const env = setUp();

      await env.render();

      items().forEach((item) => {
        expect(item.tagName).toBe('LI');
        expect(item.getAttribute('data-nav-row')).toBe('');
        expect(item.getAttribute('draggable')).toBe('true');
        expect(item.querySelector('.list__drag')).not.toBeNull();
        expect(
          item.querySelector('.list__close-wrapper > .list__link'),
        ).not.toBeNull();
        expect(
          item.querySelector('.list__close-wrapper > .list__close'),
        ).not.toBeNull();
      });
      expect(query(items()[0] ?? document.body, '.list__close').title).toBe(
        'Close group',
      );
    });

    it('marks the group of the tab used last', async () => {
      const env = setUp();

      await env.render();

      expect(
        items().map((item) => item.classList.contains('list__item--highlight')),
      ).toEqual([false, true, false]);
    });

    it('marks no group when there is no tab used last', async () => {
      const env = setUp({ groups: GROUPS, lastUsed: null });

      await env.render();

      expect(document.querySelector('.list__item--highlight')).toBeNull();
    });

    it('marks no group when the tab used last is in none', async () => {
      const env = setUp({
        groups: GROUPS,
        lastUsed: { tabId: 5, groupId: undefined },
      });

      await env.render();

      expect(document.querySelector('.list__item--highlight')).toBeNull();
    });

    it('shows the name of a group as text', async () => {
      const hostile = '<img src=x onerror=alert(1)>';
      const env = setUp({
        groups: [group(1, hostile, [])],
        lastUsed: null,
      });

      await env.render();

      expect(
        query(content() ?? document.body, '.list__link span').textContent,
      ).toBe(hostile);
      expect(document.querySelector('img')).toBeNull();
    });

    it('shows an empty list for no groups', async () => {
      const env = setUp({ groups: [], lastUsed: null });

      await env.render();

      expect(items()).toHaveLength(0);
    });

    it('shows the count of tabs in the form of the language, for the number', async () => {
      const many = [1, 2, 3, 4, 5].map((id) => tab(id));
      const env = setUp({ groups: [group(1, 'Many', many)], lastUsed: null });
      inRussian();

      await env.render();

      expect(
        query(items()[0] ?? document.body, '.list__link--extend span')
          .textContent,
      ).toBe('5 вкладок');
    });

    it('has the search field, the settings button and the button for a new group', async () => {
      const env = setUp();

      await env.render();

      const input = search();
      expect(input.name).toBe('query');
      expect(input.placeholder).toBe('Search for a tab...');
      expect(input.classList.contains('form-field__input')).toBe(true);
      expect(input.parentElement?.className).toBe(
        'form-field form-field--search',
      );
      const settings = query(
        elementById('main-frame'),
        '.frame-header .button-ghost--settings',
      );
      expect(settings.title).toBe('Settings');
      const newGroup = query(
        elementById('main-frame'),
        '.frame-footer .button-ghost--new',
      );
      expect(newGroup.textContent).toBe('New group');
    });

    it('gives the focus to the search field', async () => {
      const env = setUp();

      await env.render();

      expect(document.activeElement).toBe(search());
    });
  });

  describe('going to a group', () => {
    it('goes to the group and then closes the popup', async () => {
      const env = setUp();
      await env.render();
      const order: string[] = [];
      env.service.showGroup.mockImplementation(async () => {
        await Promise.resolve();
        order.push('shown');
      });
      env.closePopup.mockImplementation(() => order.push('closed'));

      click(items()[1]?.querySelector('.list__close-wrapper > .list__link'));
      await flush();

      expect(env.service.showGroup).toHaveBeenCalledWith(2);
      expect(order).toEqual(['shown', 'closed']);
    });

    it('keeps the popup open and reports it when the group cannot be shown', async () => {
      const env = setUp();
      await env.render();
      const failure = new Error('no');
      env.service.showGroup.mockRejectedValue(failure);

      click(items()[0]?.querySelector('.list__close-wrapper > .list__link'));
      await flush();

      expect(env.closePopup).not.toHaveBeenCalled();
      expect(env.logger.error).toHaveBeenCalledWith(
        '[Popup] An action failed:',
        failure,
      );
    });
  });

  describe('the tabs of a group', () => {
    it('are shown by the button for them', async () => {
      const env = setUp();
      await env.render();

      click(items()[1]?.querySelector('.list__link--extend'));

      expect(env.openDetail).toHaveBeenCalledTimes(1);
      expect(env.openDetail).toHaveBeenCalledWith(2, false);
    });

    it('are shown by the right arrow on the button for them, which does nothing else', async () => {
      const env = setUp();
      await env.render();
      const extend = query(items()[0] ?? document.body, '.list__link--extend');
      const reachedFrame = vi.fn();
      elementById('main-frame').addEventListener('keyup', reachedFrame);

      extend.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }),
      );

      expect(env.openDetail).toHaveBeenCalledWith(1, false);
      expect(reachedFrame).not.toHaveBeenCalled();
    });

    it('are shown by the left arrow, and not the right, where text runs from the right', async () => {
      document.documentElement.dir = 'rtl';
      try {
        const env = setUp();
        await env.render();
        const extend = query(
          items()[0] ?? document.body,
          '.list__link--extend',
        );

        extend.dispatchEvent(
          new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }),
        );
        expect(env.openDetail).not.toHaveBeenCalled();

        extend.dispatchEvent(
          new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }),
        );
        expect(env.openDetail).toHaveBeenCalledWith(1, false);
      } finally {
        document.documentElement.dir = 'ltr';
      }
    });

    it('are not shown by other keys', async () => {
      const env = setUp();
      await env.render();
      const extend = query(items()[0] ?? document.body, '.list__link--extend');
      const reachedFrame = vi.fn();
      elementById('main-frame').addEventListener('keyup', reachedFrame);

      extend.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }),
      );

      expect(env.openDetail).not.toHaveBeenCalled();
      expect(reachedFrame).toHaveBeenCalledTimes(1);
    });

    it('give the focus back to their button when the groups are shown again', async () => {
      const env = setUp();
      await env.render();
      click(items()[1]?.querySelector('.list__link--extend'));

      await env.render();

      expect(document.activeElement).toBe(
        query(items()[1] ?? document.body, '.list__link--extend'),
      );
    });

    it('give the focus back only once', async () => {
      const env = setUp();
      await env.render();
      click(items()[1]?.querySelector('.list__link--extend'));
      await env.render();

      await env.render();

      expect(document.activeElement).toBe(search());
    });

    it('give the focus to the search when the group is gone', async () => {
      const env = setUp();
      await env.render();
      click(items()[1]?.querySelector('.list__link--extend'));
      env.service.snapshot.mockResolvedValue({
        groups: [GROUPS[0] ?? group(1, 'x', [])],
        lastUsed: null,
      });

      await env.render();

      expect(document.activeElement).toBe(search());
    });
  });

  describe('closing a group', () => {
    const closeButtonOf = (index: number) =>
      items()[index]?.querySelector('.list__close');

    it('asks, with the number of tabs, and then removes the group', async () => {
      const env = setUp();
      await env.render();

      click(closeButtonOf(0));
      await flush();

      expect(env.confirm).toHaveBeenCalledWith('Close 2 tabs?');
      expect(env.service.removeGroup).toHaveBeenCalledWith(1);
      expect(items().map((item) => item.id)).toEqual(['group-2', 'group-3']);
    });

    it('asks in the singular for a group of one tab', async () => {
      const env = setUp();
      await env.render();

      click(closeButtonOf(1));
      await flush();

      expect(env.confirm).toHaveBeenCalledWith('Close 1 tab?');
    });

    it('asks in the form of the language, for the number of tabs', async () => {
      const many = [1, 2, 3, 4, 5].map((id) => tab(id));
      const env = setUp({ groups: [group(1, 'Many', many)], lastUsed: null });
      inRussian();
      await env.render();

      click(closeButtonOf(0));
      await flush();

      expect(env.confirm).toHaveBeenCalledWith('Закрыть 5 вкладок?');
    });

    it('leaves the group when the user does not want it removed', async () => {
      const env = setUp();
      env.confirm.mockReturnValue(false);
      await env.render();

      click(closeButtonOf(0));
      await flush();

      expect(env.service.removeGroup).not.toHaveBeenCalled();
      expect(items()).toHaveLength(3);
    });

    it('does not ask about a group with no tabs', async () => {
      const env = setUp();
      env.confirm.mockReturnValue(false);
      await env.render();

      click(closeButtonOf(2));
      await flush();

      expect(env.confirm).not.toHaveBeenCalled();
      expect(env.service.removeGroup).toHaveBeenCalledWith(3);
      expect(items().map((item) => item.id)).toEqual(['group-1', 'group-2']);
    });

    it('leaves the group in the list when it could not be removed', async () => {
      const env = setUp();
      env.service.removeGroup.mockResolvedValue(false);
      await env.render();

      click(closeButtonOf(0));
      await flush();

      expect(items()).toHaveLength(3);
    });

    it('reports a failure', async () => {
      const env = setUp();
      const failure = new Error('no');
      env.service.removeGroup.mockRejectedValue(failure);
      await env.render();

      click(closeButtonOf(0));
      await flush();

      expect(items()).toHaveLength(3);
      expect(env.logger.error).toHaveBeenCalledWith(
        '[Popup] An action failed:',
        failure,
      );
    });

    it('keeps a gap between the groups and at both ends', async () => {
      const env = setUp();
      await env.render();

      click(closeButtonOf(1));
      await flush();

      expect(zones().map((zone) => zone.getAttribute('data-index'))).toEqual([
        '0',
        '1',
        '2',
      ]);
    });
  });

  describe('the settings', () => {
    it('are opened, and then the popup is closed', async () => {
      const env = setUp();
      await env.render();
      const order: string[] = [];
      env.extension.openOptionsPage.mockImplementation(async () => {
        await Promise.resolve();
        order.push('opened');
      });
      env.closePopup.mockImplementation(() => order.push('closed'));

      click(document.querySelector('.button-ghost--settings'));
      await flush();

      expect(order).toEqual(['opened', 'closed']);
    });

    it('leave the popup open and report it when they cannot be opened', async () => {
      const env = setUp();
      await env.render();
      env.extension.openOptionsPage.mockRejectedValue(new Error('no'));

      click(document.querySelector('.button-ghost--settings'));
      await flush();

      expect(env.closePopup).not.toHaveBeenCalled();
      expect(env.logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('a new group', () => {
    it('is made, given a tab, and shown with its name to be asked for', async () => {
      const env = setUp();
      await env.render();
      const order: string[] = [];
      env.service.createGroup.mockImplementation(() => {
        order.push('created');
        return Promise.resolve(9);
      });
      env.service.addNewTab.mockImplementation(() => {
        order.push('tab');
        return Promise.resolve();
      });
      env.openDetail.mockImplementation(() => order.push('shown'));
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });

      query(document, '.button-ghost--new').dispatchEvent(event);
      await flush();

      expect(order).toEqual(['created', 'tab', 'shown']);
      expect(env.service.addNewTab).toHaveBeenCalledWith(9);
      expect(env.openDetail).toHaveBeenCalledWith(9, true);
      expect(event.defaultPrevented).toBe(true);
    });

    it('is not shown when it could not be made, and it is reported', async () => {
      const env = setUp();
      await env.render();
      env.service.createGroup.mockRejectedValue(new Error('no'));

      click(document.querySelector('.button-ghost--new'));
      await flush();

      expect(env.openDetail).not.toHaveBeenCalled();
      expect(env.logger.error).toHaveBeenCalledTimes(1);
    });

    it('gives the focus back to the button for the tabs of the new group when the groups are shown again', async () => {
      const env = setUp();
      await env.render();
      click(document.querySelector('.button-ghost--new'));
      await flush();
      env.service.snapshot.mockResolvedValue({
        groups: [...GROUPS, group(9, 'New', [tab(90)])],
        lastUsed: null,
      });

      await env.render();

      expect(document.activeElement).toBe(
        query(document, '#group-9 .list__link--extend'),
      );
    });
  });

  describe('the search', () => {
    const titles = () =>
      Array.from(document.querySelectorAll('.list-title')).map(
        (title) => title.textContent,
      );
    const resultTabs = () =>
      Array.from(document.querySelectorAll('.list__item--tab')).map((item) =>
        item.getAttribute('data-tab'),
      );

    it('does nothing for a single character', async () => {
      const env = setUp();
      await env.render();
      const before = Array.from(content()?.children ?? []);

      type('a');

      expect(Array.from(content()?.children ?? [])).toEqual(before);
    });

    it('shows the groups with tabs that have the text, and those tabs', async () => {
      const env = setUp();
      await env.render();

      type('ALPHA');

      expect(titles()).toEqual(['Work']);
      expect(resultTabs()).toEqual(['10']);
      expect(
        items().filter((item) => item.id.startsWith('group-')),
      ).toHaveLength(0);
    });

    it('finds the text in the address of a tab', async () => {
      const env = setUp();
      await env.render();

      type('t20.test');

      expect(titles()).toEqual(['Home']);
      expect(resultTabs()).toEqual(['20']);
    });

    it('lists the results of several groups in order', async () => {
      const env = setUp();
      await env.render();

      type('test');

      expect(titles()).toEqual(['Work', 'Home']);
      expect(resultTabs()).toEqual(['10', '11', '20']);
    });

    it('shows the results without a button to close the tabs, and the tab used last marked', async () => {
      const env = setUp();
      await env.render();

      type('test');

      expect(
        Array.from(document.querySelectorAll<HTMLElement>('.list__close')).map(
          (button) => button.hidden,
        ),
      ).toEqual([true, true, true]);
      expect(
        Array.from(document.querySelectorAll('.list__item--tab')).map((item) =>
          item.classList.contains('list__item--highlight'),
        ),
      ).toEqual([false, false, true]);
    });

    it('selects the first result', async () => {
      const env = setUp();
      await env.render();

      type('test');

      expect(
        Array.from(document.querySelectorAll('.list__item--tab')).map((item) =>
          item.classList.contains('list__item--selected'),
        ),
      ).toEqual([true, false, false]);
    });

    it('takes the text as it is, not as a pattern', async () => {
      const env = setUp({
        groups: [group(1, 'G', [tab(1, 'What (is) this'), tab(2, 'Other')])],
        lastUsed: null,
      });
      await env.render();

      type('(is)');
      expect(resultTabs()).toEqual(['1']);

      type('.*');
      expect(document.querySelector('.list-title')?.textContent).toBe(
        'No results',
      );

      type('(i');
      expect(resultTabs()).toEqual(['1']);
    });

    it('says when nothing was found', async () => {
      const env = setUp();
      await env.render();

      type('zzz');

      expect(titles()).toEqual(['No results']);
      expect(resultTabs()).toEqual([]);
    });

    it('shows the results as text', async () => {
      const hostile = '<img src=x onerror=alert(1)>';
      const env = setUp({
        groups: [group(1, hostile, [tab(1, hostile)])],
        lastUsed: null,
      });
      await env.render();

      type('img');

      expect(titles()).toEqual([hostile]);
      expect(document.querySelectorAll('img')).toHaveLength(1);
    });

    it('shows the groups again when the field is emptied', async () => {
      const env = setUp();
      await env.render();
      type('alpha');

      type('');

      expect(items().map((item) => item.id)).toEqual([
        'group-1',
        'group-2',
        'group-3',
      ]);
      expect(zones()).toHaveLength(4);
      expect(items()[1]?.classList.contains('list__item--highlight')).toBe(
        true,
      );
    });

    it('keeps what is shown for a single character after a search', async () => {
      const env = setUp();
      await env.render();
      type('alpha');

      type('a');

      expect(titles()).toEqual(['Work']);
    });

    it('does not show the groups again when they are shown already', async () => {
      const env = setUp();
      await env.render();
      const list = content()?.firstElementChild;

      type('a');
      type('');

      expect(content()?.firstElementChild).toBe(list);
    });

    it('does not show the groups again twice', async () => {
      const env = setUp();
      await env.render();
      type('alpha');
      type('');
      const list = content()?.firstElementChild;

      type('');

      expect(content()?.firstElementChild).toBe(list);
    });

    describe('Enter', () => {
      const enter = (key = 'Enter') => {
        search().dispatchEvent(new KeyboardEvent('keydown', { key }));
      };

      it('goes to the first result', async () => {
        const env = setUp();
        await env.render();
        type('test');

        enter();
        await flush();

        expect(env.openTab).toHaveBeenCalledTimes(1);
        expect(env.openTab).toHaveBeenCalledWith(tab(10, 'Alpha docs'));
      });

      it('goes to the first result of the last search', async () => {
        const env = setUp();
        await env.render();
        type('test');
        type('gamma');

        enter();
        await flush();

        expect(env.openTab).toHaveBeenCalledWith(tab(20, 'Gamma'));
      });

      it('does nothing without a search', async () => {
        const env = setUp();
        await env.render();

        enter();

        expect(env.openTab).not.toHaveBeenCalled();
      });

      it('does nothing when nothing was found', async () => {
        const env = setUp();
        await env.render();
        type('zzz');

        enter();

        expect(env.openTab).not.toHaveBeenCalled();
      });

      it('does nothing after the field was emptied', async () => {
        const env = setUp();
        await env.render();
        type('test');
        type('');

        enter();

        expect(env.openTab).not.toHaveBeenCalled();
      });

      it('is the only key that goes to a result', async () => {
        const env = setUp();
        await env.render();
        type('test');

        enter('Escape');
        enter('a');
        enter('Esc');

        expect(env.openTab).not.toHaveBeenCalled();
      });

      it('reports a failure', async () => {
        const env = setUp();
        await env.render();
        type('test');
        const failure = new Error('no');
        env.openTab.mockRejectedValue(failure);

        enter();
        await flush();

        expect(env.logger.error).toHaveBeenCalledWith(
          '[Popup] An action failed:',
          failure,
        );
      });
    });
  });

  describe('putting the groups in order', () => {
    const itemNamed = (index: number): HTMLElement =>
      items()[index] ?? document.body;

    it('puts a gap between the groups and at both ends', async () => {
      const env = setUp();

      await env.render();

      const children = Array.from(
        document.querySelectorAll('.frame-content .list > li'),
      ).map((child) =>
        child.classList.contains('drop-zone') ? 'zone' : 'group',
      );
      expect(children).toEqual([
        'zone',
        'group',
        'zone',
        'group',
        'zone',
        'group',
        'zone',
      ]);
      expect(zones().map((zone) => zone.getAttribute('data-index'))).toEqual([
        '0',
        '1',
        '2',
        '3',
      ]);
      expect(
        zones().every(
          (zone) => zone.getAttribute('aria-dropeffect') === 'move',
        ),
      ).toBe(true);
    });

    it('has a gap for a list of no groups', async () => {
      const env = setUp({ groups: [], lastUsed: null });

      await env.render();

      expect(zones()).toHaveLength(1);
    });

    describe('dragging a group', () => {
      it('shows which group is dragged and hides the gaps next to it', async () => {
        const env = setUp();
        await env.render();
        const setData = vi.fn();

        itemNamed(1).dispatchEvent(dragEvent('dragstart', { setData }));

        const list = query(document, '.frame-content .list');
        expect(list.classList.contains('dragging')).toBe(true);
        expect(itemNamed(1).classList.contains('dragged')).toBe(true);
        expect(itemNamed(1).getAttribute('aria-grabbed')).toBe('true');
        expect(setData).toHaveBeenCalledWith('text', 'group-2');
        expect(zones().map((zone) => zone.style.display)).toEqual([
          '',
          'none',
          'none',
          '',
        ]);
      });

      it('can start without a way to carry data', async () => {
        const env = setUp();
        await env.render();

        itemNamed(0).dispatchEvent(dragEvent('dragstart', null));

        expect(itemNamed(0).classList.contains('dragged')).toBe(true);
      });

      it('ends by showing the gaps and the group as they were', async () => {
        const env = setUp();
        await env.render();
        itemNamed(1).dispatchEvent(dragEvent('dragstart'));

        itemNamed(1).dispatchEvent(dragEvent('dragend'));

        const list = query(document, '.frame-content .list');
        expect(list.classList.contains('dragging')).toBe(false);
        expect(itemNamed(1).classList.contains('dragged')).toBe(false);
        expect(itemNamed(1).getAttribute('aria-grabbed')).toBe('false');
        expect(zones().map((zone) => zone.style.display)).toEqual([
          '',
          '',
          '',
          '',
        ]);
      });

      it('shows the gap that the group is over', async () => {
        const env = setUp();
        await env.render();
        const zone = zones()[3] ?? document.body;

        zone.dispatchEvent(dragEvent('dragenter'));
        expect(zone.classList.contains('drop-zone--entered')).toBe(true);
        zone.dispatchEvent(dragEvent('dragleave'));
        expect(zone.classList.contains('drop-zone--entered')).toBe(false);
      });

      it('lets the group be dropped in a gap', async () => {
        const env = setUp();
        await env.render();
        const over = dragEvent('dragover');

        (zones()[3] ?? document.body).dispatchEvent(over);

        expect(over.defaultPrevented).toBe(true);
      });
    });

    describe('dropping a group', () => {
      it('puts it where it was dropped, and saves the order', async () => {
        const env = setUp();
        await env.render();
        itemNamed(0).dispatchEvent(dragEvent('dragstart'));
        const drop = dragEvent('drop');

        (zones()[3] ?? document.body).dispatchEvent(drop);
        await flush();

        expect(drop.defaultPrevented).toBe(true);
        expect(env.service.moveGroup).toHaveBeenCalledTimes(1);
        expect(env.service.moveGroup).toHaveBeenCalledWith(1, 3);
        expect(
          Array.from(
            document.querySelectorAll('.frame-content .list__item'),
          ).map((item) => item.id),
        ).toEqual(['group-2', 'group-3', 'group-1']);
      });

      it('puts it at the front', async () => {
        const env = setUp();
        await env.render();
        itemNamed(2).dispatchEvent(dragEvent('dragstart'));

        (zones()[0] ?? document.body).dispatchEvent(dragEvent('drop'));

        expect(env.service.moveGroup).toHaveBeenCalledWith(3, 0);
        expect(items().map((item) => item.id)).toEqual([
          'group-3',
          'group-1',
          'group-2',
        ]);
      });

      it('keeps the gaps right when the drag ends', async () => {
        const env = setUp();
        await env.render();
        itemNamed(0).dispatchEvent(dragEvent('dragstart'));
        (zones()[3] ?? document.body).dispatchEvent(dragEvent('drop'));

        itemNamed(2).dispatchEvent(dragEvent('dragend'));

        const children = Array.from(
          document.querySelectorAll('.frame-content .list > li'),
        ).map((child) =>
          child.classList.contains('drop-zone') ? 'zone' : child.id,
        );
        expect(children).toEqual([
          'zone',
          'group-2',
          'zone',
          'group-3',
          'zone',
          'group-1',
          'zone',
        ]);
      });

      it('does nothing when no group is being dragged', async () => {
        const env = setUp();
        await env.render();

        (zones()[2] ?? document.body).dispatchEvent(dragEvent('drop'));

        expect(env.service.moveGroup).not.toHaveBeenCalled();
        expect(items().map((item) => item.id)).toEqual([
          'group-1',
          'group-2',
          'group-3',
        ]);
      });

      it('does nothing after the drag ended', async () => {
        const env = setUp();
        await env.render();
        itemNamed(0).dispatchEvent(dragEvent('dragstart'));
        itemNamed(0).dispatchEvent(dragEvent('dragend'));

        (zones()[2] ?? document.body).dispatchEvent(dragEvent('drop'));

        expect(env.service.moveGroup).not.toHaveBeenCalled();
      });

      it('reports a failure', async () => {
        const env = setUp();
        await env.render();
        const failure = new Error('no');
        env.service.moveGroup.mockRejectedValue(failure);
        itemNamed(0).dispatchEvent(dragEvent('dragstart'));

        (zones()[2] ?? document.body).dispatchEvent(dragEvent('drop'));
        await flush();

        expect(env.logger.error).toHaveBeenCalledWith(
          '[Popup] An action failed:',
          failure,
        );
      });
    });
  });
});
