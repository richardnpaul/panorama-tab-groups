import type { I18n } from '../js/ports/i18n.js';
import type { Logger } from '../js/ports/logger.js';
import type { ViewTab } from '../js/ports/view-tabs.js';
import { newElement } from '../js/share/utils.js';

export interface TabListDeps {
  i18n: I18n;
  logger: Pick<Logger, 'error'>;
  /** The user chose the tab to go to */
  open: (tab: ViewTab) => Promise<void>;
  /** The user closed the tab */
  close: (tab: ViewTab) => Promise<void>;
}

export interface TabListOptions {
  /** Search results are not closed from the list */
  hideCloseButton: boolean;
  /** The tab to mark as the one used last */
  lastUsedTabId: number | undefined;
  /** The tab that Enter goes to, shown until the tab has the focus */
  selectedTabId: number | undefined;
}

export type TabList = (
  tabs: readonly ViewTab[],
  options: TabListOptions,
) => HTMLElement;

/** What is shown of a tab when the pointer rests on it: the title, and the address */
function tooltipOf({ title, url }: ViewTab): string {
  return url === undefined ? title : `${title}\n${url}`;
}

export function createTabList({
  i18n,
  logger,
  open,
  close,
}: TabListDeps): TabList {
  // A click has nobody to report a failure to
  const report = (action: Promise<void>): void => {
    action.catch((error: unknown) => {
      logger.error('[Popup] A tab action failed:', error);
    });
  };

  function makeItem(tab: ViewTab, options: TabListOptions): HTMLElement {
    const icon = newElement('img', {
      class: 'tab__icon',
      width: 16,
      height: 16,
      alt: '',
      ...(tab.favIconUrl === undefined ? {} : { src: tab.favIconUrl }),
    });
    const link = newElement(
      'button',
      { class: 'list__link', title: tooltipOf(tab) },
      [icon, newElement('span', { content: tab.title })],
    );
    const closeButton = newElement('button', {
      class: 'list__close',
      title: i18n.getMessage('closeTab'),
    });
    closeButton.hidden = options.hideCloseButton;
    const item = newElement(
      'li',
      {
        data_tab: tab.id,
        class: 'list__item list__item--tab',
        data_nav_row: '',
      },
      [link, closeButton],
    );
    item.classList.toggle(
      'list__item--highlight',
      tab.id === options.lastUsedTabId,
    );
    item.classList.toggle(
      'list__item--selected',
      tab.id === options.selectedTabId,
    );

    link.addEventListener('blur', () => {
      item.classList.remove('list__item--selected');
    });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      report(open(tab));
    });
    closeButton.addEventListener('click', (event) => {
      event.preventDefault();
      report(
        close(tab).then(() => {
          item.remove();
        }),
      );
    });
    return item;
  }

  return (tabs, options) =>
    newElement(
      'ul',
      { class: 'list' },
      tabs.map((tab) => makeItem(tab, options)),
    );
}
