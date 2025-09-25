import View from '../_shared/js/models/View.js';
import GroupsFrame from './js/GroupsFrame.js';

/*
 * TODO:
 * - Polish search
 * - Pinned groups: fix active group highlight, separate last group?
 * - async more things
 */

(async () => {
  class PopupView extends View {
    static close() {
      window.close();
    }
  }

  const popupView = new PopupView();
  await popupView.initializeView();
  window.PopupView = popupView; // TODO: Any smarter way?

  popupView.setTheme(popupView.options.theme);
  GroupsFrame.render();
})();
