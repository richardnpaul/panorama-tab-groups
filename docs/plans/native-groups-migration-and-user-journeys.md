# Implementation Plan: Native Tab Groups and Existing Groups: Behaviour, User Journeys and Integration Tests

> **Status: Phases 1, 2 and 3 are done** on the branch `fix/native-groups-migration-user-journeys`, except what is marked as the
> owner's to decide (Decision 3); the owner's answers on the five open questions are in "Decisions taken after the first
> pass" at the end. Written after a manual test in Firefox. **The cause below was
> reproduced in a real Firefox, and was not what the plan guessed: it was worse** (see "Result").

## Overview

Observed by the owner, installing this version in Firefox next to the old add-on:

1. Native tab groups were **switched on** from the first run, although tab groups of the older kind were already in
   place. The owner expected them to stay off in that case (this only matters in Firefox; Chromium has no legacy mode).
2. After the switch, **one native tab group held the tabs of all the legacy groups**. The owner expected one native
   group per legacy group, each holding that group's tabs.

"Legacy" below means the groups the extension keeps itself (hiding the tabs of inactive groups with `tabs.hide`), as
opposed to the browser's own native tab groups. `docs/spec.md` names the modes Hybrid, Collapse-only and Legacy.

The cause of both is probably the same few design facts, but the extension has no tests at the level where such a story
can be written down, which is the larger problem: every user journey around native groups (first run, update, switch on,
switch off, restart, restore) lives only in the code and in someone's head. This plan finds the behaviour wanted,
writes it as tests, and fixes the code to match.

## What the code does today (read from the source; not yet run with the old add-on)

- **The default is "on" whenever the browser can.** `createDefaultOptions` sets `useNativeGroups` to whether the
  browser has the tab groups API (`core/options.ts`), and `createUseNativeGroups` is `hasTabGroups && option`. Nothing
  looks at whether groups already exist.
- **The migration gives a native group to the active group only.** `migrateWindow` (`app/native-groups-sync.ts`) creates
  a native group for the group that is active in the window and leaves the others, with the comment "the others get
  theirs when they become active". So even a correct switch-over does not produce one native group per legacy group
  at once; the owner's expectation is a change of design, not a bug fix.
- **Groups are per window and per extension.** The groups, the active group, and each tab's group are session values
  (`browser.sessions` in Firefox), and those are kept **per extension**. A different add-on (the old one, with another
  id) cannot be read, so when this extension starts with the old add-on's tabs open, those tabs have no recorded group.
- **Tabs with no group fall into one group.** On start-up the recovery gives a tab with no stored group the "ungrouped"
  group (-2), `salvageGrouplessTabs` puts tabs with no group into the window's active group, and a window with no
  groups gets one new group (`window-groups.ts`). A window that has never had groups therefore gets one group with all
  its tabs. With native groups on, the migration then makes one native group for it (the safety rule only refuses to
  group the _only_ tab of a window).
- **The most likely explanation of what was seen:** the old add-on's groups were invisible, so every tab was put in
  one new group, and that group became one native group. **This needs to be reproduced** (Phase 1); it may also be
  that the old groups were this extension's own from an earlier version, which would be a different path.
- Native group ids and window ids do not survive a browser restart, so `nativeGroupId` in the stored groups goes stale
  and is cleaned up lazily (`withoutStaleReference`); that path has to be part of the journeys below.
- **A way in for old data.** The backup format was `file.type: "panoramaView"`, the export format of the original
  add-on (if the owner's old add-on is the Panorama View family; **to be checked**). It is now written as `tgvView`, and
  `parseBackup` reads both, so exports of the old add-ons and of earlier versions of this one still import. Whether the
  old add-on's export otherwise loads, and whether the first-run page could offer "import your old groups", are to be
  checked (Phase 1) and decided (Decision 4).

## Requirements

- The behaviour for each user journey below is written down, agreed, and checked by a test that fails when it breaks.
- A fresh start never produces a surprise: with groups or tabs already in place the extension does not change how the
  tabs look until the user chooses to.
- Switching to native groups produces one native group per group, titled and coloured like it, holding that group's
  tabs, in every window; switching back leaves the legacy groups as they were.
- None of this loses tabs or closes a window.

## Decisions for the owner

**What was taken for the work that is done** (each can be changed; the open ones are marked):

- **Decision 1, what counts as "groups in place" at first run: all three.** Native groups are decided once, at the first run, and
  the decision is stored (`useNativeGroups` in `storage.sync`, which the add-on never wrote before). They are **off** when any
  window has groups stored by this add-on (an update, J3), or a window has more than one tab (windows of tabs with no groups
  known: J2, and next to another add-on, J4); **on** otherwise (J1). It is decided only where tabs can also be hidden (Firefox
  139 and later): Chromium always has native groups and Firefox before 139 cannot. A choice already made is never changed.
- **Decision 2, a fresh profile: on, as today.**
- **Decision 3, a native group for every group at once: not done, and the owner's.** Real Firefox lets hidden tabs be in a native
  group and the group be collapsed (`firefox-facts.spec.ts`), so it is possible; what it looks like to a person, where the tabs
  of a group are all hidden, could not be asked of the browser, and the code says that is why only the shown group has one
  ("the others have theirs hidden, which would clash"). `TESTING.md` has the look-and-see that decides it.
- **Decision 4, importing another add-on's groups: done, as a notice and the file import** (see "Decisions taken after the
  first pass"). The other add-on's groups cannot be read (each extension has its own session values), so the way in is its
  export file, which the options page imports (`core/backup.ts`).
- **Decision 5, reading the old backup type: done earlier.**

The questions, as they were asked:

1. **What counts as "legacy groups in place" at first run?** (a) Groups this extension stored earlier (an update of
   the same extension); (b) the old add-on's groups, which cannot be read, so only its tabs are seen; (c) any window with
   more than one tab at install. Recommended: (a) is checked by looking for stored groups; for (b) and (c) the native
   option stays **off** at first run on Firefox and the options page offers the switch, with a one-line explanation.
2. **Default for a fresh profile with no tabs of note** (one window, one new tab): native on or off? Recommended: on, as
   today, because there is nothing to migrate.
3. **Eager or lazy native groups.** Today only the active group has one. Eager (one per group at once) matches the
   expectation, but is only possible if the tabs of inactive groups, which the hybrid mode hides, can belong to a native
   group; **unverified** (Phase 1 experiment on Firefox 139+). If hidden tabs cannot be grouped, the honest answer is
   lazy creation, and the options page text should say so ("a native group appears when a group is opened").
4. **Importing the old add-on's groups.** Wanted in the first run? If the old export format loads, a guided import
   (a button on the migration status page) may be the real answer to "I had groups".
5. **Read the old backup type too?** Decided: yes. `parseBackup` reads `panoramaView` as well as `tgvView` and the result
   always says `tgvView`; only `tgvView` is written. The old name stays in the code only as the name of a file format
   that is read.

## The user journeys (the expected results are proposals for the owner to confirm or change)

| #   | Journey                                                             | Proposed result                                                                                        |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| J1  | First run, Firefox 139+, one window with a new tab                  | One group, native on                                                                                   |
| J2  | First run, Firefox 139+, windows with many tabs, no groups known    | One group per window with its tabs; native **off**; one notice offers to switch on                     |
| J3  | Update from an earlier version of this extension with groups stored | Groups kept; the native option keeps its earlier value (default off for existing users)                |
| J4  | First run next to the old add-on                                    | As J2; a notice leads to the options, which offer the switch and the import of the old add-on's export |
| J5  | Switch native on with three groups, tabs in each                    | A native group per group (or lazily; Decision 3), titled and coloured, each with its tabs; no tab lost |
| J6  | Switch native off                                                   | Tabs leave the native groups; legacy groups intact; the next switch-on migrates again                  |
| J7  | Several windows, native on                                          | Each window has its own native groups; no tab moves between windows                                    |
| J8  | Restart the browser with native groups                              | Old native ids go stale; groups are re-made or re-linked, not duplicated                               |
| J9  | Restore a closed window                                             | Its groups come back with their tabs and are not duplicated                                            |
| J10 | Close a native group by hand                                        | The legacy group stays; its reference is dropped                                                       |
| J11 | Drag a tab to another group with native on                          | The tab changes native group                                                                           |
| J12 | Delete a group with native on                                       | Its native group goes; tabs go to the other group as today                                             |
| J13 | Chromium (collapse-only)                                            | Native always on; collapse instead of hide; no migration prompt                                        |
| J14 | Firefox older than 139                                              | Legacy mode only; the option is disabled and says why                                                  |
| J15 | A window whose only tab is grouped                                  | Grouped like any other; the window stays (the safety rule was removed)                                 |

## Test strategy (three levels)

1. **A scenario "world" of memory fakes.** The ports already have memory adapters (`GroupState`, `Tabs`, `Windows`,
   `NativeGroups`, `Options`, ...). Add a small `FakeBrowser` that wires them to the same tabs and windows (a native group
   holds tabs of one window, hidden tabs, ids reassigned on restart), build the real services over it with the same
   code `composeBackground` uses (a `composeBackground` that takes ports instead of reading `browser` is the one
   refactor needed), and write each journey as a short test: given tabs and groups, run the event, assert the groups
   and the native groups. Fast (milliseconds), runs in `npm test`, covered and mutation tested.
2. **E2E on Chromium** where the native API exists (`tabGroups`): the journeys that apply (J5, J6, J7, J10 to J13) with
   real native groups, extending `group-switching.spec.ts`.
3. **Firefox**: check whether Playwright's Firefox build exposes `tabGroups` at all. If it does, the same journeys run
   there; if not, a **manual checklist** with a real Firefox 139+ profile that has old data (the owner's case), kept in
   `TESTING.md`, and the reproduction of this report is recorded there.

## Implementation Steps

Each step ends with `npm run typecheck`, `npm run lint`, the tests it touched and Prettier.

### Phase 1: Reproduce and find out (no code change in the product)

1. Reproduce the report with a real Firefox 139+ profile: install the old add-on, open windows with tabs, install this
   extension; record the groups it makes (`sessions` values via the debugger) and the log. Write down what is seen.
2. Experiment: can a hidden tab (`tabs.hide`) be put into a native group? Can a group with hidden tabs be collapsed?
   Decides Decision 3.
3. Check the old add-on's export against `parseBackup`.

### Phase 2: The scenario world, with today's behaviour pinned

4. Build the `FakeBrowser` and the refactor of `composeBackground` it needs. Write J1 to J15 as tests that describe the
   **current** behaviour first; the ones that disagree with the proposals are the bugs, marked as such, and fixed in
   Phase 3 (a failing test is better evidence than a paragraph).

### Phase 3: Behaviour

5. First run: do not turn native groups on over tabs and groups that are already there (Decision 1); the default stays
   on for an empty fresh profile. The decision is stored once, so it is not asked again.
6. Migration: one native group per group (or lazy creation, Decision 3), with the progress visible on the migration
   status page, and no change when run twice.
7. The notice on first run and the options text, in the messages files (see `more-languages.md`).
8. The guided import, if Decision 4 says so.

### Phase 4: The other levels

9. Chromium E2E for the journeys that apply; the manual Firefox checklist in `TESTING.md`.
10. Close-out: full `npm test`, a forced Stryker run, the E2E suite, the manual checklist done on Firefox with old data,
    a "Result" section here.

## Risks and Mitigations

- **A "fix" that loses a user's tabs or closes a window.** Mitigation: the safety rule stays and has its own journey
  (J15); no step moves tabs between windows; every migration test asserts the tab count before and after.
- **The fake world agrees with the code and not with Firefox.** Mitigation: Phase 1 experiments are recorded as facts
  the fake is built from, and the manual checklist is the check against the real browser.
- **Changing the default surprises people who liked it on.** Mitigation: it changes for first runs only; existing
  settings are kept; the options page explains.

## Success Criteria

- [x] The report is reproduced and its cause recorded in this plan (in a real Firefox: see "Result")
- [x] J1 to J15 each have a test and the agreed behaviour
- [x] First run over existing tabs or groups does not turn native groups on by itself
- [ ] Switching on gives a native group per group (or the lazy behaviour is the agreed, explained one) with no lost tab:
      the lazy behaviour is pinned and no tab is lost; **whether it is the wanted one is Decision 3, the owner's**
- [x] `npm test`, the forced Stryker run and the E2E suite pass; the checks a person has to make are in `TESTING.md`

## Skills, agents and rules for this work

From everything-claude-code (commit and checksums in `.agents/EXTERNAL-SOURCES.md`):

- `.agents/skills/hexagonal-architecture/SKILL.md`: ports and adapters, with fakes of the ports for the tests of the use cases.
  It is written for servers (HTTP, a database), so it was read as a reference; this project's own layout (`docs/plans`
  hexagonal plan, `core`, `ports`, `app`, `adapters`) is the one followed, and the world of fakes below is that skill's
  "test per boundary" taken as far as a whole journey.
- `.agents/agents/silent-failure-hunter.md`: what to look for in code that swallows a failure. It was applied to the
  native-group code, and what it points at is in "Found" below (the migration that reports success, the notification that
  cannot show).

## Result

Done on `fix/native-groups-migration-user-journeys`; nothing is committed.

### What was built

- **A lab for real Firefox** (`tests/e2e/lab`): a probe extension that does what a test asks with `browser.*` and answers over a
  local server, a launcher, and a way to load the real add-on with its `console` sent to the test. It is how the behaviour of
  Firefox was asked about, and how the report was reproduced. (`npm run test:e2e` now builds `dist-firefox` too.)
- **`tests/e2e/firefox-facts.spec.ts`: 13 facts about Firefox 157**, each a test: tab groups exist; a group id is a large
  number; a hidden tab can be in a group and stays hidden; a group with a hidden tab can be collapsed; the values of a session
  belong to the extension that set them; where `tabs.group` makes a group, with and without a window; a tab can join a group by
  its id only in the group's window; the only tab of a window can be grouped; a group goes when its last tab leaves or closes;
  a tab that moves to another window leaves its group; the tab in front cannot be hidden; ungrouping a tab that is in no group
  is harmless; a restored window comes back with new ids, its group with the same id and name, and the values kept.
- **A world of fakes** (`tests/support/world`): a model of the browser that follows those facts, ports on it, and the whole
  background of the add-on built by `composeBackgroundFrom(ports)` (the one refactor the plan named; `composeBackground()` is
  the same with the browser's ports). 38 tests of the model, one for each fact it follows.
- **J1 to J16** (`tests/unit/journeys/native-groups.test.ts`), 28 tests and 1 `todo` (Decision 3), in `npm test`.
- **A property test of any run of actions** (`tests/unit/journeys/random-actions.property.test.ts`, fast-check): tabs and windows
  opened, closed, moved, activated and restored, tabs sent to groups, groups deleted, native groups ungrouped or switched on and
  off, restarts, in any order, with the invariants of the data checked after each step and the add-on's own errors counted as
  failures. A failure comes with the actions in order. It runs 60 times in `npm test`; it was run 1,500 times with runs of 30 actions.

### Found

- **The report, reproduced, was worse than the plan thought.** What the plan guessed (the old add-on's groups are invisible, so the tabs go in one group) held, but it missed the
  worst of it: with **two or more windows**, the migration made `tabs.group` calls that did not say which window, and Firefox
  makes the group in **the window that has the focus and moves the tabs there**. In the lab, installing the add-on with a window
  of four tabs and a later one of three left **one window with seven tabs in one native group**; the first window was gone. The
  check "window mismatch" noticed it afterwards, when the tabs could no longer be put back. Fixed: `createFromTabs` takes the window
  and says so to the browser. It is tested in a real Firefox (the test fails without the fix) and by the argument.
- **The add-on made native groups with native groups switched off.** Start-up called the migration whenever the browser _had_
  native groups, not when the user _wanted_ them; and switching them off reset the flag that says the migration was done, so
  they came back at the next start. Fixed: start-up asks the setting (J2, J3, J6).
- **A tab sent to a group that has no native group stayed in the native group it was in**, hidden, though it belonged to
  another group. Fixed (J11).
- **After a restart the groups referred to native groups that had other ids, and nothing linked them again.** Certain in Chromium;
  in Firefox a restart could not be asked (Playwright's Firefox does not restore its session), and the model takes the harder
  case. New: `relink` at start-up links a group to the native group its tabs are in, or forgets the reference (J8).
- **Found by the property test:** visibility was applied to the window of the user, not the window of the tab that the event was
  about, so a tab moved or opened in a window that was not in front hid or showed tabs of the wrong window (fixed: the tab's
  window is passed through `tab-lifecycle`, `tab-moves` and `visibility-service`); and activating a tab that had been closed
  by then logged an error (fixed: it is tolerated).
- **Raised for the owner, and answered** (see "Decisions taken after the first pass"): sending the last tab of the shown
  group to another group; `migrate` answering success when every group failed; the notification that could not show; the
  safety rule about the only tab of a window; the first-run notice and the import of another add-on's groups (J4).

### Checks

`npm test`: 2,895 tests (and 2 `todo`), 100% on every metric, 0 lint findings; the mutation run 100%; the E2E suite on both browsers
(80 passed, 24 skipped: the Chromium and Firefox specs as before, plus 14 Firefox lab tests). Each fix was reverted in turn, and the journeys it belongs
to failed.

## Decisions taken after the first pass

The owner answered the five questions that the first pass left open. Done on the same branch; nothing is committed.

1. **A tab sent to another group that was the last one the window showed: the window follows it.** When the tab leaves a
   group and no other tab (pinned tabs do not count, every group shows them) is left in the shown group, the window
   switches to the group the tab went to: the group is made the shown one, gets a native group if native groups are on
   and it has none, and the tabs are shown and hidden for it. Where other tabs of the shown group are left, nothing
   changes, as before (`app/tab-moves.ts`, tests in `tab-moves.test.ts`, J11, and a Chromium E2E in
   `group-switching.spec.ts`). The property test now sends tabs there too (the exclusion is gone) and ran 3,000 times.
2. **`migrate` no longer says it worked when nothing was made.** It answers `false`, writes an error to the log and does not
   mark the migration done when it tried to make native groups and not one window got one (a browser without native
   groups, or one that refuses). A window with nothing to make (no groups, or the active group has no tabs) is not a
   failure, and when some windows got theirs and others did not it is done: a group that has none gets one when it is
   shown. It does not stop at the first window that fails (the windows are independent and are tried together): it gives
   its answer when all have been tried, and none is tried again until the next start or the next press of the button. The
   migration page and the options page show the answer as before. J14.
3. **The `notifications` permission is asked for, and said why.** `notifications` is in the manifest, and the README has a
   "Permissions" table with the reason for each permission; a test (`manifest-permissions.test.ts`) fails for a
   permission that the README does not explain, or explains and the manifest does not ask for. It is a required
   permission, not an optional one: both notifications come from the background with no user action, and an optional
   permission can only be asked for from one. The cost is that the browsers show it in the permission prompt of the
   install, and of the update that brings it. "Restoring tab groups..." can now show (it could not before). A notice that
   cannot be shown (the user took the permission away) is logged and does not stop the start-up.
4. **The safety rule is gone.** `core/grouping-safety.ts` and its tests are deleted; the only tab of a window is grouped
   like any other (a fact of Firefox: it makes the group and keeps the window; in Chromium the E2E shows the same). J15, the
   assignment tests, the E2E of the only tab of a window and the lab test of the first run (three groups, one per window,
   where there were two) were changed to say so.
5. **A first-run notice, and the import (J4).** When the first run leaves native groups off because tabs or groups are in
   place, one notification says so (`firstRunNativeGroupsOff`): the tabs were left as they are, and the options turn on
   native groups and import the groups of another add-on from its backup file. Clicking it opens the options page. It is
   decided once with the choice, so it is shown once. The other add-on's groups cannot be read, so the import is its
   backup file, which the options page already read (`panoramaView` and the old add-on's format). **Deviation from the
   plan's wording, for the owner to veto:** the offer is on the options page, not on the migration status page, which no
   page of the add-on links to; adding the import to it would put it where nobody goes.

### Found on the way, and fixed

- **Sending a tab from the menu failed in Chromium.** `visibleIdsInWindow` asked for `hidden: false`, which Chromium
  refuses ("Unexpected property: 'hidden'"), so the menu did nothing for the active tab. Found by the E2E. It reads the
  tabs and leaves out those that say `hidden`.
- **In a browser that cannot hide tabs the neighbour handed the window to another group.** The tab "before" the one sent
  away was taken among all tabs, which in Chromium are all visible, so the window could jump to another group. It is now
  chosen among the tabs of the group the tab leaves.
- **Chromium took the tab out of its native group again.** The tab was put in the native group and then moved to the end of
  the window, which Chromium treats as leaving the group. It is moved first.
- **The menu used the window the code runs in, not the window of the tab.** The click says the tab's window; `moveTab` uses
  it. (In a service worker "the current window" is whichever is in front.)
- **A race in recording a new native group.** Making the group for the tab that was sent empties the native group it left,
  which the browser removes and the add-on forgets, and the write that recorded the new group then brought back the
  reference to the removed one. The property test found it. The groups are read again before they are written.

- **A window closed with native groups came back with them when native groups had been switched off since.** Firefox
  restores the group (a fact), and nothing took the tabs out of it. Found by the property test (on the commit before these
  changes as well), which skipped restoring a window while native groups were off. A tab that is created in a native group
  while native groups are off is now taken out of it (`tabCreated`: a restored window's tabs arrive that way, and its
  window event comes before they are in their groups). The groups of the add-on and the group of each tab are kept: they
  are session values, which a restored window and its tabs bring back, so the window is a legacy one again. The property
  test restores windows whatever the setting. What it relies on, that a real restore brings the session values back, is
  the model's reading of Firefox; `TESTING.md` has it as a manual check. The same applies to a tab that arrives in a
  native group any other way while the feature is off (dragged in from a window of another add-on, say): it is taken out.

- **The badge on the toolbar button counted one group too many.** The window keeps the group for ungrouped tabs among its
  groups, and the count included it (one group showed 2, two showed 3). It counts the groups of the user. Found by the
  owner, with native groups off; the count never depended on them. Pinned by a unit test, by J14 and by the Chromium
  `group-switching` E2E.

### Not fixed, for the owner

- The Chromium E2E "activating a tab of another group" failed once in the first run after a build and passed in the
  runs that followed; not looked into.

### Checks

`npm run test:coverage`: 3,976 tests (and 1 `todo`, Decision 3), 100% on every metric; lint, knip, the type check, the
suppression check and `web-ext lint` pass. The Chromium `group-switching` E2E (3 tests) and the Firefox lab specs
(`native-groups-first-run`, `firefox-facts`: 16 tests) pass; the first-run lab test was shown to fail with the permission
taken out of the manifest.
