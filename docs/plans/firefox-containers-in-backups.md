# Implementation Plan: Firefox Containers in Backups

> **Status: not started; decisions 1 to 3 taken by the owner on 2026-11-02** (decision 1 depends on Phase 1). Split out of `docs/plans/data-structures-review.md` (decision 4, 2026-11-02), which keeps
> containers working but accepts that a backup restores every tab in the default container. This plan removes that
> limitation. Phase 1 is a test of the browser; what it finds may change the later phases, and the plan is updated
> before they start.

## Overview

A Firefox container (`contextualIdentities`; a "Work" or a "Banking" container, for example) keeps its own cookies, so a site signed in
to in one container does not see the others. A person who puts a tab in a container has chosen that isolation.

Today a backup loses it. `snapshotOf` in `src/js/app/backup-service.ts` keeps a tab's address, title, group, place, time and
pin, but not its container, and `openTab` creates every tab with `tabs.create({ url, windowId, active, discarded, pinned })`,
so it opens in the default container. A banking tab comes back sharing the default container's cookies. That is a privacy
limitation, not only a missing feature, and is why this plan exists.

The naive fix makes it worse. A tab's container is `tab.cookieStoreId`, an id. If, as expected, each profile numbers its own
containers (Q1), a backup restored in another profile could put the banking tab into a container that is something else there. So a tab may only be restored into a
container that is **known to be the same one**. What makes it "the same" is decision 1, and it is bound up with the permissions
the add-on would need, which are the hard part of this plan.

Chromium has no containers. Everything here is Firefox only, and Chromium's backups and restores do not change, except
that a Firefox backup with container tabs, opened in Chromium, is followed by the list of decision 2.

## What is there today

- **Saving** (`backup-service.ts`, `save`): every window that `windows.getAll({})` lists, so the private windows too when the
  person has allowed the add-on in them; each as `{ groups, tabs, activeGroup, groupIndex, position }`, in a file
  `{ file: { type: 'tgvView', version: 1 }, windows }`. Tabs come from `Tabs.snapshotsInWindow` (`src/js/ports/tabs.ts`,
  `TabSnapshot`), which has no container. A tab of a private window is therefore saved, and is restored into a normal window.
- **Reading** (`src/js/core/backup.ts`, `parseBackup`): this add-on's format **only when `file.version === 1`** (any other
  version is "not a backup"), and the old "Tab Groups" add-on's format (`version: ['tabGroups' | 'sessionrestore', 1]`). Each
  tab is parsed by `parseTab`, which keeps only the fields it knows, so a field added to a tab is ignored by the parser of
  today.
- **Restoring** (`backup-controls.ts`, `openFile`): from the `change` event of the file input on the options page
  (`src/js/options/page.ts`); the file is read (`await file.text()`), parsed, and opened by `backup-service.ts`, `open`, each window
  in a new window. All of it runs in the options page.
- **Permissions** (`src/manifest.json`): `tabs`, `tabGroups`, `tabHide`, `storage`, `sessions`, `downloads`, `contextMenus`,
  `notifications`; `optional_permissions` is empty; no host permissions; no `incognito` key; no `strict_min_version`.
- **Ports with a shared contract suite** (`tests/support/*-contract.ts`): group state, options, scheduler, shortcuts. Tabs has a
  memory adapter (`src/js/adapters/memory/tabs.ts`) but no contract suite.
- **Groups and containers:** a group does not own a container; `Group.containerId` is a leftover that the data-structures plan
  removes. This plan is about **tabs'** containers. A group may hold tabs of several containers, as it does today.

## What the documentation says (MDN, read 2026-11-02)

- `tabs.create`, `cookieStoreId`: "This option is only available if the extension has the `"cookies"` permission." What happens
  with an id that does not exist is not stated.
- `tabs.Tab`, `cookieStoreId`: listed with no permission note (other properties say "Only present if the extension has the
  `"tabs"` permission"). The values are not listed on that page. `incognito` says whether the tab is in a private window.
- `contextualIdentities`: "To use this API you need to include the "contextualIdentities" and "cookies" permissions". "From
  Firefox 57 onwards, if an extension that uses the `contextualIdentities` API is installed, then the contextual identities
  feature will be enabled automatically." If the person turns it off (`privacy.userContext.enabled`), its "method calls will
  reject their promises".
- `ContextualIdentity.name`: "names don't have to be unique". Colours were renamed in Firefox 153 (`turquoise` to `cyan`,
  `toolbar` to `gray`; the old names are still accepted), and `getSupportedColors()` and `getSupportedIcons()` are the lists from
  153 on.
- `optional_permissions`: `cookies` is in the list, and among those "granted silently, without a user prompt".
  **`contextualIdentities` is not in the list.**
- `permissions.request`: "The extension can only make the request inside the handler for a user action." User actions include
  "Clicking a button on a page bundled with the extension", and "if a user input handler waits on a promise, then its status as a
  user input handler is lost."

These are the documentation's claims; Phase 1 checks the ones the plan depends on in a real Firefox.

**Which permissions show a warning (Firefox's source, read 2026-11-02).** Firefox takes the text of each warning from
`toolkit/locales/en-US/toolkit/global/extensionPermissions.ftl`
(<https://raw.githubusercontent.com/mozilla-firefox/firefox/main/toolkit/locales/en-US/toolkit/global/extensionPermissions.ftl>),
one `webext-perms-description-<permission>` per permission that has one. **There is none for `cookies` or
`contextualIdentities`;** no line of the file mentions `contextualIdentities`, and the only one that mentions cookies is
`browsingData` ("Clear recent browsing history, cookies, and related data"). Of the add-on's own permissions, `tabs`, `tabHide`,
`sessions`, `downloads` and `notifications` have one, and `tabGroups`, `contextMenus` and `storage` do not. Extension Workshop's
"Request the right permissions" also lists `cookies` and `contextualIdentities` among those that are not shown to users, and
`contextualIdentities` among those that cannot be optional (read through a summary, not word for word). Mozilla's support
article "About permission request messages for Firefox extensions"
(<https://support.mozilla.org/en-US/kb/permission-request-messages-firefox-extensions>, last updated 2026-06-11, read in full
from a saved copy) agrees: none of the messages it lists is for cookies or containers, and the only one that names cookies is "Clear
recent browsing history, cookies and related data" (`browsingData`, which this add-on does not ask for). It also says: "If you
don't see a permission prompt, that means the extension does not require access to sensitive data or browser settings." Not
checked: the strings file's `PERMISSION_L10N_ID_OVERRIDES` map, which only renames messages. This answers Q4.

## Requirements

- A tab saved in a container is restored into the same container when that container is known to be the same one;
  otherwise it is restored with no container (as in Chromium), and the person is told which tabs came back without theirs.
- A tab is never put in a container that is not known to be the one it was saved in.
- The add-on does not change Firefox for people who do not use containers: it does not turn containers on, and it shows no new
  permission warning to them, at install, at update, or when saving or restoring. (Decision 1 A shows no warning, but turns
  containers on, so it cannot meet this; choosing it means dropping this requirement knowingly.)
- Backups of today, and of the old "Tab Groups" add-on, still open as they do now; a backup saved by the new code opens in a copy
  of the add-on from before it as it would today (in the default container), not as "not a backup".
- Chromium saves and restores as it does now, except that a backup made in Firefox with container tabs is followed by the
  same list of tabs that came back without their container (decision 2). A backup made in Chromium has no container tabs.

## Decisions (recorded)

- **Any new permission is the least that works** (`.agents/rules/verification-validation-rules.md`), and optional where it can
  be.
- **The format stays version 1, with optional fields added.** `parseBackup` rejects any other version, so a version 2 file
  would be "not a backup" to every copy of the add-on from before it; added fields are ignored by those copies (`parseTab`
  keeps the fields it knows). The version is raised only for a change the old parser would misread.

## Decisions (taken on 2026-11-02)

1. **How a container is known to be the same one.** This decides the permissions.
   - **(A) By its name, in any profile.** The backup records each container's name (and colour and icon, to make it again);
     restoring finds the container of that name. Needs `contextualIdentities` and `cookies`, and `contextualIdentities` cannot be
     optional, so both become required: **every Firefox user of the add-on gets containers turned on** at install or update
     (MDN, above), though without a permission warning (Firefox's source, above). Restores across profiles and machines.
   - **(B) By its id, in the same profile only.** The add-on keeps a random marker of the profile in `storage.local` (each
     profile has its own) and writes it into the backup. Restoring in the profile with the same marker opens each tab in the
     container of its id; in any other profile, container tabs are never put in a container (decision 2). Needs only
     `cookies`, optional and granted silently (MDN). Safe only if **Firefox never gives a removed container's id to a new
     one in the same profile** (Q5): otherwise a container made after the old one was removed, whatever its name, would receive the tabs.
     Does not restore containers on another machine, and the marker is lost if the add-on is removed and installed again,
     or its storage is cleared. Such a backup is then treated as from another profile, which is safe. The add-on cannot
     tell an earlier install in this profile from another profile: both give a marker it does not have. So the list
     (decision 2) gives both reasons: the backup "comes from another profile, or from before the add-on was installed
     again". A backup with no marker at all (saved before this change) gets its own wording.
   - **(C) Not at all:** the limitation stays, and is written in the release notes.
   - **Decided by the owner on 2026-11-02: B**, provided Phase 1 confirms Q1, Q2 and Q5; if any of them goes the other way,
     the decision comes back to the owner before Phase 2. Why: it fixes the common case (a backup restored in the profile it
     came from) without changing Firefox for anyone, and most people who use the add-on are not expected to use containers;
     A would turn containers on for all of them to serve the few who do. Containers are to be supported properly for those
     who use them, so B is not a token fix: a tab that cannot go back to its container is never put in another one,
     and the person is told which tabs came back without theirs (decision 2). A remains possible later, as a plan of its own, if restoring on another machine is wanted.
2. **A container tab that cannot go to its container** (another profile under B; no match under A; a container that no longer
   exists). Options: (A) ask once for the backup: open those tabs in the default container, or leave them out; (B) always
   leave them out and list them; (C) always use the default container and say so. **Decided by the owner on 2026-11-02: C.**
   They are restored with no container, which is what happens in Chromium and what every restore does today, and the page
   then lists them by title and address (a container's key is an id that means nothing to a person), so the person can
   move each one to the container they want by hand. Nothing is asked and no tab is left out.
   - **Proposed on 2026-11-02, for the owner to confirm:** such a tab is also restored **unpinned and discarded**, in Firefox.
     `openTab` passes `discarded: !tab.pinned` (its comment: "A pinned tab is not allowed to be discarded"), so a pinned
     container tab would load at once, with the default container's cookies, before the person sees the list. MDN
     `tabs.create`: a discarded tab is made "without any content loaded into memory … The tab's content is loaded when the
     tab is activated." The list says that these tabs were unpinned. The comment in `openTab` is the only source here for
     pinned tabs not being discarded; Q2 checks it.
   - In Chromium this does not help. Chrome's `tabs.create` does not list `discarded` among its properties, so every tab a
     restore opens there may load at once, container tab or not. Whether Chromium ignores or rejects the property that
     `openTab` passes today is Q7.
3. **Private windows.** Today their tabs are saved, and restored into a normal window (above). Options: (A) leave private
   windows (`incognito` true), with their groups and tabs, out of a backup, a change from today; (B) keep today's behaviour. **Decided by the owner on 2026-11-02: A.**
   Today's behaviour is not what anyone would expect: private browsing is meant to leave nothing behind, a backup is a file
   on disk, and a private tab came back in a normal window. This is independent of containers and could be done first.

The containers that a backup of the old "Tab Groups" add-on may record are out of scope: what those files hold about containers
has not been looked at, and no test file in the repository has any.

## Questions for Phase 1 (answered by tests in real Firefox, not assumed)

- Q1. Is `tab.cookieStoreId` given to an add-on with `tabs` only (MDN gives no permission for it)? What are its values in the
  default container and in a private window? Do two profiles give the same id to different containers (two `startLab`s, each
  with its own containers)? Does `windows.getAll({})` list a private window only when the add-on is allowed in private
  windows, as "What is there today" assumes, and does each window say `incognito`?
- Q2. Does `tabs.create({ cookieStoreId })` work with `cookies` (MDN: it needs it)? Does `cookieStoreId` work together with
  `discarded: true`, which `openTab` passes for every tab that is not pinned? Is `tabs.create` with `pinned: true` and
  `discarded: true` refused, as `openTab`'s comment says (MDN `tabs.create` does not say)? Does a tab created discarded
  make no request until it is activated, and does pinning it with `tabs.update` load it? Is the grant of an optional `cookies` silent, and
  is the request accepted from a click handler that calls it before any `await`? The last two need a click on a page of the
  extension, which the lab cannot do yet (see "What cannot be proved in real Firefox yet", below).
- Q3. Under decision 1 A only: is `contextualIdentities` refused in `optional_permissions` (MDN does not list it), and does
  granting the API turn containers on? **Not asked:** decision 1 is B.
- Q4. Which of `cookies` and `contextualIdentities` give an install or update warning? **Answered from Firefox's source:
  neither** (above). That the grant at "Restore" shows no prompt is in Q2, and is part of the gap below.
- Q5. Does Firefox give the id of a removed container to a container made after it, in the same profile? A test can only
  show a few cases, so it shows the one a counter that takes "the highest id plus one" would get wrong: the container with the
  highest id is removed and a new one made. How Firefox gives out ids is also read in its source (the contextual identity
  service) and cited here. And what does `tabs.create` do with the id of a container that does not exist: does it reject, or
  open the tab in another container (step 9 has to work either way)?
- Q6. Can the Firefox lab make and remove containers? `tests/e2e/lab/lab.ts` sets `firefoxUserPrefs` (so
  `privacy.userContext.enabled` can be added) and gives the probe a fixed list of permissions (`PERMISSIONS`: `tabs`,
  `tabHide`, `tabGroups`, `sessions`, `storage`); `cookies` and `contextualIdentities` would be added to it. Whether that
  changes the lab's other tests (`contextualIdentities` turns containers on) is part of the question.
- Q7 (Chromium E2E). Chrome's `tabs.create` does not list `discarded`, which `openTab` passes. Does Chromium ignore it, or
  reject the call (in which case `openTab` logs and skips every tab, and restores in Chromium are broken today)? Step 11's
  first backup E2E answers it; if restores are broken, that is fixed first, as its own change.

## What cannot be proved in real Firefox yet

Saving and restoring run in the options page (`src/js/options/start.ts` builds the backup service there), and the restore's
second step is a click on that page. The lab drives probe extensions from their backgrounds; driving a page of the real
extension in real Firefox is the spike of `docs/plans/firefox-real-extension-e2e.md` (Phase 4), which has not been run and
"may not be achievable". Until it succeeds:

- the lab proves the **browser facts** the code relies on (Q1, Q2 without the click, Q5, Q6), from a probe;
- the code is proved by unit tests and the contract suites over the memory and browser adapters;
- the options page's flow is proved end to end in **Chromium** (the real extension), which covers the one-step restore and
  the list, but not containers, which Chromium does not have;
- **nothing proves end to end, in Firefox, that a restore puts tabs back in their containers, or that the click grants
  `cookies` silently.** The report of the work says so, as `AGENTS.md` (Coding Workflow 3) requires. If the spike succeeds,
  step 11's Firefox tests are written on it; if it fails, this gap is recorded here and the owner decides whether to ship
  with it.

## Affected Files (for decision 1 B; A adds a containers port and changes the manifest's `permissions`)

- `tests/e2e/lab/`, a new lab spec: Phase 1, and step 11's Firefox tests if the spike succeeds.
- `tests/e2e/`, a new Chromium spec: step 11.
- `src/js/core/backup.ts`, `tests/unit/core/backup.test.ts`, `tests/unit/properties/parsers.property.test.ts`: the optional fields.
- `src/js/ports/tabs.ts`, `src/js/adapters/browser/tabs.ts`, `src/js/adapters/memory/tabs.ts`: a snapshot's container, and
  creating a tab in a container and giving back the container it got.
- `src/js/ports/windows.ts` and its adapters: whether a window is private (`listIds` gives only ids today).
- `tests/e2e/lab/lab.ts`: `cookies` and `contextualIdentities` for the probe, and the containers pref.
- New: `src/js/ports/permissions.ts` with browser and memory adapters; `src/js/ports/profile-marker.ts` with adapters (the
  marker in `storage.local`, through an adapter, as `tgv/no-browser-storage` requires).
- `src/js/app/backup-service.ts`, `src/js/app/backup-controls.ts`: saving the containers and the marker, and restoring in one step or two.
- `src/options.html`, `src/js/options/backup.ts`, `src/js/options/page.ts`, `src/js/options/translations.ts`: the second
  step of a restore, and the list of tabs that came back without their container.
- `src/manifest.json`: `optional_permissions: ["cookies"]`.
- `src/_locales/*/messages.json`, `tests/unit/locale-copies.json`, `tests/unit/stored-data.test.ts` and `docs/spec.md` (a new
  key in `storage.local`, and the backup's new fields).

## Implementation Steps

### Phase 1: Ask Firefox (no product change)

1. **A lab test of containers** (`tests/e2e/lab/`, a new spec)
   - Action: in real Firefox, with containers on, answer Q1, Q2 (without the click), Q5 and Q6 as assertions from a
     probe, so a later Firefox that behaves otherwise fails the test; and read the source for Q5.
   - Why: the permissions and the safety of decision 1 B rest on these, and documentation is not proof.
   - Dependencies: None (the lab, `tests/e2e/lab/`, exists)
   - Risk: Medium (if Q6 is no, Q1, Q2 and Q5 cannot be answered in the lab, and decision 1 comes back to the owner)
2. **The plan updated** with the answers, and the decisions taken by the owner.

### Phase 2: The format and the marker (no browser)

3. **The optional fields** (`src/js/core/backup.ts`)
   - Action: a tab may have `container`, its `cookieStoreId` when not the default container; the file may have `profile`, the
     marker. Both are read with a guard and left out if not well formed. Version 1 files without them read as today. That a
     copy of the add-on from before this change ignores them is read from today's `parseTab`, `parseWindow` and
     `parseViewerBackup`, which copy only the fields they know; a property test keeps it true from here on: a backup with
     fields no reader knows reads as the same backup without them.
   - Dependencies: None
   - Risk: Low
4. **The profile marker** (`src/js/ports/profile-marker.ts`, adapters)
   - Action: `get(): Promise<string>`, made once with `crypto.randomUUID()` and kept in `storage.local`; added to the stored-keys
     table and its test.
   - Dependencies: None
   - Risk: Low

### Phase 3: The ports

5. **Tabs** (`src/js/ports/tabs.ts`, adapters)
   - Action: `TabSnapshot` gets `container: string | undefined` (nothing for the default container and in Chromium);
     `create` takes an optional `container` and gives back, with the id, the container the tab was created in, read from the
     tab the browser returns. The Windows port says which windows are private. Unit tests of the adapters; a contract suite
     for the parts touched, as there is none for tabs yet.
   - Dependencies: Phase 1
   - Risk: Low
6. **Permissions** (`src/js/ports/permissions.ts`, adapters)
   - Action: `has(names): Promise<boolean>` and `request(names): Promise<boolean>`. The doc comment of `request` says it must
     be the first thing a click handler calls, before any `await`; the options page is its only caller.
   - Dependencies: Phase 1
   - Risk: Low

### Phase 4: Saving and restoring

7. **Saving** (`backup-service.ts`, `save`)
   - Action: each tab with its container, and the file with the marker. Private windows are left out whole (decision 3).
     If that leaves no window (the add-on is allowed in private windows and only private windows are open; the options
     page is then in one of them), nothing is saved and the person is told, with a new message. `save` today would write
     a file with `windows: []`, and opening it would open nothing and say nothing.
     Nothing is asked, if Q1 shows that reading `cookieStoreId` needs no permission beyond `tabs` (MDN gives none for it).
   - Dependencies: Requires steps 3 to 5
   - Risk: Low
8. **Restoring in one step or two** (`backup-controls.ts`, `backup-service.ts`, `src/options.html`, `src/js/options/backup.ts`)
   - Action: choosing a file only reads and parses it (the `change` event of a file input is not on MDN's list of user actions,
     and the read is an `await`). Three cases:
     - A backup that has no container tabs, or that comes from another profile (another marker, or none), or that is
       opened in Chromium, opens at once with every tab in no container, as today.
     - A backup from this profile with container tabs, when `cookies` is already granted (the port's `has`, over
       `permissions.contains`, which needs no click), opens at once with each container tab **in its container**.
     - A backup from this profile with container tabs, when `cookies` is not granted, needs a second step: the page says how many tabs will go back to their containers, and a
       "Restore" button, whose handler first calls `permissions.request(['cookies'])`, opens it. If the permission is not
       granted, those tabs are restored with no container (decision 2). Whenever any tab came back without its container, the
       page then lists them (decision 2). A Firefox backup opened in Chromium always has another profile's marker (each browser
       has its own `storage.local`), so it takes the first path; the Chromium tabs adapter also never passes a container to
       `tabs.create`, as Chromium has none.
   - Choosing another file while the second step is shown starts again: `openFile` first drops the backup waiting for the
     click and hides the second step, then reads the new file. A unit test chooses a backup that needs the second step,
     then one that does not, and checks that the button is gone and that a click on the old one cannot open the first.
   - Why: the permission can only be asked for from a click, and the backup's containers are only known after the read.
   - Dependencies: Requires steps 3 to 7
   - Risk: Medium (a new kind of step on the options page; it must be usable with the keyboard and a screen reader. The
     repository has no accessibility checker, so step 11 drives the step by keyboard, and the a11y reviewer
     (`.agents/agents/a11y-architect.md`) reviews it)
9. **A container that cannot be used** (`backup-service.ts`)
   - Action: a tab counts as back in its container only if the tab the browser created is in it (step 5), not merely because
     `tabs.create` did not fail, since Q5 may find that Firefox opens the tab elsewhere instead of rejecting. So every
     container tab is first created discarded and unpinned, and its container checked before it can load. If it is in its
     container, a pinned one is then pinned with `tabs.update` (whether pinning loads a discarded tab is part of Q2). If it
     is in another container, it is closed; if `tabs.create` rejected, there is no tab. Either way it is created again with
     no container, unpinned and discarded (decision 2), and is in the list of tabs that came back without theirs.
   - Dependencies: Requires step 8
   - Risk: Low

### Phase 5: The strings, and proof in real Firefox

10. **The messages** (`src/_locales/en/messages.json`, then the 75 translations, `tests/unit/locale-copies.json`)
    - Action: as in `docs/plans/languages.md` and Phase 3 of `docs/plans/message-sender-validation.md`. The number of messages is
      known when step 8's page is designed; at about six (the second step's text, its button, the
      heading of the list, its explanation for a backup with another marker and for one with none, and step 7's "nothing to
      save") it is about 450 translated strings. The gap allowances stay at 0.
    - Dependencies: Requires step 8
    - Risk: Medium
11. **E2E against the real extension** (Chromium now; the Firefox lab if the spike succeeds)
    - Action, Chromium (the real extension, `tests/e2e/`; no E2E test opens a backup today, so this is the first, choosing
      the file with Playwright's `setInputFiles` on `#backupFileInput`): a backup file with container tabs and another profile's marker opens
      at once, every tab with no container, followed by the list of them by title and address; a backup without container
      tabs opens as today with no list; the list can be read and dismissed by keyboard.
    - Action, Firefox, only once the spike of `docs/plans/firefox-real-extension-e2e.md` has succeeded: a backup saved and
      restored in the same profile puts each tab in its container (one step if `cookies` is granted, two if not); restored in
      another profile (a second `startLab`, which makes a profile of its own in a new temporary folder), the container tabs
      open with no container and are listed; a container removed before the restore gives the same result for its tabs; a
      private window is not in the file (decision 3 A). Until then, the gap is reported as "What cannot be proved in real
      Firefox yet" says.
    - Why: containers exist only in Firefox, so a Firefox page test with the stand-in `browser` cannot prove any of it
      (`AGENTS.md`, Coding Workflow 3).
    - Dependencies: Requires steps 7 to 10
    - Risk: Medium
12. **`docs/spec.md`**: the backup's new fields and the marker.

## Testing Strategy

- Unit: the parser with and without the new fields, and with fields no reader knows (step 3); the service with the memory
  adapters; the controls' one and two steps; the list of tabs that came back without their container. Coverage 100% and Stryker at its break of 100 on the touched
  files.
- E2E: step 11, against the real extension; the report says which tests ran in the Firefox lab and which only against the
  Firefox stand-in.

## Risks & Mitigations

- **A tab opened in a container that is not its own.** Mitigation: under B, ids are used only in the same profile, and only if
  Q5 shows ids are not given again; a tab that cannot go to its container gets no container, never another one.
- **A person does not notice that a tab lost its container**, and goes on using it with the default container's cookies.
  Mitigation: the list after the restore names every such tab; nothing loses its container without appearing there.
- **Changing Firefox for people who do not use containers** (decision 1 A turns containers on). Mitigation: B was chosen,
  and it adds only an optional permission that Firefox grants silently.
- **A permission request that fails silently** (called after an `await`). Mitigation: the port's doc comment, the single caller,
  and a unit test that calls the click handler and checks, before awaiting anything, that `request` has already been called.
  No E2E test can reach this click yet: Chromium never needs the second step, and Firefox pages wait on the spike.
- **Restoring on another machine is not covered by B.** Mitigation: said on the page when it happens; A is the follow-up.
- **About 450 new strings.** Mitigation: the process of the earlier languages, and the locale tests.

## Follow-ups (not in this plan)

- Decision 1 A, restoring containers across profiles by name, if B is chosen and that is wanted.
- What the old "Tab Groups" add-on's backups record about containers.
- A group that opens its new tabs in a container, which is a feature, not a restore.

## Success Criteria

- [ ] Q1, Q2, Q5, Q6 and Q7 are answered by a test in real Firefox or a cited source, recorded here, and the decisions are taken
- [ ] A backup restored in the profile it was saved in puts every tab in its container (unit and contract tests; the Firefox
      lab if the spike succeeds, otherwise the gap is recorded and the owner has decided)
- [ ] No tab goes into a container that is not known to be its own; every tab that comes back without its container is
      listed (unit tests; Chromium E2E for the list)
- [ ] Nobody without container tabs is asked for anything, and the manifest's `permissions` are unchanged (decision 1 B)
- [ ] Today's backups and the old add-on's open as before; a new backup opens in today's add-on; Chromium saves and restores as
      before, except for the list after a Firefox backup with container tabs
- [ ] All 76 locales have the new messages, with the gap allowances at 0
- [ ] The gates and the review loop of `.agents/rules/verification-validation-rules.md` converge
