# Implementation Plan: Firefox Containers in Backups

> **Status: not started.** Split out of `docs/plans/data-structures-review.md` (decision 4, 2026-11-02), which keeps
> containers working but accepts that a backup restores every tab in the default container. This plan removes that
> limitation. Phase 1 is a test of the browser; what it finds may change the later phases, and the plan is updated
> before they start.

## Overview

A Firefox container (`contextualIdentities`, shown as "Personal", "Work", "Banking"... and used by add-ons such as Multi-Account
Containers and Facebook Container) keeps its own cookies, so a site signed in to in one container does not see the others. A
person who puts a tab in a container has chosen that isolation.

Today a backup loses it. `snapshotOf` in `src/js/app/backup-service.ts` keeps a tab's address, title, group, place, time and
pin, but not its container, and `openTab` creates every tab with `tabs.create({ url, ... })`, so it opens in the default
container. A banking tab comes back sharing the default container's cookies. That is a privacy limitation, not only a missing
feature, and is why this plan exists.

The naive fix makes it worse. A tab's container is `tab.cookieStoreId`, an id such as `firefox-container-3` that means
"whatever the third container of **this profile** is". A backup restored in another profile, on another machine, or after
containers were removed and made again, would put the banking tab into someone else's Shopping container. So a backup must
record **what each container is** (its name, colour and icon), and restoring must **find the matching container** in the
profile it is restored in, and ask when there is none.

Chromium has no containers. Everything here is Firefox only, and Chromium's backups and restores do not change.

## What is there today

- **Saving** (`backup-service.ts`, `save`): every window, each as `{ groups, tabs, activeGroup, groupIndex, position }`, in a file
  `{ file: { type: 'tgvView', version: 1 }, windows }`. Tabs come from `Tabs.snapshotsInWindow` (`src/js/ports/tabs.ts`,
  `TabSnapshot`), which has no container.
- **Reading** (`src/js/core/backup.ts`, `parseBackup`): version 1 of this add-on's format, and the formats of the old "Tab Groups"
  add-on and Firefox's `sessionrestore`. Each tab is parsed by `parseTab`; what is not understood is left out.
- **Restoring** (`backup-controls.ts`, `openFile`, from the file input on the options page, `src/js/options/page.ts`): the file is
  read (`await file.text()`), parsed, and opened by `backup-service.ts`, `open`, each window in a new window.
- **Permissions** (`src/manifest.json`): `tabs`, `tabGroups`, `tabHide`, `storage`, `sessions`, `downloads`, `contextMenus`,
  `notifications`; `optional_permissions` is empty; no host permissions; no `incognito` key, so the add-on runs in private windows
  only if the person allowed it.
- **Groups and containers:** a group does not own a container; `Group.containerId` is a leftover that the data-structures plan
  removes. This plan is about **tabs'** containers. A group may hold tabs of several containers, as it does today.

## Requirements

- A backup saved in Firefox records each tab's container and, once for the file, what each container is.
- Restoring opens a tab in the container that matches the one it was saved in, in the profile it is restored in. A tab is
  never put in a container that was matched on its id alone.
- When a container has no match, the person chooses what happens; nothing is guessed.
- Nobody who never uses containers sees a new permission prompt, at install, at update, or when saving or restoring a backup
  that has no container tabs.
- A tab of a private window is never reopened in a private window without the person saying so, and never in a normal
  window either (decision 3).
- Backups of version 1, of the old "Tab Groups" add-on and of `sessionrestore` still open as they do now; a backup of the new
  version opens in a copy of the add-on that predates it no worse than today (the extra fields are ignored).
- Chromium saves and restores as it does now.

## Decisions (recorded)

- **Containers are matched by what they are, not by their id** (data-structures plan, decision 4).
- **Any new permission is optional**, asked for only when it is needed (data-structures plan, decision 4;
  `.agents/rules/verification-validation-rules.md`, permissions must be the least that works).

## Decisions Needed

1. **When no container matches.** Options: (A) ask once per unmatched container: make it, use the default container, or leave
   its tabs out; (B) always make it; (C) always use the default container and say so afterwards. **Recommended: A**, with "make
   it" as the first choice. B and C each decide something about the person's isolation without them.
2. **What counts as a match.** Options: (A) the same name; (B) the same name, colour and icon; (C) A, and when two containers of
   the profile have that name, ask. **Recommended: C.** Names are what a person recognises; colours and icons are often left as
   they came. The id is never part of the match.
3. **Private windows** (`cookieStoreId` `firefox-private`). Options: (A) leave the tabs of private windows out of a backup, as
   private browsing is meant to leave nothing behind; (B) save them and reopen them in a private window only when the person
   ticks a box at restore. **Recommended: A.** It is also what a person expects of private browsing; B can come later.
4. **Containers in the old formats.** Firefox's `sessionrestore` records `userContextId` per tab, which is a container id with
   no name. Options: (A) ignore it, as today; (B) treat each as a container with no description, which can only be unmatched
   (decision 1). **Recommended: A** for this plan; B is small once the rest exists, and is listed as a follow-up.

## Questions for Phase 1 (to be answered by tests in real Firefox, not assumed)

These decide the permissions and so the shape of Phases 3 and 4. What is written below them is the plan if the answers are
the expected ones; the plan is updated with what Phase 1 finds.

- Q1. Is `tab.cookieStoreId` given to an add-on with `tabs` only, or does it need `cookies`?
- Q2. What does `tabs.create({ cookieStoreId })` require: `cookies`, `contextualIdentities`, or either?
- Q3. Does `contextualIdentities.query()` need the `contextualIdentities` permission, and **can that permission be optional** in
  the Firefox versions the add-on supports? If it cannot, decision 5 below is needed.
- Q4. Which of these permissions give an install or request warning, and what does it say? From Mozilla's list of permission
  warnings, checked for the supported versions, and recorded here with the link.
- Q5. What does `tabs.create` do with a `cookieStoreId` that does not exist, and with one of a container that was removed?
- Q6. Can the Firefox lab (`tests/e2e/lab/`) start a profile with containers turned on (`privacy.userContext.enabled`) and some
  containers made, so the later E2E tests can run there?

Decision 5, only if Q3 says `contextualIdentities` cannot be optional: (A) make it required, if Q4 shows it gives no warning;
(B) save and restore without the description (ids only) and treat every container as unmatched; (C) stop and rethink.
**Recommended: A if no warning, otherwise C.**

## Affected Files

- `tests/e2e/lab/`, a new lab spec: Phase 1 and the E2E tests of Phase 5.
- `src/js/core/backup.ts`, `tests/unit/core/backup.test.ts`, `tests/unit/properties/parsers.property.test.ts`: version 2 of the
  format, its parser, the reading of version 1.
- `src/js/ports/tabs.ts`, `src/js/adapters/browser/tabs.ts` and the memory adapter: the container of a tab snapshot, and creating a
  tab in a container.
- New port and adapters, `src/js/ports/containers.ts`: list the containers, make one. Browser adapter over `contextualIdentities`,
  memory adapter for the unit tests, and a contract suite in `tests/support/` run against both, like the other ports.
- New port and adapters, `src/js/ports/permissions.ts`: whether an optional permission is granted, and asking for it.
- `src/js/core/containers.ts` (new): matching the containers of a backup with those of the profile, pure.
- `src/js/app/backup-service.ts`, `src/js/app/backup-controls.ts`: saving the containers, and restoring in two steps.
- `src/options.html`, `src/js/options/backup.ts`, `src/js/options/page.ts`, `src/js/options/translations.ts`: the choices at
  restore.
- `src/manifest.json`: `optional_permissions`.
- `src/_locales/*/messages.json` (76 folders), `tests/unit/locale-copies.json`: the new messages.
- `docs/spec.md`: the backup format.

## Implementation Steps

### Phase 1: Ask Firefox (no product change)

1. **A lab test of containers** (`tests/e2e/lab/`, a new spec)
   - Action: in real Firefox, with a probe extension given each combination of `tabs`, `cookies` and `contextualIdentities`,
     answer Q1, Q2, Q3, Q5 and Q6, each as an assertion. The test states what it found, so a later Firefox that behaves
     differently fails it.
   - Why: the permissions decide what the person is asked and when. They are not settled by reading documentation.
   - Dependencies: the lab of `docs/plans/firefox-real-extension-e2e.md`
   - Risk: Medium (if Q6 is no, the later E2E tests cannot run in the lab, and this plan says what replaces them)
2. **Q4 recorded**, with Mozilla's list, and **this plan updated** with the answers: the permissions, decision 5 if it is
   needed, and any change to Phases 3 and 4. Then the owner takes the decisions above.

### Phase 2: The format (pure, no browser)

3. **Version 2 of the backup** (`src/js/core/backup.ts`)
   - Action: `file.version` 2. Each tab may have a `container` (a key into the file's containers). The file has
     `containers: { [key]: { name, color, icon } }`, where `key` is local to the file (the `cookieStoreId` it was saved with is
     kept only as that key, and never used to open a tab). `parseBackup` reads versions 1 and 2 and the old formats; a version
     1 file reads as having no containers. A container that is not well formed is left out, and its tabs read as in the default
     container: the same rule as the rest of the parser. `save` writes version 2.
   - Why: the description of a container is what lets it be found in another profile.
   - Dependencies: None
   - Risk: Low
4. **Matching** (`src/js/core/containers.ts`)
   - Action: given the containers of a backup and those of the profile, give for each backup container: `matched(id)`,
     `ambiguous(ids)` or `unmatched`, by decision 2. Property tests: a container is matched only to one with its name, never by
     id; the result does not depend on the order of either list.
   - Why: the part that protects isolation is pure, so it can be tested completely.
   - Dependencies: Requires step 3
   - Risk: Low

### Phase 3: The ports (the permissions are as Phase 1 found)

5. **Tabs** (`src/js/ports/tabs.ts`, adapters)
   - Action: `TabSnapshot` has `container: string | undefined`, the `cookieStoreId` or nothing (Chromium, the default
     container). `create` takes an optional `container`. Both through the contract suite.
   - Dependencies: Phase 1
   - Risk: Low
6. **Containers** (`src/js/ports/containers.ts`, adapters, contract suite)
   - Action: `list(): Promise<Container[]>` (id, name, colour, icon) and `make({ name, color, icon }): Promise<string>`. When
     the permission is not granted, or the browser has no containers (Chromium, or containers turned off), `list` gives `[]`
     and the caller knows why: `available(): Promise<'yes' | 'no-permission' | 'not-supported'>`.
   - Dependencies: Phase 1
   - Risk: Low
7. **Permissions** (`src/js/ports/permissions.ts`, adapters)
   - Action: `has(names)` and `request(names)`. The adapter's `request` is only ever called from a click handler: the port's
     doc comment says so, and the options page is the only caller.
   - Why: `permissions.request()` is refused outside a user action. Restoring reads the file with `await file.text()` first,
     so by the time a backup is known to have containers, the action that chose the file is over.
   - Dependencies: Phase 1
   - Risk: Low

### Phase 4: Saving and restoring

8. **Saving** (`backup-service.ts`, `save`; `src/js/options/page.ts`)
   - Action: tabs are saved with their container. The descriptions come from the containers port. If the permission to read
     them is not granted, the "Save backup" click asks for it, but only if a tab of an open window is in a container other
     than the default (otherwise nothing is asked). If the person declines, the backup is saved with the containers'
     keys and no descriptions, and they are told that those tabs will restore as unmatched. Tabs of private windows are left
     out (decision 3).
   - Why: the click on "Save backup" is a user action, so it may ask.
   - Dependencies: Requires steps 3, 5, 6, 7
   - Risk: Medium
9. **Restoring in two steps** (`backup-controls.ts`, `backup-service.ts`, `src/options.html`, `src/js/options/backup.ts`)
   - Action: choosing a file only reads and parses it. If it has no container tabs, or the browser has no containers
     (Chromium: every tab opens in the default container, as now, and they are told so once), it opens as today. Otherwise
     the options page shows what it found: each container of the backup, with its match or "no match" and, for unmatched and
     ambiguous ones, the choices of decisions 1 and 2. A "Restore" button, a user action, asks for the permissions if they
     are missing, makes the containers chosen to be made, and opens the backup with each tab in its container. Declining the
     permission restores in the default container after saying so; it does not restore silently.
   - Why: the question about containers can only be asked once the file is read, and the permission only from a click; a
     second click is what makes both possible.
   - Dependencies: Requires steps 4 to 8
   - Risk: Medium (the options page has no step like this yet; it must be usable with the keyboard and a screen reader, as
     the rest of the page is)
10. **When a container cannot be used at restore** (`backup-service.ts`)
    - Action: what Q5 found decides it. If `tabs.create` with a container fails, the tab is **not** opened in the default
      container behind the person's back: it is left out, and they are told which tabs were left out and why.
    - Why: opening it in the default container is the limitation this plan removes.
    - Dependencies: Requires step 9
    - Risk: Low

### Phase 5: The strings, and proof in real Firefox

11. **The messages** (`src/_locales/en/messages.json`, then the 75 translations, `tests/unit/locale-copies.json`)
    - Action: English first, then each language as in `docs/plans/languages.md` and Phase 3 of
      `docs/plans/message-sender-validation.md` (one at a time, the language's own words for "group", "tab" and "container"
      kept the same as Firefox's for that language where they are known, the add-on's name untranslated, a draft no speaker
      has read). About seven messages (the heading of the step, the three choices, ambiguous, the warning when declining, the
      report of tabs left out), so about 530 new strings; the gap allowances stay at 0.
    - Dependencies: Requires step 9 (the texts are final when the page is)
    - Risk: Medium
12. **E2E in the Firefox lab** (`tests/e2e/lab/`)
    - Action: against the real extension in real Firefox with containers: a backup saved and restored in the same profile puts
      each tab in its container; restored in a profile whose containers have other ids, each tab goes to the container of the
      same name, not the same id; an unmatched container gives the choices, and each choice does what it says; declining the
      permission restores in the default container and says so. A Chromium E2E test that a backup with containers restores
      as today. If Q6 found the lab cannot have containers, this step says so in the report and the gap is written here.
    - Why: containers exist only in Firefox, so a Firefox page test with the stand-in `browser` cannot prove any of it
      (`AGENTS.md`, Coding Workflow 3).
    - Dependencies: Requires steps 8 to 11
    - Risk: Medium
13. **`docs/spec.md`**: the backup format, version 2.

## WebExtension API Notes

- `tab.cookieStoreId`: `firefox-default`, `firefox-private`, or `firefox-container-N`. N is per profile. What permission reading
  it needs is Q1.
- `tabs.create({ cookieStoreId })`: what it needs, and what it does with an id that does not exist, are Q2 and Q5.
- `contextualIdentities.query({})` and `.create({ name, color, icon })`: need the `contextualIdentities` permission, and fail
  when containers are turned off; whether the permission can be optional is Q3.
- `permissions.request()`: only from a user action, and an `await` before it can end the action. It is called first in the click
  handler, before anything else is awaited.
- Chromium: none of these exist; the adapters report `not-supported`.

## Testing Strategy

- Unit: the parser of both versions and the old formats, the matching (with properties), the service with the memory adapters,
  the controls' two steps, the options page's choices. Coverage 100% and Stryker at its break of 100 on the touched files.
- Contract suites for the new ports, run against the browser adapters (with a fake `browser`) and the memory ones.
- E2E: step 12, against the real extension. The report says which tests ran in the Firefox lab and which only against the
  Firefox stand-in.

## Risks & Mitigations

- **A tab opened in the wrong container.** Mitigation: matching never uses the id; a failure leaves the tab out instead of
  opening it elsewhere; the property tests and the lab test of two profiles.
- **A permission prompt that surprises people.** Mitigation: asked only when a container tab is being saved or restored, from a
  click, with the page saying why first.
- **`contextualIdentities` cannot be optional.** Mitigation: Q3 is answered before any product change, and decision 5 is taken
  then.
- **Containers that another add-on manages** (Multi-Account Containers may also make or sync containers). Mitigation: this
  add-on only makes a container when the person chose it; Phase 1 notes anything odd seen with it installed, as a follow-up.
- **530 new strings.** Mitigation: the process of the earlier languages, and the locale tests.

## Follow-ups (not in this plan)

- The containers of `sessionrestore` backups (decision 4, B).
- Private windows in backups (decision 3, B).
- A group that opens its new tabs in a container, which is a feature, not a restore.

## Success Criteria

- [ ] Q1 to Q6 are answered by a test in real Firefox and recorded here, and the decisions are taken
- [ ] A backup restored in the profile it was saved in puts every tab in its container (Firefox lab)
- [ ] A backup restored in a profile whose containers have other ids puts every tab in the container of the same name, never
      the same id (Firefox lab)
- [ ] An unmatched container is never decided without the person; a tab that cannot go to its container is left out and
      reported, not opened in the default container
- [ ] Nobody without container tabs is asked for a permission; `permissions` in the manifest is unchanged unless decision 5 says
      otherwise
- [ ] Version 1, "Tab Groups" and `sessionrestore` backups open as before; Chromium saves and restores as before
- [ ] All 76 locales have the new messages, with the gap allowances at 0
- [ ] The gates and the review loop of `.agents/rules/verification-validation-rules.md` converge
