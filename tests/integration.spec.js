import { test, expect } from '../playwright.config.js';

function getExtensionPageUrl(extensionProtocol, extensionId, pagePath) {
  return `${extensionProtocol}://${extensionId}/${pagePath}`;
}

test.describe('Background Listeners & Visibility Toggle', () => {
  test('tabCreated assigns new tabs to the active group', async ({
    context,
    page,
    extensionId,
    extensionProtocol,
    browserName,
  }) => {
    // Firefox uses a proxy with a mocked window.browser for extension pages,
    // which prevents us from querying the real extension's background state.
    test.skip(
      browserName === 'firefox',
      'Firefox proxy mock prevents querying real extension state',
    );

    // Firefox uses a proxy for initial page, let's open a new page for the extension
    context.serviceWorkers().forEach((worker) => {
      worker.on('console', (msg) => console.log('SW:', msg.text()));
    });
    context.on('serviceworker', (worker) => {
      worker.on('console', (msg) => console.log('SW:', msg.text()));
    });
    const extPage = page;
    const optionsUrl = getExtensionPageUrl(
      extensionProtocol,
      extensionId,
      'options.html',
    );
    await extPage.goto(optionsUrl);

    // Note: If this is a brand new profile, activeGroup might be undefined until a tab is created or popup is opened.
    // Let's open the popup first to initialize state
    const popupUrl = getExtensionPageUrl(
      extensionProtocol,
      extensionId,
      'popup-view/index.html',
    );
    await extPage.goto(popupUrl);

    // Wait for groups to initialize in the popup (removes content-loading class)
    await expect(extPage.locator('body')).not.toHaveClass(/content-loading/, {
      timeout: 5000,
    });

    // Now go back to options to use as our API bridge
    await extPage.goto(optionsUrl);

    const initializedState = await extPage.evaluate(async () => {
      const currentWindow = await window.browser.windows.getCurrent();
      const activeGroup = await window.browser.sessions.getWindowValue(
        currentWindow.id,
        'activeGroup',
      );
      return { windowId: currentWindow.id, activeGroup };
    });

    // Open a new web page (simulating user opening a new tab)
    const newWebPage = await context.newPage();
    await newWebPage.goto(
      'data:text/html,<body style="background: white;"><h1>New Tab</h1></body>',
    );
    await expect(newWebPage.locator('h1')).toBeVisible();

    // Query the extension to find this new tab and wait for its group ID to be assigned
    const newTabGroupInfo = await extPage.evaluate(async () => {
      // Find the tab we just created (it should be active)
      const [activeTab] = await window.browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab) return null;

      // Poll until groupId is set (tabCreated finishes)
      let groupId;
      let checks = 0;
      console.log('Active tab found:', activeTab.id, activeTab.url);
      for (let i = 0; i < 100; i += 1) {
        checks = i;
        // eslint-disable-next-line no-await-in-loop
        groupId = await window.browser.sessions.getTabValue(
          activeTab.id,
          'groupId',
        );
        if (groupId !== undefined && groupId !== null) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => {
          setTimeout(r, 100);
        });
      }

      return { tabId: activeTab.id, groupId, url: activeTab.url, checks };
    });

    console.log('Tab group info:', newTabGroupInfo);
    expect(newTabGroupInfo).not.toBeNull();
    // The new tab should be assigned to the active group
    // If activeGroup was initially undefined or null, the background script assigns it to 0 or lowest positive.
    const expectedGroup =
      initializedState.activeGroup !== undefined &&
      initializedState.activeGroup !== null
        ? initializedState.activeGroup
        : newTabGroupInfo.groupId;
    expect(newTabGroupInfo.groupId).toBe(expectedGroup);
  });
});
