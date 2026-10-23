import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

/** Where the element is on the page; it fails for one that is not shown */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('The element is not shown');
  }
  return box;
}

async function makeGroup(page: Page, name: string): Promise<void> {
  await page.locator('#main-frame .button-ghost--new').click();
  // The new group has a tab of its own, which the browser shows
  await page.bringToFront();
  const input = page.locator('#aside-frame .group-edit-input input');
  await input.fill(name);
  await input.press('Enter');
  await expect(page.locator('#aside-frame .group-name')).toContainText(name);
  await page.locator('#aside-frame .button-ghost--back').click();
  await expect(
    page.locator('#main-frame .list__item', { hasText: name }),
  ).toBeVisible();
  // The frame slides back in
  await expect
    .poll(async () => (await boxOf(page.locator('#main-frame'))).x)
    .toBeGreaterThanOrEqual(0);
}

// The popup is the page of the toolbar button. Here it is opened in a tab,
// where it works on the window it is in just the same.
test.describe('Popup', () => {
  test.beforeEach(async ({ page, extensionId, extensionProtocol }) => {
    await page.goto(
      `${extensionProtocol}://${extensionId}/popup-view/index.html`,
    );
    await expect(page.locator('body')).not.toHaveClass(/content-loading/, {
      timeout: 15000,
    });
    await expect(page.locator('#main-frame')).toHaveClass(/frame--active/);

    // A new profile has no groups until one is made
    if ((await page.locator('#main-frame .list__item').count()) === 0) {
      await makeGroup(page, 'First');
    }
  });

  test('lists the groups of the window, each with its number of tabs', async ({
    page,
  }) => {
    const groups = page.locator('#main-frame .list__item');
    await expect(groups.first()).toBeVisible();
    await expect(groups.first().locator('.list__link--extend')).toContainText(
      /\d/,
    );
  });

  test('puts the focus on the search field', async ({ page }) => {
    await page.reload();
    await expect(page.locator('#main-frame input[type=search]')).toBeFocused();
  });

  test('makes a new group, asks for its name, and lists it', async ({
    page,
  }) => {
    const before = await page.locator('#main-frame .list__item').count();

    await page.locator('#main-frame .button-ghost--new').click();
    await page.bringToFront();

    const input = page.locator('#aside-frame .group-edit-input input');
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await input.fill('Research');
    await input.press('Enter');
    await expect(page.locator('#aside-frame .group-name')).toContainText(
      'Research',
    );

    await page.locator('#aside-frame .button-ghost--back').click();

    const groups = page.locator('#main-frame .list__item');
    await expect(groups).toHaveCount(before + 1);
    await expect(groups.last()).toContainText('Research');
  });

  test('shows the tabs of a group and goes back from them with the left arrow', async ({
    page,
  }) => {
    await page.locator('#main-frame .list__link--extend').first().click();

    await expect(page.locator('#aside-frame')).toHaveClass(/frame--active/);
    const tab = page.locator('#aside-frame .list__item--tab').first();
    await expect(tab).toBeVisible();
    await expect(tab.locator('.list__link')).toBeFocused();

    await page.keyboard.press('ArrowLeft');

    await expect(page.locator('#main-frame')).toHaveClass(/frame--active/);
    await expect(
      page.locator('#main-frame .list__link--extend').first(),
    ).toBeFocused();
  });

  test('searches the tabs for the text, as text', async ({ page }) => {
    // The tab of a new group is a new tab
    await makeGroup(page, 'Searched');
    const search = page.locator('#main-frame input[type=search]');

    await search.fill('new');
    await expect(
      page.locator('#main-frame .list__item--tab').first(),
    ).toBeVisible();
    await expect(page.locator('#main-frame .list__item--selected')).toHaveCount(
      1,
    );
    await expect(
      page.locator('#main-frame .list-title', { hasText: 'Searched' }),
    ).toBeVisible();

    // What looks like a pattern is not one
    await search.fill('(.*');
    await expect(page.locator('#main-frame .list-title')).toHaveCount(1);
    await expect(page.locator('#main-frame .list__item--tab')).toHaveCount(0);

    await search.fill('');
    await expect(page.locator('#main-frame .list__item').first()).toBeVisible();
  });

  test('moves the focus about with the arrow keys', async ({ page }) => {
    const search = page.locator('#main-frame input[type=search]');
    await search.focus();

    await page.keyboard.press('ArrowRight');
    await expect(
      page.locator('#main-frame .button-ghost--settings'),
    ).toBeFocused();

    // Down goes to the place along the row that was reached: the second
    await page.keyboard.press('ArrowDown');
    await expect(
      page.locator('#main-frame .list__item').first().locator('.list__close'),
    ).toBeFocused();
  });

  test('puts the groups in a new order by dragging', async ({ page }) => {
    await makeGroup(page, 'Moved');

    const names = () =>
      page.locator('#main-frame .list__item .list__close-wrapper .list__link');
    const last = names().last();
    await expect(last).toContainText('Moved');

    // The gaps between the groups only open once a drag has started, so the
    // drag is made by hand
    const source = await boxOf(
      page.locator('#main-frame .list__item .list__drag').last(),
    );
    const startX = source.x + source.width / 2;
    const startY = source.y + source.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 10, startY - 10, { steps: 5 });

    const gap = page.locator('#main-frame .drop-zone').first();
    await expect
      .poll(async () => (await gap.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(5);
    const target = await boxOf(gap);
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();

    await expect(names().first()).toContainText('Moved');
  });
});
