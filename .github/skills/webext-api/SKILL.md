---
name: webext-api
description: WebExtension API guidance for tab-groups-viewer, one codebase for Firefox and Chromium. Covers which APIs each browser has and how the code finds out (capability detection), the polyfill that makes Chromium look like Firefox, background lifecycle, messaging and sender validation, and permissions. Use when planning or implementing any browser.* API call.
---

## When to Use

Load this skill before writing code that touches `browser.*`, before planning background changes, and
when judging cross-browser behaviour.

It holds how the extension deals with the two browsers, not a copy of the API reference. For an API's
exact signature use MDN or `@types/firefox-webext-browser`; for what this extension needs from a
browser, read the file this skill names.

## One source, two browsers

The extension is built once into `dist/` and copied to `dist-firefox/`, where the manifest's
`background` keeps only `scripts` (`scripts/lib/firefox-build.ts`). The manifest declares both:
Firefox runs `background.scripts`, Chromium runs `background.service_worker`, and both point at the
compiled `src/js/background/main.ts`. Do not fork code by browser; use a capability check or the
polyfill (below).

## Capability detection, not browser names

`src/js/share/capabilities.ts` asks what the running browser can do and turns the answer into a mode.
Read that file for the current checks and the browser versions it records. The shape of it:

| Mode            | Browser         | What the browser has                 |
| --------------- | --------------- | ------------------------------------ |
| `hybrid`        | Current Firefox | Tab hiding **and** native tab groups |
| `collapse-only` | Chromium        | Native tab groups only               |
| `legacy`        | Older Firefox   | Tab hiding only                      |
| `unsupported`   | Anything else   | Neither                              |

- **`tabs.hide` / `tabs.show`** exist only in Firefox and need the `tabHide` permission.
- **`tabGroups`, `tabs.group`, `tabs.ungroup`** exist in Chromium and in current Firefox. They are not
  Chromium-only. They are optional, so the code feature-detects them (`api.tabGroups?.…`) rather than
  assuming a browser.
- A new feature that needs one of these asks `detectCapabilities`/`browserModeOf` and has a defined
  behaviour in every mode, including the ones without it. A plan states which modes it supports.

## The polyfill

`src/js/polyfill.ts` is installed first in every extension context and makes Chromium look like Firefox.
Application code does not branch on the browser; the polyfill closes the gap.

- **`browser` is `chrome`** where `browser` is missing.
- **`sessions` values.** Chromium has the `sessions` namespace but not the per-tab and per-window value
  methods (`getWindowValue`, `setTabValue` and the others), which the extension uses for its group
  state. `adapters/browser/sessions-emulation.ts` keeps them in `storage.local` instead. The storage key
  is the one earlier versions used, because changing it would lose users' groups; do not rename it.
- **`action` calls** are retried without `windowId` where the browser rejects it
  (`adapters/browser/action-compat.ts`).
- **Locks** for exclusive sections use `navigator.locks` where the context has it.

A new gap between browsers is closed in the polyfill (or behind a port's browser adapter), once, not at
each call site.

## Where the browser is named

Only adapters (`src/js/adapters/browser/`) and composition roots call `browser.*`, and
`browser.storage` / `browser.sessions` may not be named elsewhere (`tgv/no-browser-storage`). See
`#skill:ts-codebase-patterns`. `app` and `core` code receives ports and never learns which browser it
is in.

Storage areas in use: `storage.sync` for the user's options, `storage.local` for the emulated session
values and the migration flag. `storage.session` is not used.

## Menus, commands and the toolbar

- **Context menus** use `contextMenus`, through the menus adapter, in both browsers. Do not use
  Firefox's `menus` namespace.
- **Keyboard shortcuts** are `commands` in `src/manifest.json`. Users can change them, so read the
  current key through the `shortcuts` port (its adapter calls `commands.getAll()`) instead of
  hard-coding it.
- **The toolbar button** is `action` (MV3), through the polyfill above.

## Background lifecycle

Firefox's background script is not persistent and Chromium's service worker is stopped when idle. Either
can be unloaded between events, and then everything in memory is gone.

- **No state in module variables.** Rebuild what an event handler needs from the port (`GroupState`,
  options) on each event.
- **Register listeners synchronously** when the background starts, at the top level of its entry point
  and not after an `await`; an event that arrives while the background wakes up is delivered only to
  listeners that were registered in that first turn.
- **Handlers return or await their work**, so the browser keeps the background alive until it is done.

```typescript
// ❌ Lost when the background is unloaded between events
let cachedGroups: Group[] | undefined;

// ✅ Read it from the port each time
browser.tabs.onActivated.addListener(async ({ windowId }) => {
  const groups = await groupState.getGroups(windowId);
  // ...
});
```

(In this codebase the listener lives in `adapters/browser/events.ts` and the logic in `app/`; the
example shows the rule, not where the code goes.)

## Messaging and sender validation

Treat every message as untrusted input and check both who sent it and what it says.

```typescript
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  // Only this extension's own pages and scripts
  if (sender.id !== browser.runtime.id) return undefined;
  // Narrow `message` with a type guard before using it
  // ...
});
```

- **`runtime.onMessage`** gets messages from this extension's own contexts (and from its content
  scripts, if it had any). Check `sender.id` and narrow the message with a type guard.
- **`runtime.onMessageExternal`** gets messages from **other extensions**, who are strangers. Accept a
  closed set of known commands, do nothing else, and log what you refuse. Never act on arbitrary data
  from it, and do not widen `externally_connectable` without a recorded decision.
- Messages are structured clones, not objects with methods; send plain data.

## Permissions

`src/manifest.json` is the list of permissions and the only source of truth; do not copy it here.
When a change adds a `browser.*` call:

1. Check whether the API needs a permission (MDN says).
2. Add the least that works to `src/manifest.json`; a new permission is also a security-review item
   (`#skill:webext-security`) and may need a stated reason to the user.
3. Keep the manifest's `data_collection_permissions` true: no new data collection or network access
   without the user's decision.
4. Record the API, its permission and its per-browser behaviour in the plan's **WebExtension API
   Notes** section.

Some permissions only mean something in one browser (`tabHide` is Firefox's). That is fine; the
capability check decides at run time.

## Pitfalls

| Pitfall                                                 | Fix                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Branching on `navigator.userAgent` or the browser name  | Feature-detect (`capabilities.ts`) or extend the polyfill     |
| Assuming `tabGroups` is Chromium-only (or Firefox-only) | It is in both, optional; detect it                            |
| Calling `sessions.setWindowValue` directly              | Go through the `GroupState` port; Chromium has no such method |
| State in a module variable                              | Rebuild from the port on each event                           |
| Registering a listener after an `await` at startup      | Register at the top level, synchronously                      |
| `moz-extension://` vs `chrome-extension://` hard-coded  | Use `runtime.getURL(path)`                                    |
