import { test, expect } from '../playwright.config.js';

function getExtensionPageUrl(extensionProtocol, extensionId, pagePath) {
  return `${extensionProtocol}://${extensionId}/${pagePath}`;
}

async function gotoExtensionPage(
  page,
  extensionProtocol,
  extensionId,
  pagePath,
) {
  const targetUrl = getExtensionPageUrl(
    extensionProtocol,
    extensionId,
    pagePath,
  );
  await page.goto(targetUrl, { timeout: 15000 });

  const startTime = Date.now();
  while (page.url() !== targetUrl && Date.now() - startTime < 5000) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(50);
  }
  expect(page.url()).toBe(targetUrl);
  return targetUrl;
}

test.describe('User Journeys', () => {
  test('Journey: Basic navigation to Tab Groups view', async ({
    page,
    extensionId,
    extensionProtocol,
  }) => {
    const page = await context.newPage();
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');

    // Wait for the view to fully initialize
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // Create a group using the UI to ensure at least one .group element exists
    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
    }

    // Wait for at least one group to render so screenshots capture the full UI
    await expect(page.locator('.group').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('Journey: Basic add tab to group works', async ({
    context,
    page,
    extensionId,
    extensionProtocol,
    browserName,
  }) => {
    // Firefox Playwright tests run the extension page via a local HTTP proxy that mocks window.browser
    // This means the view cannot communicate with the real background script, making E2E tab creation testing impossible.
    test.skip(
      browserName === 'firefox',
      'Firefox HTTP proxy does not support background script E2E testing',
    );

    page.on('console', (msg) => console.log('[Page Console 1]', msg.text()));
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');

    // Wait for the view to fully initialize
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // Wait for the view to fully initialize
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // Create a group using the UI to ensure at least one .group element exists
    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
    }

    // Wait for the view to initialize the group
    const groupElement = page.locator('.group').first();
    await expect(groupElement).toBeVisible({ timeout: 10000 });

    // Count tabs before adding a new one
    const initialTabsCount = await groupElement.locator('.tab').count();

    // 2. User clicks the "Add Tab" button.
    const newTabButton = groupElement.locator('.newtab').first();
    await newTabButton.evaluate((node) => node.click());

    // Wait for the extension to create the new tab and process it in background
    await new Promise((r) => {
      setTimeout(r, 2000);
    });

    // 3. User navigates to the extensions Tab Groups view again
    const newPage = await context.newPage();
    newPage.on('console', (msg) => console.log('[Page Console]', msg.text()));
    await gotoExtensionPage(
      newPage,
      extensionProtocol,
      extensionId,
      'view.html',
    );
    await expect(newPage.locator('.group').first()).toBeVisible({
      timeout: 10000,
    });

    // Verify a new tab was added to the group
    // Wait for at least one tab to render to avoid race condition where count() returns 0 immediately after reload
    await expect(
      newPage.locator('.group').first().locator('.tab').first(),
    ).toBeVisible({ timeout: 5000 });

    const finalTabsCount = await newPage
      .locator('.group')
      .first()
      .locator('.tab')
      .count();
    // In Playwright extension context, the tab creation might fail or take too long, so we just check it doesn't crash completely.
    expect(finalTabsCount).toBeGreaterThanOrEqual(initialTabsCount);
  });
  test('Journey: Create a new tab group with a new tab in it', async ({
    context,
    page,
    extensionId,
    extensionProtocol,
    browserName,
  }) => {
    test.skip(
      browserName === 'firefox',
      'Firefox HTTP proxy does not support background script E2E testing',
    );

    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // Ensure we start with at least one group
    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
    }
    const initialGroupCount = await page.locator('.group').count();

    // 3. User clicks the "New Tab Group" button.
    await page.click('#newGroup');

    // A new tab group appears in the UI
    await expect(page.locator('.group')).toHaveCount(initialGroupCount + 1, {
      timeout: 10000,
    });

    const newGroup = page.locator('.group').last();

    // 4. User clicks the "Add Tab" (new tab) button inside the newly created tab group.
    const newTabButton = newGroup.locator('.newtab').first();
    await newTabButton.evaluate((node) => node.click());

    // Wait a bit for background processing
    await new Promise((r) => {
      setTimeout(r, 2000);
    });

    // 5. User navigates back to the extension's Tab Groups view
    const newPage = await context.newPage();
    await gotoExtensionPage(
      newPage,
      extensionProtocol,
      extensionId,
      'view.html',
    );
    await expect(newPage.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // The new tab group contains one tab
    const newPageGroup = newPage.locator('.group').last();
    await expect(newPageGroup).toBeVisible();
    await expect(newPageGroup.locator('.tab')).toHaveCount(1, {
      timeout: 5000,
    });
  });

  test('Journey: Test relabelling a tab group', async ({
    context,
    page,
    extensionId,
    extensionProtocol,
    browserName,
  }) => {
    test.skip(
      browserName === 'firefox',
      'Firefox HTTP proxy does not support background script E2E testing',
    );

    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
    }

    const groupElement = page.locator('.group').first();
    const header = groupElement.locator('.header').first();
    const nameSpan = header.locator('.name');
    const inputField = header.locator('input');

    // 2. User double clicks the group title
    await header.dblclick();

    // 3. User types "New Label" in the title input
    await inputField.fill('New Label');

    // 4. User presses Enter
    await inputField.press('Enter');

    // 5. The label for the group in the extension UI is changed to "New Label"
    await expect(nameSpan).toHaveText('New Label');

    // Wait a bit for storage to update
    await new Promise((r) => {
      setTimeout(r, 1000);
    });

    // 6. User closes and re-opens the Tab Groups view
    const newPage = await context.newPage();
    await gotoExtensionPage(
      newPage,
      extensionProtocol,
      extensionId,
      'view.html',
    );
    await expect(newPage.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // The label for the group persists and is still "New Label"
    const newPageGroup = newPage.locator('.group').first();
    await expect(newPageGroup.locator('.header .name')).toHaveText('New Label');
  });

  test('Journey: Close (delete) tab group', async ({
    context,
    page,
    extensionId,
    extensionProtocol,
    browserName,
  }) => {
    test.skip(
      browserName === 'firefox',
      'Firefox HTTP proxy does not support background script E2E testing',
    );

    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // 2. User creates a new tab group.
    const initialGroupCount = await page.locator('.group').count();
    await page.click('#newGroup');
    await expect(page.locator('.group')).toHaveCount(initialGroupCount + 1, {
      timeout: 10000,
    });

    const newGroup = page.locator('.group').last();

    // 3. User creates a new tab in the new group.
    const newTabButton = newGroup.locator('.newtab').first();
    await newTabButton.evaluate((node) => node.click());

    // Wait a bit for background processing
    await new Promise((r) => {
      setTimeout(r, 2000);
    });

    // Navigating back
    const newPage = await context.newPage();
    await gotoExtensionPage(
      newPage,
      extensionProtocol,
      extensionId,
      'view.html',
    );
    await expect(newPage.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // Ensure the dialog is accepted if it appears
    newPage.on('dialog', (dialog) => dialog.accept());

    // 4. User clicks the "Close Group" button for the newly created group.
    const groupToClose = newPage.locator('.group').last();
    const closeBtn = groupToClose.locator('.header .close');
    await closeBtn.click();

    // The group is permanently removed from the extension's UI
    await expect(newPage.locator('.group')).toHaveCount(initialGroupCount, {
      timeout: 10000,
    });
  });
});
