import type { Page } from '@playwright/test';
import { pseudoLocaleScript } from '../support/pseudo-locale.js';
import { test, expect } from './fixtures.js';
import {
  PAGE_NAMES,
  boxOf,
  pagesOfTheExtension as pages,
  overlappingTexts,
  sidewaysOverflow,
} from './pages.js';

// The pages in the real browser, with the pseudo-locale for the messages: text that is longer
// and accented and in brackets, as a language of another shape is, and the same running from
// the right. A text that is not from a message has no brackets; one that does not fit shows.
//
// Chromium only: Firefox pages are served with a stand-in for the browser API in these tests.
test.describe('Pages in the pseudo-locale', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Firefox pages are served with a stand-in for the browser API',
  );

  /** The texts the page shows that are not from a message, leaving out what is the user's own */
  const textsOutsideMessages = (page: Page): Promise<string[]> =>
    page.evaluate(() => {
      const found: string[] = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      for (
        let node = walker.nextNode();
        node !== null;
        node = walker.nextNode()
      ) {
        const text = (node.textContent ?? '').trim();
        const element = node.parentElement;
        // A message, or the end of one that a link in it split in two
        const fromMessage = text.includes('[') || text.endsWith(']');
        // The names of groups and tabs are the user's, not the page's
        const users = element?.closest(
          '.tab, #pinnedTabs, .name, .group-name, .list__link:not(.list__link--extend)',
        );
        if (
          /\p{L}{2}/u.test(text) &&
          !fromMessage &&
          element !== null &&
          users === null
        ) {
          found.push(`${element.localName}: ${text}`);
        }
      }
      return found;
    });

  for (const rtl of [false, true]) {
    test.describe(rtl ? 'right to left' : 'left to right, longer', () => {
      test.beforeEach(async ({ page }) => {
        await page.addInitScript({ content: pseudoLocaleScript({ rtl }) });
      });

      for (const name of PAGE_NAMES) {
        test(`${name}: every text is from a message, in the direction of the language`, async ({
          page,
          extensionId,
          extensionProtocol,
        }) => {
          await pages[name](
            page,
            (path) => `${extensionProtocol}://${extensionId}/${path}`,
          );

          expect(await textsOutsideMessages(page)).toEqual([]);
          await expect(page.locator('html')).toHaveAttribute(
            'dir',
            rtl ? 'rtl' : 'ltr',
          );
          await expect(page.locator('html')).toHaveAttribute(
            'lang',
            rtl ? 'ar' : 'en',
          );
          // The popup is two frames side by side, so it is wider than the window by design
          if (name !== 'popup') {
            expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
          }
          // A text longer than its room must not be written over the next
          expect(await overlappingTexts(page)).toEqual([]);
        });
      }

      test(`view: the toolbar and the header of a group run from the ${rtl ? 'right' : 'left'}`, async ({
        page,
        extensionId,
        extensionProtocol,
      }) => {
        await pages.view(
          page,
          (path) => `${extensionProtocol}://${extensionId}/${path}`,
        );

        await expect(
          page.locator('.group .header .name').first(),
        ).toBeVisible();
        const buttons = page.locator('#toolbar .button');
        const first = await boxOf(buttons.first());
        const last = await boxOf(buttons.last());
        const name = await boxOf(page.locator('.group .header .name').first());
        const close = await boxOf(
          page.locator('.group .header .close').first(),
        );

        // The first button is where reading starts, and the close button is at the other end
        expect(first.x < last.x).toBe(!rtl);
        expect(name.x < close.x).toBe(!rtl);
      });

      test(`popup: the arrow to the tabs of a group is at the ${rtl ? 'left' : 'right'}, pointing on`, async ({
        page,
        extensionId,
        extensionProtocol,
      }) => {
        await pages.popup(
          page,
          (path) => `${extensionProtocol}://${extensionId}/${path}`,
        );

        const item = page.locator('#main-frame .list__item').first();
        const extend = await boxOf(item.locator('.list__link--extend'));
        const name = await boxOf(item.locator('.list__close-wrapper'));
        const arrow = await item
          .locator('.list__link--extend')
          .evaluate(
            (element) => getComputedStyle(element, '::after').transform,
          );

        expect(extend.x > name.x).toBe(!rtl);
        // The arrow is turned round where text runs from the right
        expect(arrow).toBe(rtl ? 'matrix(-1, 0, 0, 1, 0, 0)' : 'none');
      });

      test(`popup: the ${rtl ? 'left' : 'right'} arrow opens the tabs of a group and the ${rtl ? 'right' : 'left'} arrow goes back`, async ({
        page,
        extensionId,
        extensionProtocol,
      }) => {
        await pages.popup(
          page,
          (path) => `${extensionProtocol}://${extensionId}/${path}`,
        );
        const onward = rtl ? 'ArrowLeft' : 'ArrowRight';
        const back = rtl ? 'ArrowRight' : 'ArrowLeft';
        const shell = page.locator('#frame-shell');

        // The arrow that points the other way does nothing on the button
        const extend = page
          .locator('#main-frame .list__item')
          .first()
          .locator('.list__link--extend');
        await extend.focus();
        await page.keyboard.press(back);
        await expect(shell).not.toHaveClass(/frame-shell--aside-active/u);

        // (the arrow moved the focus along the row, so it is put back)
        await extend.focus();
        await page.keyboard.press(onward);
        await expect(shell).toHaveClass(/frame-shell--aside-active/u);

        // In the frame that slid in, the arrow that points back at the start of a row goes back
        await page
          .locator('#aside-frame [data-nav-row] button')
          .first()
          .focus();
        await page.keyboard.press(back);
        await expect(shell).not.toHaveClass(/frame-shell--aside-active/u);
      });
    });
  }
});
