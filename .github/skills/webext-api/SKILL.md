---
name: webext-api
description: WebExtension MV3 API reference for Firefox-first browser extensions. Covers browser.tabs, browser.storage, browser.sessions (Firefox-only), browser.runtime messaging with sender validation, cross-browser compatibility, and MV3 service worker lifecycle constraints. Use when planning or implementing any browser.* API call.
---

## When to Use

Load this skill before writing any code that touches `browser.*` APIs, before planning any background script changes, or when evaluating cross-browser compatibility.

## Core APIs

### `browser.tabs`

| Method                                    | Notes                                             |
| ----------------------------------------- | ------------------------------------------------- |
| `browser.tabs.query(queryInfo)`           | Cross-browser. Returns array of `Tab` objects.    |
| `browser.tabs.update(tabId, updateProps)` | Cross-browser. Move/pin/activate tabs.            |
| `browser.tabs.move(tabIds, moveProps)`    | Cross-browser.                                    |
| `browser.tabs.hide(tabIds)`               | **Firefox-only** — requires `tabHide` permission. |
| `browser.tabs.show(tabIds)`               | **Firefox-only** — requires `tabHide` permission. |
| `browser.tabs.create(createProps)`        | Cross-browser.                                    |
| `browser.tabs.remove(tabIds)`             | Cross-browser.                                    |

### `browser.storage`

| Area                      | Notes                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| `browser.storage.local`   | Cross-browser. Persistent across restarts. Used for cross-window state. |
| `browser.storage.session` | MV3 only. Cleared when browser closes. Not used in this project.        |

> **NEVER call storage APIs directly.** Always use `StateManager` (see `#skill:js-codebase-patterns`).

### `browser.sessions` ✔️ Firefox-only

Used by `StateManager` for per-window and per-tab metadata.

| Method                                                  | Notes                               |
| ------------------------------------------------------- | ----------------------------------- |
| `browser.sessions.setWindowValue(windowId, key, value)` | Persist value to window session.    |
| `browser.sessions.getWindowValue(windowId, key)`        | Retrieve value from window session. |
| `browser.sessions.setTabValue(tabId, key, value)`       | Persist value to tab session.       |
| `browser.sessions.getTabValue(tabId, key)`              | Retrieve value from tab session.    |

> `browser.sessions` is **not available in Chromium**. All StateManager session calls are Firefox-only paths.

### `browser.tabGroups` ⚠️ Chromium-only

`chrome.tabGroups` (Chromium MV3 API) has **no equivalent in Firefox**. Do not plan features that require this API unless they are explicitly Chromium-only paths.

### `browser.runtime`

| Method / Event                          | Notes                                              |
| --------------------------------------- | -------------------------------------------------- |
| `browser.runtime.onMessage.addListener` | Cross-browser. **Always validate sender.**         |
| `browser.runtime.sendMessage`           | Cross-browser.                                     |
| `browser.runtime.id`                    | Cross-browser. Extension's own ID.                 |
| `browser.runtime.getURL(path)`          | Cross-browser. Construct extension-internal URLs.  |
| `browser.runtime.onInstalled`           | Cross-browser. MV3 service worker lifecycle event. |

### `browser.commands`

| Method                       | Notes                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `browser.commands.onCommand` | Cross-browser. Keyboard shortcut events. Defined in `manifest.json` under `commands`. |

### `browser.menus` ✔️ Firefox-only

`browser.menus` (Firefox) vs `chrome.contextMenus` (Chromium). Not interchangeable.

---

## MV3 Service Worker Lifecycle

The background service worker (`src/js/background.js`) can be terminated at **any time** between events. There is **no persistent in-memory state**.

```javascript
// ❌ WRONG — module-level state is lost when service worker sleeps
let cachedGroups = null;

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  // cachedGroups is null here if SW was terminated between events
  processGroups(cachedGroups);
});

// ✅ CORRECT — always reconstruct state from StateManager on each event
browser.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const groups = await stateManager.getGroups(windowId);
  processGroups(groups);
});
```

## `browser.runtime.onMessage` Sender Validation

Always validate the sender before trusting any message:

```javascript
// ❌ WRONG — any web page or extension can send messages
browser.runtime.onMessage.addListener((message, sender) => {
  handleMessage(message);
});

// ✅ CORRECT — only accept messages from this extension's own pages
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id) return; // reject foreign senders
  handleMessage(message);
});
```

## Cross-Browser Compatibility

| API                         | Firefox | Chromium | Notes                                 |
| --------------------------- | ------- | -------- | ------------------------------------- |
| `browser.sessions`          | ✅      | ❌       | Firefox-only; StateManager uses this  |
| `browser.tabs.hide/show`    | ✅      | ❌       | Requires `tabHide` permission         |
| `browser.tabGroups`         | ❌      | ✅       | Chromium-only                         |
| `browser.menus`             | ✅      | ❌       | Use `chrome.contextMenus` on Chromium |
| `browser.storage.local`     | ✅      | ✅       | Persistent, cross-browser             |
| `browser.runtime.onMessage` | ✅      | ✅       | Always validate sender                |
| `moz-extension://` URLs     | ✅      | ❌       | Firefox internal URL scheme           |
| `chrome-extension://` URLs  | ❌      | ✅       | Chromium internal URL scheme          |

## Permissions

All permissions are declared in `src/manifest.json`. When adding new `browser.*` API calls:

1. Check if the API requires a permission
2. Add the minimum required permission to `manifest.json`
3. Note the permission in your plan's **WebExtension API Notes** section

Common permissions in this project:

- `tabs` — required for most `browser.tabs.*` calls
- `tabHide` — Firefox-only, for `tabs.hide/show`
- `sessions` — Firefox-only, for `browser.sessions.*`
- `storage` — for `browser.storage.local`
