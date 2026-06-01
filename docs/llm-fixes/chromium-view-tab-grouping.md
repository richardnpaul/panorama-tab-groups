# Chromium View Tab Grouping Fix

## Issue Description

During end-to-end testing, specifically for tests like "UI contains a Settings button that opens options", it was observed that the Panorama Tab Groups View tab (`view.html`) was incorrectly appearing inside a native tab group in Chromium, whereas it did not exhibit this behavior in Firefox. The Panorama View tab is intended to remain ungrouped (assigned a `groupId` of `-1`) and should not be displayed as a regular tab within the extension's UI or grouped natively by the browser.

## Root Cause Analysis

The bug was traced to the `browser.tabs.onUpdated` event listener within `src/js/background.js`. The event listener contained an overly restrictive condition:

```javascript
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // <-- Restrictive condition
    const viewUrl = browser.runtime.getURL('view.html');
    if (changeInfo.url === viewUrl || tab.url === viewUrl) {
      // Ungrouping logic...
    }
  }
});
```

When Playwright navigates a newly created tab to `view.html` using `page.goto()`, Chromium fires multiple `onUpdated` events. If an event (such as `changeInfo.status === 'complete'`) fires after the URL was updated but does not explicitly contain `changeInfo.url`, the view tab ungrouping logic would be completely bypassed. Consequently, the extension failed to assign `groupId: -1` and instead left the `view.html` tab grouped under the active group (`groupId: 0`) and inside a native tab group.

## Resolution

The `onUpdated` listener in `src/js/background.js` was modified to robustly check the tab's URL across all update events, regardless of whether `changeInfo.url` is present in the specific event payload. Additionally, a check was introduced to verify if the tab's group ID is already `-1` to avoid redundant state updates.

### Code Changes (`src/js/background.js`)

**Before:**

```javascript
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const viewUrl = browser.runtime.getURL('view.html');
    if (changeInfo.url === viewUrl || tab.url === viewUrl) {
      await stateManager.setTabGroup(tabId, -1);
      // Native group ungrouping...
    }
  }
});
```

**After:**

```javascript
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const viewUrl = browser.runtime.getURL('view.html');
  if (
    changeInfo.url === viewUrl ||
    tab.url === viewUrl ||
    tab.pendingUrl === viewUrl
  ) {
    const currentGroupId = await stateManager.getTabGroup(tabId);
    if (currentGroupId !== -1) {
      await stateManager.setTabGroup(tabId, -1);
      // Native group ungrouping...
    }
  }
});
```

This ensures the Panorama View tab correctly ungroups itself consistently in Chromium, matching the expected behavior in Firefox.
