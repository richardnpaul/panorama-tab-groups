import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

// The options page against the storage of the browser it runs in: what is
// chosen is still chosen when the page is opened again
test.describe('Options persistence', () => {
  let optionsPage: Page;

  test.beforeEach(async ({ page, extensionId, extensionProtocol }) => {
    optionsPage = page;
    await page.goto(`${extensionProtocol}://${extensionId}/options.html`);
    await expect(
      page.locator('form[name="formTheme"] input:checked'),
    ).toHaveCount(1, { timeout: 15000 });
  });

  /** Open the page again until it shows what was saved, which happens in the background */
  async function expectAfterReload(check: () => Promise<void>): Promise<void> {
    await expect(async () => {
      await optionsPage.reload();
      await check();
    }).toPass({ timeout: 15000 });
  }

  /** Pick a choice by its label, which covers the radio button with a picture */
  async function choose(id: string): Promise<void> {
    await optionsPage.locator(`label[for="${id}"]`).click();
    await expect(optionsPage.locator(`#${id}`)).toBeChecked();
  }

  test('keeps the theme, the toolbar position and the view', async () => {
    const page = optionsPage;
    // The toolbar options belong to the freeform view
    await choose('viewFreeform');
    await expect(page.locator('#optionsToolbar')).toBeVisible();

    await choose('themeDark');
    await choose('toolbarPositionLeft');
    await choose('viewPopup');
    await expect(page.locator('#optionsToolbar')).toBeHidden();

    await expectAfterReload(async () => {
      await expect(page.locator('#themeDark')).toBeChecked();
      await expect(page.locator('#viewPopup')).toBeChecked();
      await expect(page.locator('#toolbarPositionLeft')).toBeChecked();
      await expect(page.locator('#optionsToolbar')).toBeHidden();
    });
  });

  test('turns a shortcut off and on again, and its form follows', async () => {
    const page = optionsPage;
    const form = page.locator('#activate-next-group');
    await expect(form.locator('input')).toHaveValue(/.+/);

    await form.locator('.disableShortcut').click();
    await expect(form.locator('input')).toBeDisabled();
    await expect(form.locator('.enableShortcut')).toBeVisible();

    await expectAfterReload(async () => {
      await expect(form.locator('input')).toBeDisabled();
      await expect(form.locator('.enableShortcut')).toBeVisible();
    });

    await form.locator('.enableShortcut').click();
    await expect(form.locator('input')).toBeEnabled();

    await expectAfterReload(async () => {
      await expect(form.locator('input')).toBeEnabled();
      await expect(form.locator('.disableShortcut')).toBeVisible();
      await expect(form.locator('.enableShortcut')).toBeHidden();
    });
  });
});
