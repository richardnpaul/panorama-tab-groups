import type { PopupGroup, PopupService } from '../js/app/popup-service.js';
import { searchGroups, searchMode } from '../js/core/popup.js';
import type { Extension } from '../js/ports/extension.js';
import type { I18n } from '../js/ports/i18n.js';
import type { Logger } from '../js/ports/logger.js';
import type { ViewTab } from '../js/ports/view-tabs.js';
import { getPluralForm, newElement } from '../js/share/utils.js';
import type { Frame } from './frame.js';
import type { TabList } from './tab-list.js';

export interface GroupsFrameDeps {
  frame: Frame;
  service: Pick<
    PopupService,
    | 'snapshot'
    | 'showGroup'
    | 'createGroup'
    | 'addNewTab'
    | 'removeGroup'
    | 'moveGroup'
  >;
  tabList: TabList;
  i18n: I18n;
  logger: Pick<Logger, 'error'>;
  extension: Pick<Extension, 'openOptionsPage'>;
  /** Go to the tab, as a click on it does */
  openTab: (tab: ViewTab) => Promise<void>;
  closePopup: () => void;
  confirm: (message: string) => boolean;
  /** Show the tabs of a group, and ask for its name if it is new */
  openDetail: (groupId: number, isNew: boolean) => void;
}

export interface GroupsFrame {
  /** Show the groups of the window */
  render(): Promise<void>;
}

export function createGroupsFrame({
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
}: GroupsFrameDeps): GroupsFrame {
  // The group whose tabs were shown last, to have the focus when coming back
  let lastViewedGroup: number | undefined;

  const report = (action: Promise<unknown>): void => {
    action.catch((error: unknown) => {
      logger.error('[Popup] An action failed:', error);
    });
  };

  const showDetail = (groupId: number, isNew: boolean): void => {
    lastViewedGroup = groupId;
    openDetail(groupId, isNew);
  };

  function makeDropZone(
    place: number,
    onDrop: (gap: number, zone: HTMLElement) => void,
  ): HTMLElement {
    const zone = newElement('li', {
      class: 'drop-zone',
      aria_dropeffect: 'move',
      data_index: place,
    });
    zone.addEventListener('dragenter', () => {
      zone.classList.add('drop-zone--entered');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drop-zone--entered');
    });
    // Without this the browser does not allow a drop
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      onDrop(place, zone);
    });
    return zone;
  }

  /** The list of groups, which can be dragged about to put them in order */
  function makeGroupList(
    groups: readonly PopupGroup[],
    lastUsedGroupId: number | undefined,
  ): HTMLElement {
    const list = newElement('ul', { class: 'list' });
    let dragged: { id: number; item: HTMLElement } | undefined;

    function drop(gap: number, zone: HTMLElement): void {
      if (dragged === undefined) {
        return;
      }
      zone.replaceWith(dragged.item);
      report(service.moveGroup(dragged.id, gap));
    }

    // A gap between the groups, and one at each end, is where one is dropped
    const placeDropZones = (): void => {
      const items = Array.from(list.children).filter((child) =>
        child.classList.contains('list__item'),
      );
      list.replaceChildren(
        ...items.flatMap((item, gap) => [makeDropZone(gap, drop), item]),
        makeDropZone(items.length, drop),
      );
    };

    function makeItem(group: PopupGroup): HTMLElement {
      const tabCount = group.tabs.length;
      const closeButton = newElement('button', {
        class: 'list__close',
        title: i18n.getMessage('closeGroup'),
      });
      const nameButton = newElement('button', { class: 'list__link' }, [
        newElement('span', { content: group.name }),
      ]);
      const extendButton = newElement(
        'button',
        { class: 'list__link list__link--extend' },
        [
          newElement('span', {
            content: getPluralForm(
              i18n,
              tabCount,
              i18n.getMessage('tabCount', [String(tabCount)]),
            ),
          }),
        ],
      );
      const item = newElement(
        'li',
        {
          id: `group-${String(group.id)}`,
          class: 'list__item',
          data_nav_row: '',
          draggable: 'true',
        },
        [
          newElement('div', { class: 'list__drag' }),
          newElement('div', { class: 'list__close-wrapper' }, [
            nameButton,
            closeButton,
          ]),
          extendButton,
        ],
      );
      item.classList.toggle(
        'list__item--highlight',
        group.id === lastUsedGroupId,
      );

      nameButton.addEventListener('click', () => {
        report(service.showGroup(group.id).then(closePopup));
      });
      extendButton.addEventListener('click', () => {
        showDetail(group.id, false);
      });
      extendButton.addEventListener('keyup', (event) => {
        if (event.key === 'ArrowRight') {
          event.stopPropagation();
          showDetail(group.id, false);
        }
      });
      closeButton.addEventListener('click', () => {
        report(
          (async () => {
            const warning = getPluralForm(
              i18n,
              tabCount,
              i18n.getMessage('closeGroupWarning', [String(tabCount)]),
            );
            if (tabCount > 0 && !confirm(warning)) {
              return;
            }
            if (await service.removeGroup(group.id)) {
              item.remove();
              placeDropZones();
            }
          })(),
        );
      });

      item.addEventListener('dragstart', (event) => {
        // The zones next to the group would put it where it is
        [item.previousElementSibling, item.nextElementSibling]
          .filter((sibling) => sibling instanceof HTMLElement)
          .forEach((sibling) => {
            sibling.style.display = 'none';
          });
        list.classList.add('dragging');
        item.classList.add('dragged');
        item.setAttribute('aria-grabbed', 'true');
        event.dataTransfer?.setData('text', item.id);
        dragged = { id: group.id, item };
      });
      item.addEventListener('dragend', () => {
        list.classList.remove('dragging');
        item.classList.remove('dragged');
        item.setAttribute('aria-grabbed', 'false');
        dragged = undefined;
        placeDropZones();
      });
      return item;
    }

    list.append(...groups.map(makeItem));
    placeDropZones();
    return list;
  }

  return {
    async render() {
      frame.startLoading();
      const { groups, lastUsed } = await service.snapshot();
      const lastUsedTabId = lastUsed?.tabId;

      const makeGroupsView = (): HTMLElement =>
        makeGroupList(groups, lastUsed?.groupId);
      let results: ViewTab | undefined;
      let showingResults = false;

      const showResults = (query: string): void => {
        const matches = searchGroups<ViewTab, PopupGroup>(groups, query);
        const [first] = matches.flatMap(({ tabs }) => tabs);
        results = first;
        showingResults = true;
        if (first === undefined) {
          frame.setContent(
            newElement('h2', {
              class: 'list-title',
              content: i18n.getMessage('searchForTab_noResults'),
            }),
          );
          return;
        }
        frame.setContent(
          newElement(
            'div',
            {},
            matches.flatMap(({ group, tabs }) => [
              newElement('h2', { class: 'list-title', content: group.name }),
              tabList(tabs, {
                hideCloseButton: true,
                lastUsedTabId,
                selectedTabId: first.id,
              }),
            ]),
          ),
        );
      };

      const searchInput = document.createElement('input');
      searchInput.className = 'form-field__input';
      searchInput.type = 'search';
      searchInput.name = 'query';
      searchInput.placeholder = i18n.getMessage('searchForTab_placeholder');
      searchInput.addEventListener('input', () => {
        const mode = searchMode(searchInput.value);
        if (mode === 'results') {
          showResults(searchInput.value);
        } else if (mode === 'groups' && showingResults) {
          showingResults = false;
          results = undefined;
          frame.setContent(makeGroupsView());
        }
      });
      // Enter goes to the first of the tabs found
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && results !== undefined) {
          report(openTab(results));
        }
      });

      const settingsButton = newElement('button', {
        class: 'button-ghost button-ghost--settings',
        title: i18n.getMessage('settingsButton'),
      });
      settingsButton.addEventListener('click', () => {
        report(extension.openOptionsPage().then(closePopup));
      });

      const newGroupButton = newElement('button', {
        class: 'button-ghost button-ghost--new',
        content: i18n.getMessage('newGroupButton'),
      });
      newGroupButton.addEventListener('click', (event) => {
        event.preventDefault();
        report(
          (async () => {
            const id = await service.createGroup();
            await service.addNewTab(id);
            showDetail(id, true);
          })(),
        );
      });

      frame.setHeader([
        newElement('div', { class: 'form-field form-field--search' }, [
          searchInput,
        ]),
        settingsButton,
      ]);
      frame.setContent(makeGroupsView());
      frame.setFooter(newGroupButton);
      frame.show();

      // Back from the tabs of a group, the focus is where it was left
      const cameBackTo = frame.node.querySelectorAll<HTMLElement>(
        `#group-${String(lastViewedGroup)} .list__link--extend`,
      );
      lastViewedGroup = undefined;
      [...cameBackTo, searchInput].slice(0, 1).forEach((first) => {
        first.focus();
      });
    },
  };
}
