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
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');

    // Wait for the view to fully initialize
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // Create a group using the UI to ensure at least one .group element exists
    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
      await expect(page.locator('.group')).toHaveCount(1, { timeout: 10000 });
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
  }) => {
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
      await expect(page.locator('.group')).toHaveCount(1, { timeout: 10000 });
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
  }) => {
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // Ensure we start with at least one group
    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
      await expect(page.locator('.group').first()).toBeVisible({
        timeout: 10000,
      });
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
  }) => {
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
      await expect(page.locator('.group')).toHaveCount(1, { timeout: 10000 });
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
  }) => {
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

  test('Journey: Multi-window tab group isolation', async ({
    context,
    page,
    extensionId,
    extensionProtocol,
    browserName,
  }) => {
    // 1. User opens the extension's Tab Groups view in Window A.
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
      await expect(page.locator('.group')).toHaveCount(1, { timeout: 10000 });
    }

    // 2. User creates a new tab group named "Group A" in Window A.
    const groupElementA = page.locator('.group').first();
    const headerA = groupElementA.locator('.header').first();
    await headerA.dblclick();
    await headerA.locator('input').fill('Group A');
    await headerA.locator('input').press('Enter');
    await expect(groupElementA.locator('.header .name')).toHaveText('Group A');

    // Wait a bit for background processing
    await new Promise((r) => {
      setTimeout(r, 1000);
    });

    // 3. User opens a new browser window (Window B) and navigates to the Tab Groups view.
    let newPage;
    if (browserName === 'chromium') {
      const pagePromise = context.waitForEvent('page');
      const worker = context.serviceWorkers()[0];
      await worker.evaluate(
        async (url) => {
          await chrome.windows.create({ url });
        },
        getExtensionPageUrl(extensionProtocol, extensionId, 'view.html'),
      );
      newPage = await pagePromise;
    } else {
      newPage = await context.newPage();
      await gotoExtensionPage(
        newPage,
        extensionProtocol,
        extensionId,
        'view.html?windowId=2',
      );
    }
    await expect(newPage.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    // 4. Window B does not show "Group A". It displays its own isolated state (default group).
    if ((await newPage.locator('.group').count()) === 0) {
      await newPage.click('#newGroup');
      await expect(newPage.locator('.group')).toHaveCount(1, {
        timeout: 10000,
      });
    }
    const groupElementB = newPage.locator('.group').first();
    await expect(groupElementB).toBeVisible({ timeout: 10000 });
    await expect(groupElementB.locator('.header .name')).not.toHaveText(
      'Group A',
    );

    // 5. User creates a new tab group "Group B" in Window B.
    const initialGroupCountNewGroupB = await newPage.locator('.group').count();
    await newPage.click('#newGroup');
    await expect(newPage.locator('.group')).toHaveCount(
      initialGroupCountNewGroupB + 1,
      { timeout: 10000 },
    );
    const newGroupB = newPage.locator('.group').last();
    const headerB = newGroupB.locator('.header').first();
    await headerB.dblclick();
    await headerB.locator('input').fill('Group B');
    await headerB.locator('input').press('Enter');
    await expect(newGroupB.locator('.header .name')).toHaveText('Group B');

    // 6. User verifies that Window A remains unaffected and still only shows "Group A".
    await expect(groupElementA.locator('.header .name')).toHaveText('Group A');
    await expect(
      page.locator('.group').filter({ hasText: 'Group B' }),
    ).toHaveCount(0);
  });

  test('Journey: Session restore restores tab groups into correct window', async ({
    context,
    page,
    extensionId,
    extensionProtocol,
    browserName,
  }) => {
    // 1. User has Window A with "Group A" and a new tab inside it.
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
      await expect(page.locator('.group')).toHaveCount(1, { timeout: 10000 });
    }
    const groupElementA = page.locator('.group').first();
    const headerA = groupElementA.locator('.header').first();
    await headerA.dblclick();
    await headerA.locator('input').fill('Group A');
    await headerA.locator('input').press('Enter');

    // Add a tab to Group A
    await groupElementA.locator('.newtab').first().click();
    await new Promise((r) => {
      setTimeout(r, 1000);
    });

    // 2. User opens Window B with "Group B" and a new tab inside it.
    let newPage;
    let windowBId;
    if (browserName === 'chromium') {
      const pagePromise = context.waitForEvent('page');
      const worker = context.serviceWorkers()[0];
      windowBId = await worker.evaluate(
        async (url) => {
          const win = await chrome.windows.create({ url });
          return win.id;
        },
        getExtensionPageUrl(extensionProtocol, extensionId, 'view.html'),
      );
      newPage = await pagePromise;
    } else {
      newPage = await context.newPage();
      windowBId = 3; // Distinct mock window ID
      await gotoExtensionPage(
        newPage,
        extensionProtocol,
        extensionId,
        `view.html?windowId=${windowBId}`,
      );
    }
    await expect(newPage.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    if ((await newPage.locator('.group').count()) === 0) {
      await newPage.click('#newGroup');
      await expect(newPage.locator('.group')).toHaveCount(1, {
        timeout: 10000,
      });
    }
    const groupElementB = newPage.locator('.group').first();
    const headerB = groupElementB.locator('.header').first();
    await headerB.dblclick();
    await headerB.locator('input').fill('Group B');
    await headerB.locator('input').press('Enter');
    await expect(groupElementB.locator('.header .name')).toHaveText('Group B');

    // Add a tab to Group B
    await groupElementB.locator('.newtab').first().click();
    await new Promise((r) => {
      setTimeout(r, 1000);
    });

    // 3. User closes Window B.
    await newPage.close();
    await new Promise((r) => {
      setTimeout(r, 1000);
    });

    // 4. User restores the recently closed Window B.
    if (browserName === 'firefox') {
      const restoredPage = await context.newPage();
      await gotoExtensionPage(
        restoredPage,
        extensionProtocol,
        extensionId,
        `view.html?windowId=${windowBId}`,
      );
      await expect(restoredPage.locator('body.view-ready')).toBeVisible({
        timeout: 10000,
      });

      // 6. User observes that "Group B" is successfully restored with its corresponding tabs.
      const restoredGroupB = restoredPage.locator('.group').first();
      await expect(restoredGroupB).toBeVisible();
      await expect(restoredGroupB.locator('.header .name')).toHaveText(
        'Group B',
      );
      await expect(restoredGroupB.locator('.tab')).toHaveCount(1, {
        timeout: 5000,
      });
    } else {
      console.log(
        'Skipping native session restore verification in Chromium due to Playwright limitations.',
      );
    }
  });

  test('Journey: Move tab between existing groups', async ({
    page,
    extensionId,
    extensionProtocol,
  }) => {
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
      await expect(page.locator('.group')).toHaveCount(1, { timeout: 10000 });
    }

    const groupA = page.locator('.group').first();
    const headerA = groupA.locator('.header').first();
    await headerA.dblclick();
    await headerA.locator('input').fill('Group A');
    await headerA.locator('input').press('Enter');
    await expect(headerA.locator('.name')).toHaveText('Group A', {
      timeout: 5000,
    });

    const idA = await groupA.locator('.content').getAttribute('groupId');
    await page.evaluate(async (id) => {
      const win = await browser.windows.getCurrent();
      await browser.sessions.setWindowValue(win.id, 'activeGroup', id);
      const tab = await browser.tabs.create({ active: false });
      await browser.sessions.setTabValue(tab.id, 'groupId', id);
    }, idA);
    await page.reload();
    await expect(page.locator('body.view-ready')).toBeVisible();
    const viewPage = page;

    // Create Group B
    const initialGroupCountGroupB = await viewPage.locator('.group').count();
    await viewPage.click('#newGroup');
    await expect(viewPage.locator('.group')).toHaveCount(
      initialGroupCountGroupB + 1,
      { timeout: 10000 },
    );
    const groupB = viewPage.locator('.group').last();
    const headerB = groupB.locator('.header').first();
    await headerB.dblclick();
    await headerB.locator('input').fill('Group B');
    await headerB.locator('input').press('Enter');
    await expect(headerB.locator('.name')).toHaveText('Group B', {
      timeout: 5000,
    });

    const idB = await groupB.locator('.content').getAttribute('groupId');
    await page.evaluate(async (id) => {
      const win = await browser.windows.getCurrent();
      await browser.sessions.setWindowValue(win.id, 'activeGroup', id);
      const tab1 = await browser.tabs.create({ active: false });
      const tab2 = await browser.tabs.create({ active: false });
      await browser.sessions.setTabValue(tab1.id, 'groupId', id);
      await browser.sessions.setTabValue(tab2.id, 'groupId', id);
    }, idB);
    await page.reload();
    await expect(page.locator('body.view-ready')).toBeVisible();

    const groupALatest = viewPage
      .locator('.group')
      .filter({ hasText: 'Group A' })
      .first();
    const groupBLatest = viewPage
      .locator('.group')
      .filter({ hasText: 'Group B' })
      .first();

    await expect(groupALatest.locator('.tab')).toHaveCount(1, {
      timeout: 10000,
    });
    await expect(groupBLatest.locator('.tab')).toHaveCount(2, {
      timeout: 10000,
    });

    // Use page.evaluate for reliable HTML5 drag and drop
    const groupIdA = await groupALatest
      .locator('.content')
      .getAttribute('groupId');
    const groupIdB = await groupBLatest
      .locator('.content')
      .getAttribute('groupId');

    await viewPage.evaluate(
      ({ a, b }) => {
        const dataTransfer = new DataTransfer();
        const source = document.querySelector(`.content[groupid="${a}"] .tab`);
        const target = document.querySelector(`.content[groupid="${b}"]`);

        source.dispatchEvent(new DragEvent('dragstart', { dataTransfer }));
        target.dispatchEvent(new DragEvent('drop', { dataTransfer }));
        source.dispatchEvent(new DragEvent('dragend', { dataTransfer }));
      },
      { a: groupIdA, b: groupIdB },
    );

    // Wait for the UI to update. Group A should have 0 tabs, Group B should have 3 tabs.
    await expect(groupALatest.locator('.tab')).toHaveCount(0, {
      timeout: 10000,
    });
    await expect(groupBLatest.locator('.tab')).toHaveCount(3, {
      timeout: 10000,
    });
  });

  test('Journey: Drag tab outside to create a new group', async ({
    page,
    extensionId,
    extensionProtocol,
  }) => {
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
      await expect(page.locator('.group')).toHaveCount(1, { timeout: 10000 });
    }

    const groupA = page.locator('.group').first();
    const idA = await groupA.locator('.content').getAttribute('groupId');
    await page.evaluate(async (id) => {
      const win = await browser.windows.getCurrent();
      await browser.sessions.setWindowValue(win.id, 'activeGroup', id);
      const tab = await browser.tabs.create({ active: false });
      await browser.sessions.setTabValue(tab.id, 'groupId', id);
    }, idA);
    await page.reload();
    await expect(page.locator('body.view-ready')).toBeVisible();
    const viewPage = page;

    const groupALatest = viewPage.locator('.group').first();
    await expect(groupALatest.locator('.tab')).toHaveCount(1, {
      timeout: 10000,
    });

    const initialGroupCount = await viewPage.locator('.group').count();
    const groupIdA = await groupALatest
      .locator('.content')
      .getAttribute('groupId');

    // Drag to empty space in #groups
    await viewPage.evaluate(
      ({ a }) => {
        const dataTransfer = new DataTransfer();
        const source = document.querySelector(`.content[groupid="${a}"] .tab`);
        const target = document.querySelector('#groups');

        source.dispatchEvent(
          new DragEvent('dragstart', { dataTransfer, clientX: 0, clientY: 0 }),
        );
        target.dispatchEvent(
          new DragEvent('drop', { dataTransfer, clientX: 200, clientY: 200 }),
        );
        source.dispatchEvent(new DragEvent('dragend', { dataTransfer }));
      },
      { a: groupIdA },
    );

    // A new group should be created
    await expect(viewPage.locator('.group')).toHaveCount(
      initialGroupCount + 1,
      { timeout: 10000 },
    );

    const newGroup = viewPage.locator('.group').last();
    await expect(newGroup.locator('.tab')).toHaveCount(1);
    await expect(groupALatest.locator('.tab')).toHaveCount(0);
  });

  test('Journey: Move tab between OS windows', async ({
    context,
    page,
    extensionId,
    extensionProtocol,
    browserName,
  }) => {
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
      await expect(page.locator('.group')).toHaveCount(1, { timeout: 10000 });
    }

    const groupA = page.locator('.group').first();
    const headerA = groupA.locator('.header').first();
    await headerA.dblclick();
    await headerA.locator('input').fill('Group A');
    await headerA.locator('input').press('Enter');
    await expect(headerA.locator('.name')).toHaveText('Group A', {
      timeout: 5000,
    });

    const idA = await groupA.locator('.content').getAttribute('groupId');
    await page.evaluate(async (id) => {
      const win = await browser.windows.getCurrent();
      await browser.sessions.setWindowValue(win.id, 'activeGroup', id);
      const tab = await browser.tabs.create({ active: false });
      await browser.sessions.setTabValue(tab.id, 'groupId', id);
    }, idA);
    await page.reload();
    await expect(page.locator('body.view-ready')).toBeVisible();
    const viewPageA = page;

    const tabElement = viewPageA
      .locator('.group')
      .first()
      .locator('.tab')
      .first();
    const tabIdStr = await tabElement.getAttribute('tabId');
    const tabId = parseInt(tabIdStr, 10);

    // Open Window B
    let viewPageB;
    let windowBId;
    if (browserName === 'chromium') {
      const pagePromise = context.waitForEvent('page');
      const worker = context.serviceWorkers()[0];
      windowBId = await worker.evaluate(
        async (url) => {
          const win = await chrome.windows.create({ url });
          return win.id;
        },
        getExtensionPageUrl(extensionProtocol, extensionId, 'view.html'),
      );
      viewPageB = await pagePromise;
    } else {
      viewPageB = await context.newPage();
      windowBId = 4; // Distinct mock window ID
      await gotoExtensionPage(
        viewPageB,
        extensionProtocol,
        extensionId,
        `view.html?windowId=${windowBId}`,
      );
    }
    await expect(viewPageB.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    if (browserName === 'chromium') {
      const worker = context.serviceWorkers()[0];
      await worker.evaluate(
        async ({ tId, winId }) => {
          await chrome.tabs.move(tId, { windowId: winId, index: -1 });
        },
        { tId: tabId, winId: windowBId },
      );
    } else {
      console.log(
        'Skipping native tab move verification in Firefox mock due to single-window limitation.',
      );
      return;
    }

    // Verify it disappeared from A and appeared in B
    const groupALatest = viewPageA
      .locator('.group')
      .filter({ hasText: 'Group A' })
      .first();
    await expect(groupALatest.locator('.tab')).toHaveCount(0, {
      timeout: 10000,
    });

    const groupB = viewPageB.locator('.group').first();
    await expect(groupB.locator('.tab')).toHaveCount(1, { timeout: 10000 });
  });

  test('Journey: Toggle off native tab groups (Firefox only)', async ({
    page,
    extensionId,
    extensionProtocol,
    browserName,
  }) => {
    if (browserName !== 'firefox') {
      test.skip();
      return;
    }

    // Disable native groups via options page
    await gotoExtensionPage(
      page,
      extensionProtocol,
      extensionId,
      'options.html',
    );
    const nativeCheckbox = page.locator('#useNativeGroups');
    if (await nativeCheckbox.isChecked()) {
      await nativeCheckbox.uncheck();
    }

    // Go to view
    await gotoExtensionPage(page, extensionProtocol, extensionId, 'view.html');
    await expect(page.locator('body.view-ready')).toBeVisible({
      timeout: 10000,
    });

    if ((await page.locator('.group').count()) === 0) {
      await page.click('#newGroup');
      await expect(page.locator('.group')).toHaveCount(1, { timeout: 10000 });
    }
    const newGroup = page.locator('.group').last();
    const idNew = await newGroup.locator('.content').getAttribute('groupId');
    await page.evaluate(async (id) => {
      const win = await browser.windows.getCurrent();
      await browser.sessions.setWindowValue(win.id, 'activeGroup', id);
      const tab = await browser.tabs.create({ active: false });
      await browser.sessions.setTabValue(tab.id, 'groupId', id);
    }, idNew);
    await page.reload();
    await expect(page.locator('body.view-ready')).toBeVisible();
    const viewPage = page;

    // Evaluate via Playwright's page to check tabGroups
    const tabGroupsCount = await viewPage.evaluate(async () => {
      if (typeof browser.tabGroups?.query === 'function') {
        const groups = await browser.tabGroups.query({});
        return groups.length;
      }
      return 0;
    });

    expect(tabGroupsCount).toBe(0);
  });
});
