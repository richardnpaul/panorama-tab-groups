# Implementation Plan: Tab Thumbnail Capture and Fallback Across Browsers

> **Status: not started.** Meant to replace PR #29, which is not in this clone's history and could
> not be read here (`gh` is not installed). Decision 2 is for the owner; decisions 1, 3, 4 and 5
> depend on the Phase 1 answers.

## Overview

Tab thumbnails in the view (`src/view.html`) show as empty light boxes instead of the page.

What the code and the browsers' documentation show:

1. **Chromium never takes a picture.** The adapter calls `tabs.captureTab`, which Chrome's `tabs`
   reference does not list. The adapter then gives `undefined` and nothing is drawn
   ([view-tabs.ts:94-99](../../src/js/adapters/browser/view-tabs.ts#L94-L99)).
2. **Firefox has no permission to take one.** MDN, `tabs.captureTab`: "You must have the `<all_urls>`
   permission to use this method." The manifest has no host permissions and `optional_permissions` is
   `[]` ([manifest.json](../../src/manifest.json)), so every `captureTab` call is expected to reject.
   Q1 checks this.
3. **Hidden tabs might not be painted.** This is a hypothesis, not a finding. The view captures after
   it opens, when the other tabs are in the background or hidden (`tabs.hide`). Whether Firefox then
   gives a blank picture, even with `<all_urls>`, is Q2. MDN's `captureTab` page says nothing about
   hidden tabs.

A rejected capture does not stop the others. `captureThumbnails` passes each capture to
`Promise.all`, which settles at the first rejection, but the other captures run on and each saves its
own picture. The rejection is not unhandled either: [start.ts:154](../../src/js/view/start.ts#L154)
passes it to `report`, which logs it. So rejections fill the log; they do not cause the empty boxes.

## What is there today

- **When pictures are taken.** Once when the view starts
  ([start.ts:154](../../src/js/view/start.ts#L154)), and each time it becomes visible again
  ([controller.ts:349](../../src/js/view/controller.ts#L349)).
- **Which tabs.** [controller.ts:155-179](../../src/js/view/controller.ts#L155-L179) captures every
  tab of the window, including the view's own tab. A tab is skipped when its kept picture is not older
  than `tab.lastAccessed`.
- **How.** The adapter calls `captureTab(tabId, { format: 'jpeg', quality: 25 })`, or gives
  `undefined` if there is no `captureTab`.
- **Shrinking.** In the view page with DOM `Image` and `<canvas>`
  ([start.ts:128-131](../../src/js/view/start.ts#L128-L131)). Pictures are made 500 px wide at JPEG
  quality 0.7 ([thumbnail-image.ts:34-36](../../src/js/view/thumbnail-image.ts#L34-L36)).
- **Storage.** Pictures are kept with `sessions.setTabValue(tabId, 'thumbnail', …)`
  ([adapters/browser/view-state.ts](../../src/js/adapters/browser/view-state.ts)). In Chromium,
  [polyfill.ts:64-71](../../src/js/polyfill.ts#L64-L71) puts the emulation in its place. The emulation
  ([sessions-emulation.ts](../../src/js/adapters/browser/sessions-emulation.ts)) keeps every tab's
  and window's values under one `storage.local` key, `__mock_sessions`. Every call reads all of it,
  and every change writes all of it back. Nothing removes a closed tab's thumbnail: `removeTabValue` is only called for
  `groupId` ([group-state.ts:114](../../src/js/adapters/browser/group-state.ts#L114)).
- **Drawing.** [tab-nodes.ts:183-185](../../src/js/view/tab-nodes.ts#L183-L185) sets
  `backgroundImage`, or `''` when there is no picture. `.tab .thumbnail` has
  `background-color: #f9f9fa` ([tab.css:65-75](../../src/css/tab.css#L65-L75)), inside
  `.tab .inner` with `background-color: #ffffff`. The view has a dark theme
  ([dark.css](../../src/css/dark.css), [view/theme.ts](../../src/js/view/theme.ts)).
- **How the view opens.**
  - `action.onClicked` runs `toggleView`
    ([events.ts:123-124](../../src/js/adapters/browser/events.ts#L123-L124),
    [view-toggle.ts](../../src/js/app/view-toggle.ts)), which opens `/view.html` with `tabs.open`.
  - `Ctrl+Shift+F` is `_execute_action`, which per MDN `commands` "works like a click on a toolbar
    button" and does not fire `commands.onCommand`.
  - When the popup is chosen, `setPopup` sets one
    ([view-refresh.ts:33](../../src/js/app/view-refresh.ts#L33)). MDN `action.onClicked`: "This
    event will not fire if the browser action has a popup." The popup's code (`src/popup-view/`)
    does not open `view.html`.
- **E2E.** Tests open the view with `page.goto` ([pages.ts:101](../../tests/e2e/pages.ts#L101)), not
  through the toolbar button. No test covers thumbnails.
- **Spec.** [docs/spec.md:25](../../docs/spec.md) and [docs/spec.md:60](../../docs/spec.md) describe
  the `captureTab` behaviour.

## What the documentation says

| Fact                                                                                                                                                    | Source                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `captureTab`: "You must have the `<all_urls>` permission"; `activeTab` is not mentioned                                                                 | MDN `tabs.captureTab`                      |
| `captureVisibleTab`: "You must have the `<all_urls>` permission or the `activeTab` permission"; "In Firefox 125 and earlier … only … with `<all_urls>`" | MDN `tabs.captureVisibleTab`               |
| Chromium `captureVisibleTab` needs "either the <all_urls> permission or the activeTab permission"; `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` is 2      | Chrome `tabs` reference                    |
| `quality` is an integer from 0 to 100                                                                                                                   | MDN `extensionTypes.ImageDetails`          |
| `activeTab` is granted by the toolbar button, an extension context-menu item, or a `commands` shortcut (Firefox 63+); `_execute_action` is not named    | MDN `activeTab` permission                 |
| Chromium grants `activeTab` for "Executing an action" and "a keyboard shortcut from the commands API"; the popup and `_execute_action` are not named    | Chrome `activeTab` concept page            |
| `activeTab` access "is revoked when the user navigates away or closes the tab"                                                                          | Chrome `activeTab` concept page            |
| `optional_host_permissions` is in Firefox from 128; Firefox still accepts hosts in `optional_permissions`                                               | MDN `optional_permissions`                 |
| User actions in an extension page: "Clicking a button on a page bundled with the extension"; a promise waited on first loses the user action            | MDN User actions                           |
| `storage.local` holds 10 MB (5 MB in Chrome 113 and earlier) unless the extension has `unlimitedStorage`                                                | Chrome `storage` reference                 |
| `extensionPermissions.ftl` has no `activeTab` entry                                                                                                     | Firefox source, `extensionPermissions.ftl` |

The manifest has no `strict_min_version`, so no Firefox version is excluded, including those before
126 (no `activeTab` capture) and before 128 (no `optional_host_permissions`).

## Requirements

- Every tab without a picture shows a deliberate placeholder, never an empty light box.
- No permission warning on install, and no new prompt for users who do not turn previews on.
- One failed capture never stops another one, and expected failures are not logged as errors.
- A blank picture is never saved over the placeholder.
- In Chromium, thumbnails do not grow `__mock_sessions` without limit.

## Decisions

### Decision 1: capture the active tab with `captureVisibleTab` before the view opens

- `toggleView` runs in the background from the toolbar button or the shortcut, while the tab the
  user was on is still the active one. It captures that tab with
  `tabs.captureVisibleTab(windowId, { format: 'jpeg', quality })`, then opens the view.
- There is no event before a tab switch: `tabs.onActivated` comes after it. So "before switching to
  another tab" is not possible. The only capture points are opening the view and, with decision 2,
  a page finishing loading in the active tab.
- With `activeTab` only, capture works only when the view is opened through the toolbar button or
  its shortcut, and only if that grants `activeTab` (Q1). With the popup chosen, `toggleView` does
  not run, so nothing is captured before the view opens.
- Shrinking in the background is avoided. In Chromium MV3, the background is a service worker lacking
  `Image` and DOM `canvas` (and `OffscreenCanvas` lacks `.toDataURL()`, requiring conversion through
  `Blob` and `FileReader`/`arrayBuffer`). Instead, the background captures the raw image via
  `tabs.captureVisibleTab` and saves it via `ViewState.setThumbnail`. When `view.html` opens, it
  shrinks the image to thumbnail dimensions using its existing DOM canvas shrinker
  ([thumbnail-image.ts](../../src/js/view/thumbnail-image.ts)) and saves the shrunk thumbnail back to
  `ViewState`. Because Chromium stores thumbnails under an isolated storage key outside
  `__mock_sessions` (decision 5), passing the raw capture through `ViewState` creates zero contention
  or serialization bloat for core session state.
- The capture must not hold up the view opening for long: the view is opened after the capture
  settles, or after a timeout, whichever is first (the timeout is measured in Phase 1).

### Decision 2 (for the owner): how much permission

| Option                                  | Pictures of                                                     | Install warning | Prompt                |
| --------------------------------------- | --------------------------------------------------------------- | --------------- | --------------------- |
| A. `activeTab` only                     | the tab open when the view was opened by the button or shortcut | none (Q4)       | none                  |
| B. A, plus optional `<all_urls>` opt-in | A, plus each page that finishes loading in the active tab       | none            | when the user opts in |

- B needs a toggle in the options page that calls `permissions.request({ origins: ['<all_urls>'] })`
  as the first call of a button's `click` handler. MDN lists only a button click as a user action in
  an extension page, so it is a button, not a checkbox `change`.
- B keeps no setting of its own: whether previews are on is `permissions.contains`, so turning the
  permission off in `about:addons` or `chrome://extensions` is seen.
- With B, the key is `optional_host_permissions` (Firefox 128 and Chromium) or `optional_permissions`
  (Firefox only, per MDN). The manifest is shared, so the choice must work in both (Q5), and may need
  a `strict_min_version`.
- With B, captures on load are limited by Chromium's 2 calls a second.
- The earlier version of this plan says PR #29 put `<all_urls>` in the Firefox build only. Both
  options are in `src/manifest.json`, since Chromium needs the same permission.

### Decision 3: stop capturing tabs that cannot be captured

- Depends on Q2. If hidden or background tabs give blank pictures, the view stops calling
  `captureTab` for them, because a blank picture would be saved and drawn instead of the
  placeholder, and its `capturedAt` would stop a later capture. If `captureTab` gives good pictures
  of background tabs once permission is there, it stays, for Firefox with `<all_urls>`, for tabs
  that are not hidden. With option A there is no `<all_urls>`, so `captureTab` is not called at all.
- No capture of the view's own tab or of URLs other than `http:`, `https:` and `file:`. MDN says
  `activeTab` can capture "sensitive sites"; the filter is still kept, because a picture of
  `about:` pages is not wanted.
- A failed capture gives `undefined` in the adapter, so the controller does not need its own
  `try…catch`.

### Decision 4: a placeholder instead of an empty box

- `.tab .thumbnail.empty` gets a background taken from the theme (light and `dark.css`), with the
  tab's favicon at 32 px in the middle and the host name under it. Tabs without a host name
  (`file:`, `about:`) show the favicon alone.
- `.tab .thumbnail.empty` suppresses the corner `.tab .favicon` in CSS (`.tab .thumbnail.empty ~ .favicon { display: none; }`
  in [tab.css](../../src/css/tab.css)) so that cards without thumbnails do not display conflicting
  duplicate favicons.
- `updateThumbnail` adds `.empty` when there is no picture and removes it when there is one.

### Decision 5: Chromium storage isolated under a dedicated key

- In Chromium, thumbnails are stored under a dedicated key (`storage.session` or an isolated
  `storage.local` key `tgv_thumbnails: Record<number, Thumbnail>`), completely separated from
  `__mock_sessions`.
  - `sessions-emulation.ts` needs zero modifications.
  - Core group state operations (`groupId`, window layout) never serialize or deserialize thumbnail
    payloads under the global mutex.
  - Routine tab switches and active group changes incur zero thumbnail-related LevelDB I/O latency.
- Pictures are shrunk in `view.html`. Width and quality are chosen in Phase 1 from measured sizes; no
  size per picture is assumed here.
- Clean-up on `tabs.onRemoved` deletes only the tab's entry in `tgv_thumbnails` / `storage.session`.
  Whether Firefox needs the same is Q6: if Firefox keeps a closed tab's values to restore it, removing
  them would lose the picture of a reopened tab.
- At start-up, Chromium drops entries in `tgv_thumbnails` for tab ids that no open tab has. If the
  data-structures plan's rebuild ([data-structures-review.md](data-structures-review.md) decision 1)
  remaps restored tabs to new ids, thumbnails move with them.

## Questions (Phase 1)

1. **Q1 (Firefox lab, Chromium).** Does `captureTab` reject without `<all_urls>`, and with what
   error? Does `captureVisibleTab` with only `activeTab` work from `action.onClicked`, after a
   click and after the `_execute_action` shortcut? Chromium: the same two. The lab drives the
   probe's background, which cannot click the toolbar button, so whether this part can be answered
   in the lab is part of the question.
2. **Q2 (Firefox lab).** With `<all_urls>`, what does `captureTab` give for a background tab and for a
   hidden tab: the page, or a blank picture? Proof is a test that compares the picture with one of
   the same page while it was active.
3. **Q3 (Chromium E2E).** How long does `captureVisibleTab` take, and what is the typical raw byte
   size before `view.html` shrinks it?
4. **Q4 (source).** Does `activeTab` add an install warning? Firefox's `extensionPermissions.ftl` has
   no entry for it; Chromium's warning list has to be read and cited.
5. **Q5 (both).** Which optional host permission key do both browsers accept in this shared MV3
   manifest without a lint or load error (`npm run lint`, `web-ext lint`, loading in Chromium)?
6. **Q6 (Firefox lab).** Are `sessions` tab values still there after a closed tab is reopened with
   `sessions.restore`? MDN's `setTabValue` page does not say.
7. **Q7 (E2E).** How does an E2E test get a capture? The tests open the view with `page.goto`, which
   grants no `activeTab`, and no message asks the background to toggle the view (`toggleView` is
   only wired to `action.onClicked`). One way to test is a test build with `<all_urls>` in
   `host_permissions`, which does not prove the `activeTab` route.

## Affected files

- [src/manifest.json](../../src/manifest.json): `activeTab`; with option B, the optional host
  permission.
- [src/js/app/view-toggle.ts](../../src/js/app/view-toggle.ts): capture before opening, through the
  background's `Tabs` port ([src/js/ports/tabs.ts](../../src/js/ports/tabs.ts) and its browser and
  memory adapters), which gains `captureActive`, and `ViewState` to save the picture.
- [src/js/ports/view-tabs.ts](../../src/js/ports/view-tabs.ts),
  [src/js/adapters/browser/view-tabs.ts](../../src/js/adapters/browser/view-tabs.ts),
  [src/js/adapters/memory/view-tabs.ts](../../src/js/adapters/memory/view-tabs.ts): a failed
  `capture` gives `undefined`.
- [src/js/view/controller.ts](../../src/js/view/controller.ts): which tabs are captured (decision 3).
- [src/js/view/thumbnail-image.ts](../../src/js/view/thumbnail-image.ts): size and quality.
- [src/js/view/tab-nodes.ts](../../src/js/view/tab-nodes.ts), [src/css/tab.css](../../src/css/tab.css),
  [src/css/dark.css](../../src/css/dark.css): the placeholder and corner favicon suppression.
- [src/js/adapters/browser/view-state.ts](../../src/js/adapters/browser/view-state.ts) and the
  background tab-removal handling: dedicated storage key (`tgv_thumbnails` or `storage.session`) for
  Chromium thumbnails without touching `sessions-emulation.ts`.
- Options page and `src/_locales/*/messages.json` (76 folders): only with option B.
- [docs/spec.md](../../docs/spec.md): lines 25 and 60.

## Implementation steps

1. Phase 1: lab and Chromium tests for Q1-Q3 and Q5-Q7; read and cite the source for Q4.
2. Update this plan with the answers, and get the owner's decision 2.
3. Adapters: `ViewTabs.capture` and a new `Tabs.captureActive` give `undefined` on failure. Neither port
   has a contract suite in `tests/support/` yet, so one is added for each (the containers plan also
   adds one for `Tabs`; whichever lands second extends it).
4. Background: capture before the view opens (decision 1), with the timeout.
5. Controller: decision 3.
6. Placeholder: decision 4, with unit tests for `.empty` and an E2E test of a tab with no picture.
7. Chromium storage: decision 5 (isolated thumbnail key in `view-state.ts` and cleanup on tab removal).
8. Option B only: the manifest key, the options button, the strings.
9. `docs/spec.md`.

## Testing strategy

- Unit and contract tests for every step, at the coverage and mutation thresholds of
  [verification-validation-rules.md](../../.agents/rules/verification-validation-rules.md).
- Chromium E2E against the real extension: the placeholder; a capture saved and drawn, by the
  route Q7 finds.
- Firefox lab: Q1, Q2 and Q6. The lab cannot open or click the real extension's pages
  ([firefox-real-extension-e2e.md](firefox-real-extension-e2e.md) Phase 4), so a Firefox test that
  the view draws a captured picture waits on that spike. The report says so.

## Risks

| Risk                                                                                 | Mitigation                                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Opening the view gets slower                                                         | Timeout on the capture (decision 1), measured in Q3                               |
| `activeTab` is not granted by the route the user takes, or Firefox is 125 or earlier | Q1; the placeholder shows instead                                                 |
| A blank picture is saved and hides the placeholder                                   | Decision 3, from Q2                                                               |
| `__mock_sessions` contention or LevelDB serialization bloat                          | Decision 5 isolates thumbnails under a separate storage key                       |
| `request` loses the user action                                                      | Unit test that `permissions.request` is the click handler's first call (option B) |

## Success criteria

- [ ] In Chromium, opening the view from the toolbar button shows a picture of the tab that was open.
      E2E cannot click the button (Q7), so the report says which part was proved by a test and which
      was checked by hand.
- [ ] In Firefox, the same, shown by the lab for the capture and, once the spike succeeds, by E2E.
- [ ] Every tab without a picture shows the placeholder, in light and dark themes.
- [ ] Opening the view logs no capture errors for `about:`, extension or other tabs that cannot be
      captured.
- [ ] No install warning is added (Q4).
- [ ] A closed tab's thumbnail is removed in Chromium.
- [ ] The quality gates of [verification-validation-rules.md](../../.agents/rules/verification-validation-rules.md)
      pass.
