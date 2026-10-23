// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import type {
  PopupGroup,
  PopupSnapshot,
} from '../../../src/js/app/popup-service.js';
import type { ViewTab } from '../../../src/js/ports/view-tabs.js';
import { createDetailFrame } from '../../../src/popup-view/detail-frame.js';
import { createFrame } from '../../../src/popup-view/frame.js';
import { createTabList } from '../../../src/popup-view/tab-list.js';
import {
  elementById,
  flush,
  setUpPopupPage,
} from '../../support/popup-page.js';
import { requireElement } from '../../../src/js/share/dom.js';

const MESSAGES: Record<string, string> = {
  closeTab: 'Close tab',
  editGroup: 'Edit group',
  openNewTab: 'Open new tab',
};

const i18n = {
  getMessage: (name: string) => MESSAGES[name] ?? name,
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

const GROUPS = [group(1, 'Work', [tab(10), tab(11)]), group(2, 'Empty', [])];

function setUp(
  snapshot: PopupSnapshot = {
    groups: GROUPS,
    lastUsed: { tabId: 11, groupId: 1 },
  },
) {
  setUpPopupPage();
  const scheduler = createMemoryScheduler();
  const back = vi.fn();
  const frame = createFrame({
    node: elementById('aside-frame'),
    shell: elementById('frame-shell'),
    body: document.body,
    scheduler,
    isAside: true,
    onLeftAtStart: back,
  });
  const logger = { error: vi.fn() };
  const service = {
    snapshot: vi.fn().mockResolvedValue(snapshot),
    renameGroup: vi.fn().mockResolvedValue(undefined),
    addNewTab: vi.fn().mockResolvedValue(undefined),
  };
  const closePopup = vi.fn();
  const open = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const detail = createDetailFrame({
    frame,
    service,
    tabList: createTabList({ i18n, logger, open, close }),
    i18n,
    logger,
    closePopup,
    back,
  });
  return {
    ...detail,
    frame,
    scheduler,
    service,
    closePopup,
    back,
    logger,
    open,
    close,
  };
}

const aside = () => elementById('aside-frame');
const query = (selector: string): HTMLElement =>
  requireElement(HTMLElement, selector, aside());
const click = (element: Element): void => {
  element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
};
const nameInput = () =>
  requireElement(HTMLInputElement, '.group-edit-input input', aside());
const editName = (text: string): HTMLInputElement => {
  click(query('.group-edit'));
  const input = nameInput();
  input.value = text;
  return input;
};
const key = (input: HTMLElement, name: string, type = 'keydown') => {
  const event = new KeyboardEvent(type, {
    key: name,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(event);
  return event;
};

describe('popup-view/detail-frame.ts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('showing a group', () => {
    it('shows the loading until the group is known, then shows the frame', async () => {
      const env = setUp();
      let known: (snapshot: PopupSnapshot) => void = () => undefined;
      env.service.snapshot.mockReturnValue(
        new Promise<PopupSnapshot>((resolve) => {
          known = resolve;
        }),
      );
      document.body.classList.remove('content-loading');

      const rendering = env.render(1, false);
      expect(document.body.classList.contains('content-loading')).toBe(true);
      expect(aside().classList.contains('frame--active')).toBe(false);

      known({ groups: GROUPS, lastUsed: null });
      await rendering;

      expect(document.body.classList.contains('content-loading')).toBe(false);
      expect(aside().classList.contains('frame--active')).toBe(true);
      expect(
        elementById('frame-shell').classList.contains(
          'frame-shell--aside-active',
        ),
      ).toBe(true);
    });

    it('shows the name of the group, with a button to change it', async () => {
      const env = setUp();

      await env.render(1, false);

      const heading = query('.frame-header .group-name');
      expect(heading.tagName).toBe('H2');
      expect(heading.firstChild?.textContent).toBe('Work');
      const edit = query('.group-name > .group-edit');
      expect(edit.tagName).toBe('BUTTON');
      expect(edit.title).toBe('Edit group');
    });

    it('shows a button to go back, before the name', async () => {
      const env = setUp();

      await env.render(1, false);

      const header = query('.frame-header');
      expect(header.children[0]?.className).toBe(
        'button-ghost button-ghost--back',
      );
      expect(header.children[0]?.tagName).toBe('BUTTON');
      expect(header.children[1]?.className).toBe('group-name');
    });

    it('shows the tabs of the group, with the one used last marked', async () => {
      const env = setUp();

      await env.render(1, false);

      const items = Array.from(aside().querySelectorAll('.list__item--tab'));
      expect(items.map((item) => item.getAttribute('data-tab'))).toEqual([
        '10',
        '11',
      ]);
      expect(
        items.map((item) => item.classList.contains('list__item--highlight')),
      ).toEqual([false, true]);
      expect(
        items.map((item) => item.classList.contains('list__item--selected')),
      ).toEqual([false, false]);
      expect(
        Array.from(aside().querySelectorAll<HTMLElement>('.list__close')).map(
          (button) => button.hidden,
        ),
      ).toEqual([false, false]);
    });

    it('marks no tab when none was used last', async () => {
      const env = setUp({ groups: GROUPS, lastUsed: null });

      await env.render(1, false);

      expect(aside().querySelector('.list__item--highlight')).toBeNull();
    });

    it('shows a group with no tabs', async () => {
      const env = setUp();

      await env.render(2, false);

      expect(aside().querySelectorAll('.list__item')).toHaveLength(0);
      expect(query('.group-name').firstChild?.textContent).toBe('Empty');
    });

    it('replaces what the frame showed before', async () => {
      const env = setUp();
      await env.render(1, false);

      await env.render(2, false);

      expect(aside().querySelectorAll('.group-name')).toHaveLength(1);
      expect(aside().querySelectorAll('.list__item')).toHaveLength(0);
      expect(aside().querySelectorAll('.frame-footer button')).toHaveLength(1);
    });

    it('shows the name of the group as text', async () => {
      const hostile = '<img src=x onerror=alert(1)>';
      const env = setUp({ groups: [group(1, hostile, [])], lastUsed: null });

      await env.render(1, false);

      expect(query('.group-name').firstChild?.textContent).toBe(hostile);
      expect(aside().querySelector('img')).toBeNull();
    });

    it('goes back to the groups when the group is not there', async () => {
      const env = setUp();

      await env.render(9, false);

      expect(env.back).toHaveBeenCalledTimes(1);
      expect(aside().classList.contains('frame--active')).toBe(false);
      expect(aside().querySelector('.group-name')).toBeNull();
    });

    it('goes back to the groups with the button for it', async () => {
      const env = setUp();
      await env.render(1, false);

      click(query('.button-ghost--back'));

      expect(env.back).toHaveBeenCalledTimes(1);
    });

    it('goes back to the groups with the left arrow on the first tab', async () => {
      const env = setUp();
      await env.render(1, false);

      query('.list__link').dispatchEvent(
        new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }),
      );

      expect(env.back).toHaveBeenCalledTimes(1);
    });
  });

  describe('the focus', () => {
    it('goes to the first tab once the frame has slid in', async () => {
      const env = setUp();
      await env.render(1, false);
      expect(document.activeElement).not.toBe(query('.list__link'));

      env.scheduler.advance(200);

      expect(document.activeElement).toBe(query('.list__link'));
    });

    it('goes to the button for going back when there are no tabs', async () => {
      const env = setUp();
      await env.render(2, false);

      env.scheduler.advance(200);

      expect(document.activeElement).toBe(query('.button-ghost--back'));
    });

    it('goes to the name of a new group, which is to be typed', async () => {
      const env = setUp();
      await env.render(1, true);

      env.scheduler.advance(200);

      expect(document.activeElement).toBe(nameInput());
    });

    it('selects the name of a new group', async () => {
      const env = setUp();
      await env.render(1, true);
      env.scheduler.advance(200);
      const input = nameInput();

      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe('Work'.length);
    });
  });

  describe('a new group', () => {
    it('shows the field for its name instead of the name', async () => {
      const env = setUp();

      await env.render(1, true);

      expect(aside().querySelector('.group-name')).toBeNull();
      const field = query('.frame-header .form-field.group-edit-input');
      expect(field.children).toHaveLength(1);
      const input = nameInput();
      expect(input.type).toBe('search');
      expect(input.value).toBe('Work');
      expect(input.classList.contains('form-field__input')).toBe(true);
    });

    it('keeps the button for going back', async () => {
      const env = setUp();

      await env.render(1, true);

      expect(query('.frame-header').children[0]?.className).toBe(
        'button-ghost button-ghost--back',
      );
    });
  });

  describe('changing the name', () => {
    it('shows a field with the name, selected, for the button', async () => {
      const env = setUp();
      await env.render(1, false);
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      const reachedHeader = vi.fn();
      query('.frame-header').addEventListener('click', reachedHeader);

      query('.group-edit').dispatchEvent(event);

      const input = nameInput();
      expect(input.value).toBe('Work');
      expect(document.activeElement).toBe(input);
      expect(input.selectionEnd).toBe(4);
      expect(aside().querySelector('.group-name')).toBeNull();
      expect(reachedHeader).not.toHaveBeenCalled();
      expect(query('.frame-header').children[0]?.tagName).toBe('BUTTON');
    });

    it('saves the name on Enter, and shows it with the focus on the button for changing it', async () => {
      const env = setUp();
      await env.render(1, false);
      const input = editName('Play');

      const event = key(input, 'Enter');
      await flush();

      expect(event.defaultPrevented).toBe(true);
      expect(env.service.renameGroup).toHaveBeenCalledTimes(1);
      expect(env.service.renameGroup).toHaveBeenCalledWith(1, 'Play');
      expect(query('.group-name').firstChild?.textContent).toBe('Play');
      expect(aside().querySelector('.group-edit-input')).toBeNull();
      expect(document.activeElement).toBe(query('.group-edit'));
    });

    it('saves the name on Escape', async () => {
      const env = setUp();
      await env.render(1, false);
      const input = editName('Play');

      const event = key(input, 'Escape');
      await flush();

      expect(event.defaultPrevented).toBe(true);
      expect(env.service.renameGroup).toHaveBeenCalledWith(1, 'Play');
      expect(query('.group-name').firstChild?.textContent).toBe('Play');
    });

    it('saves the name when the field loses the focus', async () => {
      const env = setUp();
      await env.render(1, false);
      const input = editName('Play');

      input.dispatchEvent(new Event('blur'));
      await flush();

      expect(env.service.renameGroup).toHaveBeenCalledWith(1, 'Play');
      expect(query('.group-name').firstChild?.textContent).toBe('Play');
    });

    it('saves the name of a new group', async () => {
      const env = setUp();
      await env.render(1, true);
      const input = nameInput();
      input.value = 'Fresh';

      key(input, 'Enter');
      await flush();

      expect(env.service.renameGroup).toHaveBeenCalledWith(1, 'Fresh');
      expect(query('.group-name').firstChild?.textContent).toBe('Fresh');
    });

    it('saves it once, whichever way the user leaves the field', async () => {
      const env = setUp();
      await env.render(1, false);
      const input = editName('Play');

      key(input, 'Enter');
      input.dispatchEvent(new Event('blur'));
      key(input, 'Escape');
      await flush();

      expect(env.service.renameGroup).toHaveBeenCalledTimes(1);
    });

    it('takes the name without the spaces around it', async () => {
      const env = setUp();
      await env.render(1, false);
      const input = editName('  Play  ');

      key(input, 'Enter');
      await flush();

      expect(env.service.renameGroup).toHaveBeenCalledWith(1, 'Play');
    });

    it('keeps the name when the field is blank', async () => {
      const env = setUp();
      await env.render(1, false);
      const input = editName('   ');

      key(input, 'Enter');
      await flush();

      expect(env.service.renameGroup).not.toHaveBeenCalled();
      expect(query('.group-name').firstChild?.textContent).toBe('Work');
    });

    it('does not save a name that is the same', async () => {
      const env = setUp();
      await env.render(1, false);
      const input = editName('Work');

      key(input, 'Enter');
      await flush();

      expect(env.service.renameGroup).not.toHaveBeenCalled();
      expect(query('.group-name').firstChild?.textContent).toBe('Work');
    });

    it('can be changed again, from the name that was saved', async () => {
      const env = setUp();
      await env.render(1, false);
      key(editName('Play'), 'Enter');
      await flush();

      const input = editName('Rest');
      expect(nameInput().value).toBe('Rest');
      key(input, 'Enter');
      await flush();

      expect(env.service.renameGroup).toHaveBeenNthCalledWith(2, 1, 'Rest');
      expect(query('.group-name').firstChild?.textContent).toBe('Rest');
    });

    it('shows the field again with the name as it was typed after the next edit starts', async () => {
      const env = setUp();
      await env.render(1, false);
      key(editName('Play'), 'Enter');
      await flush();

      click(query('.group-edit'));

      expect(nameInput().value).toBe('Play');
    });

    it('keeps the field, reports it, and can save again when the name could not be saved', async () => {
      const env = setUp();
      await env.render(1, false);
      const failure = new Error('no');
      env.service.renameGroup.mockRejectedValueOnce(failure);
      const input = editName('Play');

      key(input, 'Enter');
      await flush();

      expect(env.logger.error).toHaveBeenCalledWith(
        '[Popup] An action failed:',
        failure,
      );
      expect(nameInput()).toBe(input);
      expect(aside().querySelector('.group-name')).toBeNull();

      key(input, 'Enter');
      await flush();

      expect(env.service.renameGroup).toHaveBeenCalledTimes(2);
      expect(query('.group-name').firstChild?.textContent).toBe('Play');
    });

    it('keeps the other keys for the field', async () => {
      const env = setUp();
      await env.render(1, false);
      const input = editName('Play');
      const reachedFrame = vi.fn();
      aside().addEventListener('keydown', reachedFrame);
      aside().addEventListener('keyup', reachedFrame);

      const down = key(input, 'a');
      key(input, 'ArrowLeft', 'keyup');
      key(input, 'ArrowDown', 'keydown');

      expect(down.defaultPrevented).toBe(false);
      expect(reachedFrame).not.toHaveBeenCalled();
      expect(env.back).not.toHaveBeenCalled();
      expect(env.service.renameGroup).not.toHaveBeenCalled();
      expect(nameInput()).toBe(input);
    });

    it('does not take Enter and Escape for other keys', async () => {
      const env = setUp();
      await env.render(1, false);
      const input = editName('Play');

      key(input, 'Esc');
      key(input, 'Tab');
      key(input, 'Enter', 'keyup');
      await flush();

      expect(env.service.renameGroup).not.toHaveBeenCalled();
    });

    it('shows the name as text', async () => {
      const env = setUp();
      await env.render(1, false);
      const hostile = '<img src=x onerror=alert(1)>';
      const input = editName(hostile);

      key(input, 'Enter');
      await flush();

      expect(query('.group-name').firstChild?.textContent).toBe(hostile);
      expect(query('.group-name').querySelector('img')).toBeNull();
    });
  });

  describe('the tabs', () => {
    it('are gone to by a click, which closes nothing', async () => {
      const env = setUp();
      await env.render(1, false);

      click(aside().querySelectorAll('.list__link')[1] ?? aside());

      expect(env.open).toHaveBeenCalledTimes(1);
      expect(env.open).toHaveBeenCalledWith(tab(11));
      expect(env.close).not.toHaveBeenCalled();
    });

    it('are closed with their button, and leave the list', async () => {
      const env = setUp();
      await env.render(1, false);

      click(aside().querySelectorAll('.list__close')[0] ?? aside());
      await flush();

      expect(env.close).toHaveBeenCalledWith(tab(10));
      expect(aside().querySelectorAll('.list__item--tab')).toHaveLength(1);
    });
  });

  describe('a new tab', () => {
    it('is made in the group with the button for it, and then the popup is closed', async () => {
      const env = setUp();
      await env.render(2, false);
      const order: string[] = [];
      env.service.addNewTab.mockImplementation(async () => {
        await Promise.resolve();
        order.push('added');
      });
      env.closePopup.mockImplementation(() => order.push('closed'));
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });

      query('.frame-footer .button-ghost--new').dispatchEvent(event);
      await flush();

      expect(env.service.addNewTab).toHaveBeenCalledWith(2);
      expect(order).toEqual(['added', 'closed']);
      expect(event.defaultPrevented).toBe(true);
    });

    it('has a button named in the language of the user', async () => {
      const env = setUp();

      await env.render(1, false);

      expect(query('.frame-footer .button-ghost--new').textContent).toBe(
        'Open new tab',
      );
    });

    it('keeps the popup open and reports it when the tab could not be made', async () => {
      const env = setUp();
      await env.render(1, false);
      const failure = new Error('no');
      env.service.addNewTab.mockRejectedValue(failure);

      click(query('.frame-footer .button-ghost--new'));
      await flush();

      expect(env.closePopup).not.toHaveBeenCalled();
      expect(env.logger.error).toHaveBeenCalledWith(
        '[Popup] An action failed:',
        failure,
      );
    });
  });
});
