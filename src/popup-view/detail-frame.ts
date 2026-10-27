import type { PopupService } from '../js/app/popup-service.js';
import { nextGroupName } from '../js/core/popup.js';
import type { I18n } from '../js/ports/i18n.js';
import type { Logger } from '../js/ports/logger.js';
import { newElement } from '../js/share/utils.js';
import type { Frame } from './frame.js';
import type { TabList } from './tab-list.js';

export interface DetailFrameDeps {
  frame: Frame;
  service: Pick<PopupService, 'snapshot' | 'renameGroup' | 'addNewTab'>;
  tabList: TabList;
  i18n: I18n;
  logger: Pick<Logger, 'error'>;
  closePopup: () => void;
  /** Go back to the groups */
  back: () => void;
}

export interface DetailFrame {
  /** Show the tabs of a group; a new group is shown with its name to be typed */
  render(groupId: number, isNew: boolean): Promise<void>;
}

/** Something on the page that can be given the focus */
interface Focusable {
  focus: () => void;
}

export function createDetailFrame({
  frame,
  service,
  tabList,
  i18n,
  logger,
  closePopup,
  back,
}: DetailFrameDeps): DetailFrame {
  const report = (action: Promise<unknown>): void => {
    action.catch((error: unknown) => {
      logger.error('[Popup] An action failed:', error);
    });
  };

  return {
    async render(groupId, isNew) {
      frame.startLoading();
      const { groups, lastUsed } = await service.snapshot();
      const group = groups.find(({ id }) => id === groupId);
      if (group === undefined) {
        back();
        return;
      }

      const backButton = newElement('button', {
        class: 'button-ghost button-ghost--back',
      });
      backButton.addEventListener('click', back);

      let { name } = group;

      // The name of the group, which the user can change
      const renderName = (editing: boolean): Focusable => {
        if (!editing) {
          const editButton = newElement('button', {
            class: 'group-edit',
            title: i18n.getMessage('editGroup'),
          });
          editButton.addEventListener('click', (event) => {
            event.stopPropagation();
            renderName(true).focus();
          });
          frame.setHeader([
            backButton,
            newElement('h2', { class: 'group-name' }, [
              document.createTextNode(name),
              editButton,
            ]),
          ]);
          return editButton;
        }

        const input = document.createElement('input');
        input.className = 'form-field__input';
        input.type = 'search';
        input.value = name;

        // The name is saved once, whether the user leaves the field or not
        let saving = false;
        const save = async (): Promise<void> => {
          if (saving) {
            return;
          }
          saving = true;
          const next = nextGroupName(name, input.value);
          try {
            if (next !== name) {
              await service.renameGroup(group.id, next);
            }
          } catch (error) {
            saving = false;
            throw error;
          }
          name = next;
          renderName(false).focus();
        };

        input.addEventListener('blur', () => {
          report(save());
        });
        // The keys are for the field, not for moving about the frame
        input.addEventListener('keydown', (event) => {
          event.stopPropagation();
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            report(save());
          }
        });
        input.addEventListener('keyup', (event) => {
          event.stopPropagation();
        });

        frame.setHeader([
          backButton,
          newElement('div', { class: 'form-field group-edit-input' }, [input]),
        ]);
        return {
          focus: () => {
            input.focus();
            input.select();
          },
        };
      };

      const nameField = renderName(isNew);
      frame.setContent(
        tabList(group.tabs, {
          hideCloseButton: false,
          lastUsedTabId: lastUsed?.tabId,
          selectedTabId: undefined,
        }),
      );

      const newTabButton = newElement('button', {
        class: 'button-ghost button-ghost--new',
        content: i18n.getMessage('openNewTab'),
      });
      newTabButton.addEventListener('click', (event) => {
        event.preventDefault();
        report(service.addNewTab(group.id).then(closePopup));
      });
      frame.setFooter(newTabButton);

      // The focus goes to the first tab, or to the name that is to be typed
      const focusFirstTab = (): void => {
        [...frame.node.querySelectorAll<HTMLElement>('.list__link'), backButton]
          .slice(0, 1)
          .forEach((first) => {
            first.focus();
          });
      };
      frame.show(
        isNew
          ? () => {
              nameField.focus();
            }
          : focusFirstTab,
      );
    },
  };
}
