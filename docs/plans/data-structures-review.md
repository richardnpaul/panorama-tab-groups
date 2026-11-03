# Implementation Plan: A Review of the Extension's Data Structures

> **Status: Phases 1, 2 and 4 are done; Phase 3 is to do** (decisions 1 to 5, taken on 2026-11-02 and revised on
> 2026-11-03, decision 6, proposed on 2026-11-02 and taken on 2026-11-03, decision 7, taken on 2026-11-03, with how many backups
> are kept and how often still proposed, and the order of
> the work are under "Result").
> This is a review plan. The findings below were read from the code as **hypotheses**; the Result at the end says which
> held, which did not, and what was found besides. Nothing in the product was changed by it.

## Overview

The groups, which tab is in which group, and the link to the browser's native groups are kept in several places, in
shapes that grew with the extension. The ports and adapters work (`GroupState`, `NativeGroups`, `ViewState`, ...) made
them visible. Before more features (native groups per group, more languages, imports of old data, see the sibling
plans) are built on them, this plan checks whether the model holds up in the situations the extension meets in
practice: **more than one profile, more than one window, more than one group, many tabs, and both modes (native
groups and the older hide-the-tabs groups)**, and in the ones nobody listed yet.

## What is stored where today

| Data                                       | Kept as                                                                                       | Where                                                 | Notes                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| The groups of a window                     | `Group[]` in the window value `groups`                                                        | `browser.sessions` (Firefox); Chromium: the emulation | Per window; the group for ungrouped tabs (-2) is inside the list |
| The active group                           | window value `activeGroup`                                                                    | same                                                  | A group id of that window                                        |
| The next group number                      | window value `groupIndex`                                                                     | same                                                  | A counter per window, not global                                 |
| The group of a tab                         | tab value `groupId`                                                                           | same                                                  | Per tab, so the group does not list its tabs                     |
| The layout mode of a window                | window value `layoutMode`                                                                     | same                                                  | `freeform` or `tiling`                                           |
| A tab's thumbnail                          | tab value `thumbnail` (a data URL, or a record with the time)                                 | same                                                  | Can be large; two shapes are read                                |
| Whether the native migration ran           | `hybridGroupsMigrationComplete`                                                               | `storage.local`                                       | One flag for the profile                                         |
| Chromium's stand-in for the session values | one object under `__mock_sessions`                                                            | `storage.local`                                       | `{ tabs: {id: {...}}, windows: {id: {...}} }`                    |
| The user's options                         | `theme`, `view`, `toolbarPosition`, `useNativeGroups`, `shortcut`, and the old `useDarkTheme` | `storage.sync`                                        | Synced between devices                                           |
| A backup                                   | `{ file: {type: 'tgvView', version: 1}, windows: [...] }`                                     | a file                                                | Has a version; the stored data has none                          |

When this plan was written, `docs/spec.md` described `backgroundState` and `windowStates` in `storage.local`, which the
code no longer used; Phase 4 rewrote it (see "Result").

A `Group` is `{ id, name, containerId, rect, windowId?, nativeGroupId?: number | null, lastMoved?, isSystemGroup?,
tabCount? }`.

## Findings and questions (all to be tested, in order of how much they could hurt)

**F1. The Chromium emulation may keep growing and may mix tabs up.** (hypothesis, from the code)
Values live in one object that is read, changed and written back **whole** on every call (serialised by a lock). Entries
are removed only for a tab that is _moved to another window_ (`tabDetached` calls `clearTabGroup`); nothing removes the
entry of a tab or window that is closed. Firefox discards session values itself; Chromium does not. Chromium also
**reuses tab and window ids after a restart**, so an old entry can be read for a new tab, giving it a stale `groupId`.
Test: open and close tabs and windows, restart, inspect `__mock_sessions`; measure its size after a month of use.
`storage.local` has a quota and the manifest does not ask for `unlimitedStorage`.

**F2. Everything depends on ids that are not stable.** Window ids, tab ids and native group ids are per browser
session. Firefox maps the session values onto restored windows and tabs, but native group ids still change, so
`nativeGroupId` in the stored groups is stale after every restart and is cleaned up lazily
(`withoutStaleReference`). A stored value that is wrong after every restart is a sign it belongs somewhere else (not in
the persisted group).

**F3. One record holds three kinds of thing.** A `Group` mixes what the user owns (name, rectangle, order), what the
browser owns and changes (`nativeGroupId`) and what can be computed (`tabCount`, `isSystemGroup`, which is `id < 0`,
and `windowId`, which is the key it is stored under). The three kinds have different lifetimes; keeping them together
means a write of one can overwrite another (the code already guards against this in `followNativeGroup`). `nativeGroupId`
has three states (`undefined`, `null`, a number) with meanings only a comment explains.

**F4. The system groups are in the same list as the user's.** The view (-1) and ungrouped (-2) are special in many
places (`isReservedGroupId`, `UNGROUPED_GROUP_ID`); a list of one type with special ids invites code that forgets the
special case.

**F5. Ids are per window, so a group cannot move between windows or profiles.** `groupIndex` is a counter per window.
Two windows both have a "Group 0". Backups are therefore keyed by position, and anything that moves a group (an
import, a window merge, restoring a window) must renumber.

**F6. The tab-to-group link is stored on the tab.** Good for session restore, but there is no single place to ask
"which tabs does this group have" without reading every tab; the extension does it by listing the tabs of the window
and reading each one's value (`createNativeGroup`). Consistency (a tab whose group no longer exists) is repaired at
start-up (`group-recovery.ts`) and nowhere else.

**F7. No schema version.** A backup has `version: 1`; the stored data has none. The next change to a shape needs a
migration that cannot know which shape it is reading.

**F8. `containerId` is always `'browser-default'`.** Firefox containers (multi-account containers) are not used: tabs
of every container share the groups of the window. Either the field should go or containers should become real
(a group per container is a plausible feature).

**F9. Thumbnails are stored as session values.** They are the largest data the extension keeps, in two shapes, in the
same store as the groups, with no limit or eviction; the statistics page shows the total.

**F10. Mixing of kinds of id in the types.** `windowId`, `tabId`, `groupId` and `nativeGroupId` are all `number`, so the
compiler cannot tell them apart; the `nativeGroupId` check `browserGroupId > 0` in the cleanup shows a convention
(no group is -1) that is not in the type.

**F11. Not yet thought of, to look at:** private windows (does the extension run there at all, and where is its data),
profiles (each has its own `storage` so groups are never shared, and sync carries only the options), pinned tabs
(assumed never grouped; the code does not hold to that, see decision 6), discarded tabs, a tab dragged to another window while the extension sleeps (MV3 service worker), the
view tab being closed, two extensions' data (see the migration plan), a very large number of tabs (hundreds), and
the order of groups and of tabs (the order in the list or `lastMoved`?).

## The scenario matrix (the questions to answer for each)

For each combination, "what does the data look like, what can go inconsistent, and how is it repaired?":

|                                      | Legacy mode (hide tabs) | Native mode | Chromium (collapse + emulation) |
| ------------------------------------ | ----------------------- | ----------- | ------------------------------- |
| One profile, one window, one group   |                         |             |                                 |
| One window, many groups, many tabs   |                         |             |                                 |
| Several windows                      |                         |             |                                 |
| After a restart                      |                         |             |                                 |
| After restoring a closed window      |                         |             |                                 |
| After a crash                        |                         |             |                                 |
| After an update that changes a shape |                         |             |                                 |
| With a backup imported               |                         |             |                                 |

Phase 1 fills this table in, from the code and from experiments, and each empty cell becomes a test or a decision.

## Principles to review against (proposals, not decisions)

- **One owner per fact.** User-owned data, browser-owned references and computed values live apart, so a write to one
  cannot lose another.
- **Volatile ids are not persisted as if they were stable.** A reference to a browser object is kept where it is
  recreated on start-up, or is stored with what is needed to validate it.
- **Every persisted shape has a version and a migration**, and is parsed with a guard at the adapter (some already are:
  the options, the thumbnails).
- **Types say what the code assumes:** distinct ids, a union for the kinds of group, a union for the native link
  (`none | linked(id)`), not a nullable number with a comment.
- **Cleanup is part of the model:** whatever creates an entry says who deletes it, and a start-up pass removes what
  nothing refers to.

## Implementation Steps

Each step ends with `npm run typecheck`, `npm run lint`, the unit tests and Prettier.

### Phase 1: Find out (no product change)

1. **Inventory in code**: every read and write of each key above, by function (a generated table in this file), and which
   of them are guarded against a bad value.
2. **Experiments** for F1 and F2 on Chromium and Firefox: the growth and id-reuse of `__mock_sessions`; what the browser
   keeps across a restart and a window restore; what `nativeGroupId` looks like after a restart. Record numbers.
3. **Property tests** (a library such as `fast-check`, if the owner accepts the dependency) over the memory adapters:
   random sequences of events (create/close tab, move tab, create/delete group, new window, close window, restart with
   renumbered ids) with invariants: every tab has a group that exists; the active group exists; no two groups share an
   id in a window; every `nativeGroupId` is real or dropped; no tab is lost. Failures are the first list of real bugs.
4. **Fill in the scenario matrix** above.

### Phase 2: Decide

5. Take the findings to the owner: for each, fix now, plan, or accept. Likely first: F1 (data that grows or is
   mismatched), F7 (a version before any other change), F3/F2 (move `nativeGroupId` out of the persisted group).

### Phase 3: Change, one finding at a time

6. For each accepted finding: tests first (the property test that fails, or the journey), the change behind the port so
   callers do not move, a **migration from the current shape** with a test per old shape, and a forced Stryker run.
   The backup format stays readable (version 1 is read forever, and is still what is written while the backup only gains
   optional fields; see decision 3).

### Phase 4: Keep it true

7. `docs/spec.md` rewritten from the code (it describes keys that no longer exist), with a section "Stored data" that is
   checked by a test against the keys the adapters use.

## Risks and Mitigations

- **A migration that corrupts users' groups.** Mitigation: migrations are idempotent and tested on the old shapes,
  including the odd ones the readers already tolerate (a thumbnail as a plain string, `useDarkTheme`), and the property
  test (step 1 of the order of the work) runs over migrated data, and a backup is written before each migration
  (decision 7, step 2 of the order of the work, before the first migration).
- **Churn without benefit.** Mitigation: Phase 1 decides on evidence; a finding that does not show up in the
  experiments is dropped, not fixed.
- **Reworking storage on Chromium while its extension model is also changing.** Mitigation: the work stays behind
  `GroupState` and `ViewState`. Not only the emulation changes shape: decisions 3, 5 and 6 change what is stored in
  both browsers (a window's `schemaVersion`, the link moving to `storage.session`, pinned tabs losing their group).

## Success Criteria

- [x] The inventory and the scenario matrix are filled in and checked against the code (the keys by a test)
- [x] F1 and F2 are tested in Chromium and the results recorded here; **Firefox could not be asked about a restart**
      (Playwright's Firefox does not restore its session), which `native-groups-migration-and-user-journeys.md` also found
- [ ] A property test of the invariants exists and passes: **the data layer is covered**; the invariants over what a person does
      (no tab lost, every group exists...) are step 1 of Phase 3, below
- [ ] Every persisted shape that remains has a version and a migration test: decided (decision 3), to be built in step 3
      of the order of the work
- [x] `docs/spec.md` matches the code and a test keeps its list of stored keys true
- [ ] Every point marked **not verified** has an automated test, or a line in the manual test plan, as listed under "The
      checks of what is not verified" at the end of this file

## Skills, agents and rules for this work

From everything-claude-code (commit and checksums in `.agents/EXTERNAL-SOURCES.md`):

- `.agents/agents/type-design-analyzer.md` (encapsulation, whether the types state the invariants, whether the compiler
  enforces them) and `.agents/agents/silent-failure-hunter.md`; both were used as the checklist of F3, F4 and F10 below.
- `.agents/skills/hexagonal-architecture/SKILL.md`, as a reference for keeping every change behind `GroupState` and
  `ViewState` (this project's own layout is the one followed).

Left out: `database-migrations` (it is about SQL schemas and tools such as Prisma; the migrations here are of a few
JSON shapes in browser storage) and `architecture-decision-records` (it writes `docs/adr/`; this project's decisions are
the plans in `docs/plans/`).

## Result

Done on `review/data-structures`; nothing is committed, and **no product code was changed**.

### What was built

- **`tests/e2e/chromium-stored-data.spec.ts`**: two facts about the values the add-on keeps in Chromium, asked of the
  Chromium of Playwright 1.64.1 with a profile that is closed and opened again with the session restored.
- **`tests/unit/properties`** (fast-check 4.10.2, a development dependency, the newest release more than 14 days old):
  - the emulation of `browser.sessions` against a plain map, for any run of calls, one after the other and all at once;
  - for any input, the readers of a backup, the options, the group state, the thumbnails and the layout mode do not throw, give
    data of the shape the code relies on, and (backup, options) read what they gave out again the same. Each property was
    shown to fail when the guard it checks was taken away. **They found nothing wrong:** the readers are sound.
- **`docs/spec.md` section 2 rewritten** (it described `backgroundState` and `windowStates`, which no code has used for some
  time), and **`tests/unit/stored-data.test.ts`** keeps its table of keys the same as the keys of the adapters, in both
  directions (shown to fail when a row is removed).

### The inventory (who reads and writes each key)

| Key                             | Written by                                                                                                                                                                    | Read by                                                                                                                                                                                                     | Guarded on read?                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `groups` (window)               | `window-groups`, `groups-store`, `group-recovery`, `tab-lifecycle`, `delete-group`, `native-group-assignment`, `native-groups-sync`, `backup-service`, `with-ungrouped-group` | those, and `toolbar-service`, `commands`, `tab-moves`, `menu-manager`, `visibility-service`, `migration-status`                                                                                             | yes: only a list, each group checked by `isGroup`             |
| `activeGroup` (window)          | `window-groups`, `groups-store`, `commands`, `tab-lifecycle`, `backup-service`                                                                                                | `toolbar-service`, `tab-moves`, `commands`, `groups-store`, `native-groups-sync`, `backup-service`, `tab-lifecycle`, `group-recovery`                                                                       | yes: a number or nothing (text of digits is read as a number) |
| `groupIndex` (window)           | `window-groups`, `groups-store`, `backup-service`                                                                                                                             | the same three                                                                                                                                                                                              | yes, as `activeGroup`                                         |
| `layoutMode` (window)           | `view/start`, `view/controller`                                                                                                                                               | `view/start`                                                                                                                                                                                                | yes: `freeform` or `tiling` or nothing                        |
| `groupId` (tab)                 | `tab-moves`, `popup-service`, `group-recovery`, `tab-lifecycle`, `browser-events`, `view/drag`, `backup-service`; removed by `tab-lifecycle`                                  | `native-group-assignment`, `popup-service`, `groups-store`, `view/group-nodes`, `tab-lifecycle`, `group-recovery`, `browser-events`, `backup-service`, `view/controller`, `visibility-service`, `view/drag` | yes, as `activeGroup`                                         |
| `thumbnail` (tab)               | `view/controller`                                                                                                                                                             | `view/tab-nodes`, `options/statistics`, `view/controller`                                                                                                                                                   | yes: a record, or the picture alone, or nothing               |
| `hybridGroupsMigrationComplete` | `native-groups-sync`, `message-handler`                                                                                                                                       | `native-groups-sync`, `migration-status`                                                                                                                                                                    | yes (`=== true`)                                              |
| `__mock_sessions`               | the emulation, for every value above                                                                                                                                          | the emulation                                                                                                                                                                                               | yes: records within records, anything else is nothing         |
| options (`sync`)                | the options page                                                                                                                                                              | `createBrowserOptions`, the appearance of the view and the popup                                                                                                                                            | yes: each field falls back to its default                     |

### The findings, tested

- **F1, the emulation grows and mixes tabs up: the growth is confirmed, the mix-up is not.**
  - The values of closed tabs and windows are **never removed**, and survive a restart: `chromium-stored-data.spec.ts`
    asserts that the entries of closed tabs and windows are still there. (A run also counted 19 tab entries after 14
    tabs were opened and closed; the test does not assert that count.)
  - It is an unbounded cost, not an invisible one: **every read loads the whole object**, and every tab asks for its group,
    so each costs the size of everything ever stored. Timings measured once in real Chromium, **not kept as a test, so not
    repeatable from the repository**: a read took 0.2 ms at 100 entries, 1.6 ms at 1,000, 14 ms at 10,000, 75 ms at 50,000
    and 155 ms at 100,000 (a write about 1.5 times that). If they hold, an assignment (a read and a write) at 50,000 entries
    is about 190 ms, so recovering 100 tabs at start-up takes about 19 seconds, past `INITIALIZATION_TIMEOUT_MS` (10
    seconds, `core/constants.ts`). An entry was about 27 bytes, and each tab ever opened adds one: at 200 new tabs a day,
    50,000 is reached in about eight months; the quota of `storage.local` (10,485,760 bytes) is about 388,000 entries.
    Decision 2's split threshold is to be measured by a repeatable test, which these numbers are not.
  - **Thumbnails do not make it worse:** Chromium has no `tabs.captureTab`, so none is ever stored there.
  - **Ids are not reused:** the ids of tabs and windows are large and went on rising across a restart. That half of the hypothesis
    was not supported (one restart, in Playwright's Chromium).
- **F2, everything depends on ids that are not stable: confirmed, and worse than guessed, in Chromium.** A session that is
  restored brings back each tab and window **with a new id**, so the values under the old ids do not reach them. The extension
  does not find its groups, their names or their places for the restored window, and makes it one new group; the entries under
  the old ids stay for ever (F1). Chromium restores the native tab groups itself, so what a person sees is a window of native groups
  next to an add-on that has forgotten them. Firefox keeps the values with a restored window (a fact shown in the native-groups
  branch), and what it does after a full restart could not be asked. **Firefox's source says its native group ids are not
  per session**, which F2 assumed they were: see "What the add-on can know after a restart" under decision 1.
- **F3, one record holds three kinds of thing: confirmed by what is read.** `nativeGroupId` is the browser's and is stale after a
  restart (the journey J8 of the native-groups branch). Of the other fields written: `containerId` is **never read**, and is
  written as two different words for one meaning (`firefox-default` by `groups-store` and the backup, `browser-default` by
  `window-groups` and the ungrouped group); `tabCount` and `windowId` are written and never read from a stored group;
  `lastMoved` is read (the stacking in `core/layout.ts`); `isSystemGroup` is set only for the ungrouped group.
- **F4, the system groups are in the list of the user's groups: confirmed in use.** Every list of a window ends with `-2`, so
  code that lists groups has to leave it out (the journeys of the native-groups branch do, in `referencesOf`).
- **F5, ids are per window: confirmed by the code** (`groupIndex` counts for each window); not tested further.
- **F6, the link from a tab to its group is on the tab: confirmed, with the cost of F1 in Chromium.** There is no way to ask for
  the tabs of a group but to read each tab.
- **F7, no version on the stored data: confirmed;** only the backup has one.
- **F8, `containerId`: see F3,** it is not used. Nothing in `src/` reads a tab's container (`cookieStoreId`), and a backup is
  restored with `tabs.create({ url, windowId, active, discarded, pinned })`, without `cookieStoreId`, so **every restored
  tab opens in the default container**.
- **F9, thumbnails as session values: Firefox only** (see F1). Whether Firefox drops them with the tab is **not verified**
  (MDN's `sessions.setTabValue` page does not say how long a value lives). There is no limit in the extension, and the
  statistics page shows the total. `docs/plans/tab-thumbnails.md` would store thumbnails in Chromium too, and handles
  their clean-up there.
- **F10, ids of different kinds are all `number`: confirmed by the types;** no test.

### The scenario matrix

|                                      | Legacy mode (hide tabs)                                | Native mode                                                                                                                   | Chromium (collapse + emulation)                                                                 |
| ------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| One profile, one window, one group   | one `groups` list with `-2` in it; tabs have `groupId` | as legacy, and the group refers to a native group once it has a tab to put in one                                             | the same, in `__mock_sessions`                                                                  |
| One window, many groups, many tabs   | as above                                               | only the shown group refers to a native group (`tab-moves`: the others have theirs hidden)                                    | native groups for the shown group; nothing is hidden                                            |
| Several windows                      | the lists are per window, and group ids repeat         | a native group lives in one window; the references are per window                                                             | as native; the entries are by window id                                                         |
| After a restart                      | Firefox: kept with the window and tabs                 | the reference may be stale (J8 of the native-groups branch, which links it again); Firefox's source keeps the id (decision 1) | **all entries are under old ids: every group, name and place is lost** (F2); native groups stay |
| After restoring a closed window      | Firefox: values come back with it                      | the group comes back with its id in Firefox (a fact of the native-groups branch)                                              | new ids: as after a restart                                                                     |
| After a crash                        | as a restart                                           | as a restart                                                                                                                  | as a restart                                                                                    |
| After an update that changes a shape | **no version to tell which shape is stored** (F7)      | the same                                                                                                                      | the same, and the whole object is rewritten by the next call                                    |
| With a backup imported               | a window of its own, groups renumbered by position     | the same                                                                                                                      | the same                                                                                        |

### The decisions (Phase 2)

Taken by the owner on 2026-11-02, after three rounds of review of the first recommendations. Each says what was decided,
why, and what is still to be shown; a fact marked **not verified** is to be settled by the first test of its step, not
assumed.

1. **Native mode has no hidden groups, Chromium has only native mode, and Chromium rebuilds its groups after a restart
   (F2).** The first three points were taken on 2026-11-03, as was dropping matching by address.
   - **Native mode is the same in both browsers.** With native groups on, every group that has a tab has a native group,
     the groups not shown are collapsed, and no tab is hidden. Hiding tabs (`tabs.hide`) is only for legacy mode: Firefox
     with native groups off. That is one code path for native mode, and the hiding path only where it can run. Today
     it is not so:
     - Firefox native mode collapses and hides both: `compose.ts` gives the visibility service
       `canHideTabs: capabilities.hasTabHide`, whatever the option says.
     - A native group is made only when its group is shown (`tabActivated`, a switch in `tab-moves.ts`).
     - A tab moved with the menu into a group that is not shown is taken out of every native group (`moveToNativeGroup`
       calls `removeTabs`). In Chromium that tab is left visible and in no native group.
     - **The change:** `canHideTabs` is false while native groups are on; every group with a tab gets its native group (made
       collapsed when it is not the active one); `moveToNativeGroup` adds the tab to its group's native group, making it if
       needed. A Firefox profile already in native mode has the tabs of the groups not shown hidden: its migration (under
       decision 3's version) shows them and puts them in their groups' collapsed native groups.
   - **Chromium: native groups are the only mode.** Today they can be turned off there: the options page's
     `collapse-only` mode (`options/native-groups.ts`) has `disabled: false`, and off leaves groups with neither hiding nor
     native groups. The checkbox becomes checked and disabled, and `useNativeGroups` (`app/use-native-groups.ts`) is true
     wherever the browser has tab groups and cannot hide tabs, whatever is stored.
   - **Firefox's first run** (`decideNativeGroups`, `first-run.ts`; it runs only where tabs can be hidden, and only while
     the option was never set): hidden tabs in any window → native groups off; native groups in any window and no hidden
     tabs → on; neither → on. **Both found → off** (taken 2026-11-03: turning native groups on would show every hidden tab
     and move the legacy groups into native ones, which the person did not ask for). Today's rule is different: off when this add-on already has groups or any window has more than
     one tab. Hidden tabs are found with `tabs.query` and `hidden: true` (Firefox only: `adapters/browser/tabs.ts` notes
     Chromium refuses that query), native groups with `tabGroups.query` per window, as `adapters/browser/native-groups.ts`
     does now. The notice the first run shows stays, for the "off" case. **Not checked:** whether a released version ran
     native mode in Firefox without the option ever being saved; such a profile has tabs this add-on hid itself (native mode
     hides, above), and the rule would read them as another's and turn native groups off.
   - **What the add-on can know after a restart.** Read from the code and from the browsers' source (Firefox
     `mozilla-firefox/firefox` and Chromium `chromium/chromium`, both `main` on 2026-11-03); "source" below means one of
     those, and is not a test:

     |                                   | Firefox                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Chromium                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
     | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
     | What the add-on stores            | window values `groups`, `activeGroup`, `groupIndex`, `layoutMode`; tab values `groupId`, `thumbnail` (the inventory above); the migration flag in `storage.local`; the options in `storage.sync`                                                                                                                                                                                                                                                                                                                                                   | the same values, in `__mock_sessions` under the ids they had when written; the flag; the options. No thumbnails (F1)                                                                                                                                                                                                                                                                                                                                                                                                    |
     | What it reads of a tab            | `id`, `windowId`, `index`, `url`, `title`, `pinned`, `hidden`, `lastAccessed`, `groupId` (`adapters/browser/tabs.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                              | the same, without `hidden`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
     | Of a native group                 | its id, its tabs, and with `tabGroups.get` its window and title (`adapters/browser/native-groups.ts`); `createNativeGroup` sets the title and colour                                                                                                                                                                                                                                                                                                                                                                                               | the same                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
     | After a restart, session restored | window and tab values come back with their windows and tabs: session restore saves them (`extData`, `SessionStore.sys.mjs`) and sets them again on the restored window and tab. Native groups come back **with the same id**: each is recreated with its saved id (`createTabsForSessionRestore`), and the add-on's number is computed from that id (`getExtTabGroupIdForInternalTabGroupId`, `ext-browser.js`). Pinned tabs come back pinned and in no group. **Source only:** Playwright's Firefox does not restore a session (Success criteria) | tabs, windows and native groups get **new ids**: shown by `chromium-stored-data.spec.ts` for tabs and windows; for native groups, restore makes a new id for each (`TabGroupId::GenerateNew()`, `session_restore.cc`), and the add-on's number is a hash of it (`ExtensionTabUtil::GetGroupId`). The native groups come back with their tabs (F2), and with their title and colour by the source (`RestoreTabGroupMetadata`, "restore the groups' visual data", `session_restore.cc`). The values are under the old ids |
     | After a crash                     | not verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | not verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
     | When the session is not restored  | new windows and tabs, with no values; `storage.local` and `storage.sync` are kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | the same; the old entries match nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

     So Firefox needs no rebuild, if the source is what runs, and F2's "native group ids still change" holds for Chromium
     only. The one thing that crosses a Chromium restart and names a group is a native group's **title**.

   - **The Chromium rebuild.** On start, and when a window opens (decision 2), in a window that has native groups and none
     of the add-on's groups, the groups are
     rebuilt from the native groups and the old window entries in `__mock_sessions` (kept by decision 2). Addresses are not
     stored and not used:
     - **Which old window: matched one to one, across all the restored windows at once.** The old entries are under old
       window ids, and nothing in them says which restored window they belong to. Matching each window on its own fails
       for the common case: new groups are named `defaultGroupName` plus the id (`window-groups.ts`), each window counts
       its ids from its own `groupIndex`, and the colour comes from the id (`getColorForGroupId`,
       `native-group-assignment.ts`), so two windows with default-named groups have the same titles and colours, both old
       windows fit both restored ones, and "more than one fits, take nothing" would lose both layouts. So:
       - An old window is a candidate for a restored one when its stored groups' names include every native group's title
         (an old group with no tabs has no native group after the restart, so the titles are a subset of the names).
       - Candidates are ranked: an exact set of titles first, then the fewest old groups left over, then whether the old
         `activeGroup` is the group of the restored window's one expanded native group (`collapsed` is read with
         `tabGroups.get`).
       - Pairs are taken best first, and each old window and each restored window is used once.
       - **A true tie: for the owner** (proposed: pair them in the order of their window ids, which nothing shows to match
         the order the windows had). A wrong pair costs the rectangles, the order and the empty groups of those windows;
         tabs follow their native groups whichever pair is made. Taking nothing loses those for both windows.
       - A restored window with no candidate left uses the native groups alone.
       - Titles stay in step with names: renaming a native group in the browser renames the add-on's group
         (`native-groups-sync.ts`, `onUpdated` and `followNativeGroup`).
     - **Which group.** Within that window, each native group is matched by title to `oldGroup.name` (or to
       `defaultGroupName` plus the id, for a group with no name; `createNativeGroup` gives that title). A title that two
       old groups share is not matched. A matched group keeps its `id`, `rect` and order; the old window's groups that had
       no tabs come back empty. A native group with no match gets a new group with default placement.
     - **Which tabs.** A tab in a native group joins that native group's group. Under the first point above, the only tabs
       in no native group are ungrouped ones and pinned ones: they go to the ungrouped group (-2), and a pinned one gets no
       group (decision 6).
     - **Not verified:** that the restored tabs and native groups are there when `startup.ts` runs recovery, window set-up
       and `relink`. The first test is in `tests/e2e/chromium-stored-data.spec.ts`, which already restores a profile.
2. **The emulation is pruned (F1).** With no addresses stored (decision 1), nothing can tell which closed tab's entry
   belongs to a tab that comes back with a new id, so an entry of a closed tab has no reader: **it is removed when the tab
   closes.** Only window entries are kept for a while, for decision 1:
   - the entries of a window that closes are kept for a grace period (the last _N_ windows or the last few hours, to be set
     from a test), since a reopened window comes back with new ids (the scenario matrix) and is rebuilt as after a
     restart. So the rebuild of decision 1 also runs when a window opens with native groups and none of the add-on's
     groups, not only at start;
   - at a restart, the entries of the windows open at quit are kept until a pass after recovery has used them, however long
     the browser was closed: a grace period counted in hours must not run while the browser is closed;
   - when a tab is reopened (Ctrl+Shift+T, `sessions.restore()`), Chromium gives it a new id. If Chromium reopens it inside a
     native group (`tab.browserGroupId !== -1`; Chrome documents `-1`, `TAB_GROUP_ID_NONE`, as "no group", and Chromium's
     `tabs.group` checks that the id it returns is above 0, `CHECK_GT(group_id, 0, ...)` in `tabs_api.cc`), the tab goes to
     the group linked to that native group in decision 5's mapping. Otherwise it goes to the active group, as every tab
     does today (`tab-lifecycle.ts`, `groupOfNewTab`).
   - **`tabCreated` stops pulling a tab out of the native group Chromium put it in.** With native groups on, it moves every new
     tab into the active group's native group (`assignNewTabToNativeGroup`, `nativeGroups.addTabs`); a tab Chromium reopened
     into its own group is taken out of it. `unclaimedNativeGroupOfTab` covers a tab in a native group no group has claimed,
     not this one.
   - **A tab's native group changing in the browser is followed (native mode).** Nothing listens for it today:
     `browser-events.ts` reads `tabs.onUpdated` only for the view tab, and `native-groups-sync.ts` follows the events of
     groups, not of tabs. With native groups the only mode in Chromium, a tab dragged into another native group in the tab
     strip leaves its stored group wrong. `tabs.onUpdated` reports `changeInfo.groupId` (MDN's compatibility data: Chrome
     88, Firefox 138), so:
     - a tab that joins a native group linked to a group (decision 5) gets that group;
     - a tab that leaves its native group (`groupId` -1) and is not pinned gets the ungrouped group (-2); pinning is
       decision 6's;
     - a native group that no group is linked to is left alone: it may be one the add-on is making, whose link is written
       just after `createFromTabs` returns, and `unclaimedNativeGroupOfTab` covers one the person made;
     - **the add-on's own moves are not followed back.** They store the tab's group before they group it (`moveTab`,
       `tabCreated`), so most of their events find the group already right. But a move puts the tab at the end first
       (`tabs.moveToEnd`; the code's comment there says "Chromium takes a tab out of its group when it is moved
       past the group") and only then into its native group, so the
       `groupId: -1` in between would undo the move. The tabs the add-on is moving are kept in a set for the length of the
       move, and their events are skipped;
     - with native groups off (legacy mode) the events are ignored.
       This also covers a reopened tab that joins its native group only after `tabs.onCreated`.
   - **Not verified:** whether Chromium reopens a closed tab into its native group at all, and if so whether `tabs.onCreated`
     already carries the tab's `groupId` or the tab joins its group a moment later (then the handler above gives it its
     group, after `tabCreated` gave it the active one). A Chromium E2E test reopens a tab with `sessions.restore()` and
     asserts the group it ends in, against the real extension.
   - **Not done: splitting `__mock_sessions` into a key per window or tab.** The cost is in the writes as much as the reads:
     every set rewrites the whole object (`sessions-emulation.ts`), and switching tabs is a set. But pruning bounds the
     entries to the open tabs plus the grace period, and a split is a change of shape that needs decision 3 and a lock per key.
     It is done when a repeatable test (not a one-off script) shows a write past 10 ms at the size a heavy user reaches.
3. **A version for the stored data (F7), before any change of shape:** one number under one key in `storage.local`, read at
   start, with a migration for each step. The backup's `file.version` is not tied to it: it stays 1 while the backup's
   shape only gains optional fields (`docs/plans/firefox-containers-in-backups.md`). **Each window carries a dedicated
   `schemaVersion` key too, and is migrated when it is read:** Firefox restores a closed window with the values that were
   written when it closed (which may be weeks and versions ago, after the start-up migration has run). Storing
   `schemaVersion` as a separate window session key leaves `groups` as `Group[]`, avoiding breaking existing readers. When
   `groupState.getGroups(windowId)` reads a window whose `schemaVersion` is missing (today's shape) or older than the
   current one, it runs the window migrations from there, and records the current version.
   - The window's migration also covers the values of **its tabs** (`groupId`, and the pinned rule of decision 6), which
     come back with it.
   - Many callers read a window's groups at once (the inventory above lists them), so the migration runs once per window,
     under a lock; two readers must not both migrate and write.
4. **Containers (F3, F8): kept working, not supported.** This plan does not lose a container anywhere it does not lose one
   today:
   - `containerId` becomes optional in the type and is no longer written. It is not a container in any case: the group does
     not own one (a tab does, `tab.cookieStoreId`), and `browser-default` is a made-up value while `firefox-default` is
     expected to be Firefox's id of the default container (Q1 of the containers plan checks it). The migration of decision 3 (step 3 of the order of the work) reads
     both and drops them.
   - **Known limitation, written in the release notes:** a backup restores every tab in the default container. That undoes an
     isolation the person chose (a tab of a banking or Facebook container comes back sharing the default container's
     cookies), so it is a privacy limitation, not only a missing feature.
   - **Restoring containers is a plan of its own,** because it is bigger than this one and a naive version is worse than the
     limitation. If, as expected, each profile numbers its own containers, a `cookieStoreId` names a different container
     in another profile, so a backup restored there could put a banking tab in another container. How a container is known
     to be the same one, and so which permissions are needed, is that plan's decision 1: matching by name needs `contextualIdentities`, which MDN does
     not list as an optional permission and which turns containers on for every user; matching by id within the same profile
     needs only `cookies`, which can be optional. Its first step is a test in the Firefox lab (`tests/e2e/lab/`).
5. **`nativeGroupId` moves out of the stored group into `storage.session` via Adapter Join (F3, F2).** The add-on's persistent
   storage keeps what the user owns; the link to the browser's groups, which is stale after every restart in Chromium, goes to
   `storage.session`, which is cleared when the browser closes (sources below). Firefox keeps a native group's id across a
   restart by its source (decision 1), so there the link is rebuilt to the same value; it moves too, so that both browsers
   keep it the same way.
   - **The Adapter Join:** the `GroupState` adapter performs a join between persistent group storage (`storage.local` / `sessions`)
     and `storage.session` on `getGroups(windowId)`. In memory, `Group` retains `nativeGroupId?: number | null`, keeping pure domain
     logic (such as `src/js/core/visibility.ts` and `collapse`/`expand` planning) untouched. Only the persistence layer moves
     `nativeGroupId` into `storage.session`.
   - It is not kept in a module variable: an MV3 background is unloaded after a short idle time, not only at a restart. `relink`
     (`native-groups-sync.ts`, run from `startup.ts`, which `main.ts` calls each time the background starts, when native
     groups are on) rebuilds it. That matters because Chrome clears `storage.session` "if the extension is disabled,
     reloaded, updated, and when the browser restarts", and MDN says Firefox clears it "When the browser stops" and when the
     extension is disabled or uninstalled.
   - **Versions:** `storage.session` exists from Chrome 102 and Firefox 115 (MDN's compatibility data,
     `webextensions/api/storage.json`, `session`), and needs the `storage` permission, which the manifest has. Native groups
     need `tabs.group` (Firefox 138) and `tabGroups` (Firefox 139; `capabilities.ts` checks both), so every Firefox that
     runs native mode has `storage.session`. The manifest has no `strict_min_version`.
   - **Surviving the background being unloaded:** Chrome, by its storage reference, "Session storage holds data in memory
     while an extension is loaded", and the unloading of an idle service worker does not unload the extension; it is not
     said in so many words. Firefox: **not verified** (MDN's page does not say). `relink` at each start of the background
     covers it either way. Its adapter is new and has a contract test like the others.
   - **A write must not bring back a stale link.** `setGroups` is given whole `Group` objects, which still carry
     `nativeGroupId` in memory, so a caller that read the groups before `relink` or `followNativeGroup` changed a link
     would write the old link back, and F3's "a write of one can overwrite another" would come back through the join. So
     links get a port method of their own, `setGroups` ignores `nativeGroupId`, and every caller that sets or clears a
     link through `setGroups` today calls it instead. A search for `nativeGroupId` finds them in `native-group-assignment.ts`,
     `native-groups-sync.ts` (`relink`, `withoutStaleReference`, `withoutNativeGroup`), `tab-lifecycle.ts`
     (`withNativeGroup`), `groups-store.ts`, `window-groups.ts` and `core/groups.ts`; the step starts by listing them all
     again. `null` ("never has a native group", given to the ungrouped group by `core/groups.ts` and `window-groups.ts`)
     is not a link to anything the browser owns: it stays with the group in persistent storage. Reading stays as it is, which is what keeps the domain logic untouched.
   - **Links of groups that are gone are removed.** When `setGroups` writes a window's groups, the links in `storage.session`
     of that window's groups not in the list are deleted (it only ever deletes a link, so it cannot write a stale one back).
     The read joins only the groups in the list. Group ids are not given out again within a window (`groupIndex` only
     rises, `window-groups.ts`, `groups-store.ts`; a backup sets it, but opens a new window), so this is to keep
     `storage.session` small, not to stop a new group taking an old link.
6. **Pinned tabs (F11): a pinned tab has no group, and is never passed to the browser's grouping (proposed 2026-11-02,
   taken 2026-11-03 with the unpinning rule below).** Reported: "Pinned tabs get unpinned when moved into a native tab
   group."
   - **Why it happens.** MDN `tabs.group`: "Any pinned tabs are unpinned before grouping." (Chrome's page does not say.)
     Nothing in the add-on keeps pinned tabs away from it:
     - `groupOfNewTab` (`tab-lifecycle.ts`) stores the active group for every new tab, pinned or not, and nothing changes
       the stored group when a tab is pinned later (the background's `tabs.onUpdated` handler, `browser-events.ts`, only
       looks for the view tab). So a pinned tab keeps a group.
     - `createNativeGroup` (`native-group-assignment.ts`) groups every tab of the window whose stored group matches, with no
       check of `pinned`. It runs from `tabCreated`, `tabActivated`, a move (`tab-moves.ts`) and `migrate`
       (`migrateWindow`, `native-groups-sync.ts`), so a pinned tab is unpinned the next time its group gets a native group.
     - `assignNewTabToNativeGroup` (`tab-lifecycle.ts`) passes a new tab to `addTabs` without checking `pinned`. This
       includes a pinned tab dragged to another window (`tabAttached` calls `tabCreated`).
     - `moveToNativeGroup` (`tab-moves.ts`) passes a tab moved with the menu to `addTabs` without checking `pinned`.
   - **Why the tests do not see it.** The browser model (`tests/support/world/browser-model.ts`, `group`) and the memory
     adapter (`adapters/memory/native-groups.ts`, `addTabs`) group a pinned tab and leave it pinned. They do not do what
     MDN says Firefox does.
   - **The rule:**
     - A pinned tab has no stored group. Pinning a tab (`tabs.onUpdated` with `pinned: true` in `browser-events.ts`) clears
       its group (`groupState.clearTabGroup(tabId)`), and takes it out of its native group (`nativeGroups.removeTabs([tabId])`),
       if the browser has not done that already (Q below). A new or attached tab that is pinned gets no group. Visibility
       already treats a pinned tab as having none (`visibility-service.ts`, `withGroup`).
     - Startup recovery respects this invariant: `recoverTab` (or `recoverWindow`) and `salvageGrouplessTabs` in `group-recovery.ts`
       filter out pinned tabs (`tab.pinned === true`), so startup never assigns a pinned tab to `-2` or the active group.
     - **Unpinning a tab** (`tabs.onUpdated` with `pinned: false`; taken 2026-11-03) gives a group only to a tab that has
       no stored group (a tab the add-on's menu unpins already has one, below), and depends on the mode:
       - **Native mode (Chromium, and Firefox with native groups on):** the tab stays ungrouped. It gets the ungrouped
         group (-2), not "no group": with no group, `salvageGrouplessTabs` (`group-recovery.ts`) would put it in the
         active group at the next start, while -2 is one of the window's groups and is kept. It is put in no native group;
         the browser does not put it in one either (Firefox: bug 1927994's test, "unpinned tab is still not in the tab
         group"; Chromium: likely, not verified, as unpinning moves the tab with no group, `std::nullopt`, below). The person moves it to a group
         if they want to. This needs decision 1's "no tab is hidden in native mode": today Firefox's native mode hides
         every tab not in the active group (`planVisibility`, `core/visibility.ts`), -2 included, so the tab would vanish
         at the next switch. That is why step 4 comes before step 5.
       - **Legacy mode (Firefox, tabs hidden, native groups off):** the tab joins the window's active group, where the
         person is looking. If `activeGroup` is `VIEWER_GROUP_ID` (-1) or undefined, it falls back to
         `fallbackActiveGroup(groups)`.
       - In neither does it go back to the group it had before it was pinned: that group may be hidden or collapsed, and
         the tab would disappear as it is unpinned.
     - No pinned tab reaches `tabs.group`. The places above (`tab-lifecycle.ts`, `native-group-assignment.ts`, `tab-moves.ts`,
       and `group-recovery.ts`) filter pinned tabs out. The browser adapter of `NativeGroups` also drops them from `createFromTabs`
       and `addTabs` (it reads the tabs first), so a path added later cannot unpin one. That costs one `tabs.query` per call.
     - **A tab moved with the add-on's menu while pinned is unpinned, then moved** (taken 2026-11-03), alone or among
       several selected tabs, in every mode. That is what the browser's own menu does: Firefox's "Move tab to new group"
       (`moveTabsToNewGroup`, `tab-context-menu.js`) calls `addTabGroup`, and the group's `addTabs` (`tabgroup.mjs`) calls
       `unpinTab` on a pinned tab before moving it in; Chromium's `tabs.group` unpins (below). The add-on does not leave
       the unpinning to `tabs.group`, since its adapter filters pinned tabs out (above):
       - `menuClicked` (`tab-moves.ts`) has only ids (`tabs.highlightedIdsInWindow`), so it reads whether each is pinned
         (`listSummariesInWindow` gives `pinned`).
       - For a pinned tab, the move sets the tab's stored group first, then unpins it through a new `Tabs` port method
         (`tabs.update` with `pinned: false`), then puts it in the native group as for any tab.
       - The unpinning rule above gives the tab -2 or the active group **only when it has no stored group**, and the move
         stores the group before it unpins, so the `tabs.onUpdated` event of this unpinning does not undo the move.
       - A tab that is pinned and has a stored group exists only for that moment; the property test's invariant ("no
         pinned tab has a group") is checked between events, not inside the move.
   - **The model and the memory adapter are fixed first.** Both unpin a pinned tab that is grouped, as MDN says, so the user
     journeys fail on today's code before the fix (the test is written first). The invariant "no pinned tab has a group, a
     native group, or was unpinned by the add-on" joins the property test in step 5 of the order of the work, below.
   - **Backups.** `snapshotOf` saves a pinned tab's group, and `openTab` sets it back (`backup-service.ts`). Under this
     rule a restored pinned tab gets no group. The old add-on's converter already gives pinned tabs group 0
     (`core/backup.ts`); it is left as it is, and the group is dropped when the tab is restored.
   - **Migration.** At start, under the version of decision 3, every pinned tab that has a stored group loses it.
   - **What the documentation and source say, and what is still to be shown:**
     - **`tabs.onUpdated` reports `pinned`:** verified. MDN lists `changeInfo.pinned`, "The tab's new pinned state"; Chrome's
       `tabs` reference lists `pinned`, "The tab's new pinned state."
     - **Firefox `tabs.group` unpins:** MDN, "Any pinned tabs are unpinned before grouping." The source does it
       explicitly: `group()` in `ext-tabs.js` calls `unpinTabsBeforeGrouping()` (`gBrowser.unpinTab` on each tab) before
       both making a new group and adding to an existing one.
     - **Chromium `tabs.group` unpins, for a new group and an existing one: by the source, not by a test.** The header
       comments quoted in an earlier version of this plan point both ways, but the code the API reaches does not:
       `TabsGroupFunction::Run` (`tabs_api.cc`) calls `AddTabsToGroup` (`tab_list_bridge.cc`), which calls `AddToNewGroup`
       or `AddToExistingGroup` (`tab_strip_model.cc`), and both end in `MoveTabsAndSetPropertiesImpl(..., group, false)`,
       whose last argument is `pinned`. The Chromium E2E test of step 5 asserts it, for `createFromTabs` (a new group) and
       `addTabs` (an existing one).
     - **Pinning takes a tab out of its native group in Chromium:** likely, not verified. `SetTabPinnedImpl` calls
       `MoveTabToIndexImpl(index, final_index, std::nullopt, pinned, false)`, and the group argument `std::nullopt` takes it
       out of its group (`TabGroupStateChanged` removes it from the old one). It does not call `RemoveFromGroup`, as an
       earlier version of this plan said. The same `std::nullopt` is passed when unpinning, so the tab does not go back.
       The Chromium E2E test checks both.
     - **Firefox, pinning a grouped tab takes it out of its group: by the source.** `pinTab` (`Tabbrowser.sys.mjs`) moves
       the tab into `pinnedTabsContainer`, apart from the groups, and `moveTabTo` documents that "pinned tabs are presently
       not allowed in tab groups". This came with bug 1927994 ("do not allow pinned tabs to move inside tab groups",
       Firefox 135), whose test asserts "pinned tab is no longer in the tab group" and "unpinned tab is still not in the tab
       group", and bug 1943885 ("Pinning first tab should ungroup it", Firefox 136). Grouping unpins: the group's `addTabs`
       (`tabgroup.mjs`) calls `unpinTab` on a pinned tab before moving it in. (`addTabGroup`, `Tabbrowser.sys.mjs`, still
       has a comment that a group can be left empty "if all provided tabs are pinned", which `addTabs` no longer allows.)
       Session restore pins a pinned tab and does not group it. A Firefox lab test
       checks pinning and unpinning.
     - **Unpin, group, pin again, to keep a pinned tab in its native group: not possible in Firefox today.** A Mozilla
       Connect thread (`connect.mozilla.org`, "Pinned tabs & their association with group tabs") is reported to describe
       this as a way to keep a pinned tab in a group; it refuses automated reading (HTTP 403), so it was not read, and its
       Firefox version is not known. By the source above, pinning the tab again takes it out of the group, so the add-on
       cannot automate it. Bug 1792430 (open, no decision) asks for pinned tabs that belong to a group; if Firefox does
       that, this rule is reopened. The lab test of step 5 also runs the three steps, and shows which holds.
7. **Automatic backups (taken 2026-11-03: a backup before an update of the add-on, a backup at intervals where nothing
   warns of a restart, and files on disk; how many and how often, proposed).** No backup is written today unless the person exports one, and nothing
   in `src/` listens to `runtime.onUpdateAvailable`, `runtime.onInstalled` or `alarms`.
   - **The add-on's update: there is a signal.** `runtime.onUpdateAvailable` fires before an update is applied. MDN: with no
     listener, "the extension is reloaded immediately and the update is applied"; with one, the update waits for the next
     reload (a browser restart, disabling and enabling, or `runtime.reload()`). Chrome: "If you do nothing, the update will
     be installed the next time the background page gets unloaded". So:
     - the listener writes a backup at once, before anything else (`downloads.onChanged` reports the file complete),
       since in Chrome the update may be applied at the next idle unload of the background, which the add-on cannot
       delay;
     - it calls `runtime.reload()` only once no page of the add-on is open (the view, the options, the popup; found with
       `tabs.query` on the add-on's own addresses and watched with `tabs.onRemoved`), because a reload ends those pages
       and what the person is doing in them. In Firefox that holds the update until then (or until the browser
       restarts); in Chrome the update can still come earlier, at an idle unload.
     - **Not verified:** what an open `view.html` tab does when the add-on reloads (closed, or left showing a dead page),
       and Chrome's page speaks of a background page, not a service worker.
       A backup is also written before each migration of decision 3, which covers an update that arrives without the event (an
       add-on loaded unpacked, reloaded in development).
   - **The browser's restart for its own update: no signal before it.** Chrome's `runtime.onRestartRequired` is "only fired
     for Chrome OS kiosk apps" (MDN says the same for Firefox), and `runtime.onBrowserUpdateAvailable` is deprecated in both.
     `runtime.onSuspend` cannot be used for it: both pages say "any asynchronous operations started while handling this
     event are not guaranteed to complete". `runtime.onInstalled` with `browser_update` (Firefox) or `chrome_update`
     (Chrome) comes after the update, too late for a copy of what was there before it. So the backup is written at
     intervals.
   - **At intervals, from changes, not from a timer.** After the add-on changes the groups, it writes a backup if the newest
     one is older than an interval (proposed: an hour). That needs no new permission; the manifest has no `alarms`
     permission, and Firefox's alarms "do not persist across browser sessions". A browser that is left alone needs no
     new backup, as nothing changed.
     - **In the application layer, not in the adapter.** A backup reads every window and every tab's group
       (`backup-service.ts`, `snapshotOf`), and in Chromium each read loads the whole `__mock_sessions` object (F1), so
       it must not run inside a write of the groups. `compose.ts` gives the services a `GroupState` that tells a backup
       coordinator of each write (a wrapper; the adapter does not change); the coordinator only notes the time, and
       debounces: the backup runs a while after the last change (proposed: a minute), off the path of the write that
       caused it.
     - It does not run while a backup is being opened (`isOpeningBackup()`, `window-groups.ts`) or before start-up
       recovery is done (below). A backup that fails is logged and never throws into the operation that triggered it.
     - **What it stores to do this:** the number of the next file and the time of the last backup, under a key of its own
       in `storage.local`. `docs/spec.md` section 2 gains that key in the same step, as `tests/unit/stored-data.test.ts`
       requires the keys of the adapters and of the spec to be the same.
   - **Several kept, and none at start-up before recovery.** The newest backup can already hold a loss: after a Chromium
     restart the add-on writes one new group for a restored window (F2) before decision 1 is built, and a backup written then
     would hold that. So the last _N_ are kept (proposed: 5) with their time, and none is written by start-up until recovery
     and the rebuild of decision 1 have run.
   - **Where: files on disk (taken 2026-11-03), in the Downloads folder.** A file outside the browser's storage survives
     whatever goes wrong with that storage. An extension can write a file only with `downloads.download`, and only under
     the Downloads folder: both browsers take `filename` as "relative to the default downloads directory" (MDN; Chrome:
     "possibly containing subdirectories"), and an absolute path or `..` is an error. The add-on's own folder cannot be
     chosen. So the backups go in a folder of their own under Downloads (proposed: `panorama-tab-groups-backups/`), as
     version 1 backup files, which the options page already restores from a file the person chooses
     (`options/backup.ts`). The `downloads` permission is in the manifest.
     - **Kept to _N_ by name:** the files are `backup-1.json` to `backup-N.json`, written in turn with
       `conflictAction: 'overwrite'`; each file holds its time. Listing and deleting files is not possible beyond the
       downloads the browser still remembers (`downloads.removeFile`), so fixed names are what keeps the count bounded.
       **Not verified:** that Firefox supports `overwrite` (MDN lists it; its compatibility table was not read).
     - **Nothing to answer:** `saveAs: false`. MDN: when `saveAs` is left out, Firefox follows the person's "Always ask
       you where to save files" setting, which would ask where to save every backup.
     - **Each backup shows in the browser's downloads list.** Chrome can hide its download UI only for the whole profile
       (`downloads.setUiOptions`, with a `downloads.ui` permission), which would hide the person's own downloads too, so
       it is not used. The entry can be taken out of the history after the file is written (`downloads.erase`, which
       "erases matching DownloadItems from the browser's download history, without deleting the downloaded files"). **Not
       verified:** whether Firefox opens its downloads panel for a download started by an extension in the background.
     - **The file's content in the background.** Today's export runs in the options page and makes a `blob:` URL
       (`options/start.ts`, `URL.createObjectURL`). The backup runs in the background, a service worker in Chromium.
       **Not verified:** that a service worker can make a `blob:` URL, or that `downloads.download` takes a `data:` URL
       in each browser; neither docs page says. The first test of step 2 settles which one is used.
     - A backup holds each tab's address and title and no thumbnails (`backup-service.ts`, `snapshotOf`).
   - **What a backup can and cannot do.** Restoring one opens its tabs again (`tabs.create`, `backup-service.ts`); it does not
     put the tabs already open back in their groups. It keeps the groups and their tabs from being lost; it is not a way to
     rebuild the groups of a restored window, and decision 1 does not use its addresses.

The other findings: **F5** (ids per window) is accepted. Ids are numbers by design, are kept in the reserved ids -1 and -2, the
ids of the context menu and the backup format, and a group never leaves its window; it is reopened when a feature moves groups
between windows. **F10** (distinct id types) is cheap and independent, and can be done at any time. **F6** and **F9** are
accepted as they are for now.

### The order of the work (Phase 3)

Each step follows step 6 above: tests first, the change behind the port, a migration with a test per old shape, a forced
Stryker run, and the gates of `.agents/rules/verification-validation-rules.md`. Each has an E2E test against the real
extension where its behaviour is in the browser: Chromium for steps 4 to 8, and the Firefox lab for steps 4 and 5 (pinning,
grouping and collapsing in Firefox) and for any Firefox-only behaviour of step 3's window migration. Step 2's update event is
tested with unit tests (no test here can make a browser offer an update); its writing of the file is tested in Chromium and
in the Firefox lab.

1. **The property test of baseline invariants.** Random sequences of what a person does (open and close tabs and windows, move
   tabs, make and delete groups, restart) over `createWorld()` from `tests/support/world/world.ts`, which is in the tree since #32:
   every tab has a group that exists, the active group exists, no two groups of a window share an id, every `nativeGroupId` is real
   or dropped, no tab is lost. It runs against today's code; whether today's code holds to all of these is not known
   until it runs, and whatever it finds is fixed, or written down here, before step 2. Step 5 changes "every tab" to
   "every unpinned tab".
2. **Automatic backups** (decision 7), before step 3, so the first migration has a backup to fall back on: the update
   listener, the coordinator in the application layer, the files, and the key of their state in `docs/spec.md`.
3. **The version** (decision 3), with the migration that drops `containerId` (decision 4).
4. **Native mode without hidden groups** (decision 1, first three points): a native group for every group with a tab,
   collapsed when not shown, no hiding in native mode, the Firefox migration that shows the hidden tabs, Chromium's option
   fixed on, and Firefox's first run. Before step 5, whose unpinned tabs stay in -2 and must not be hidden.
5. **Pinned tabs** (decision 6): the rule (pinned tabs filtered out of every path of "Why it happens", pinning clears the
   group, unpinning by mode), the browser adapter's filter, `group-recovery.ts` filter, and the migration. It starts with the Chromium E2E and Firefox
   lab tests of decision 6's points that are known only from the source. The test model is updated to do what those tests
   show, and the invariant "no tab is unpinned by the add-on" joins the property test here, landing together with the
   implementation to keep Gate 1 green.
6. **`nativeGroupId` to `storage.session` via Adapter Join** (decision 5), before step 7, so the groups rebuilt there do not carry
   a stale link.
7. **Chromium rebuilds its groups after a restart, and after a window is reopened** (decision 1): native groups matched by
   title against the kept `__mock_sessions` window entries, to keep each group's id, rectangle and order, and the empty
   groups.
8. **Pruning, and reopened tabs** (decision 2): a closed tab's entry removed when it closes, the grace period for window
   entries, the start-up pass, a reopened tab finding its group through its native group (step 6's mapping), and
   `tabs.onUpdated` `groupId` followed in native mode. The last needs only step 6's mapping, so it may land with step 6.

Restoring containers is not a step here: it is a plan of its own (decision 4),
`docs/plans/firefox-containers-in-backups.md`.

### The checks of what is not verified

Each point the decisions mark **not verified** (or "likely", or known from the source only) is settled by an automated test
where one can be written, in the step named, and starts that step. One that cannot be automated goes in the manual test
plan below, run once the work of this plan is done. Where the table says "if the tool allows", the first thing the test
does is find out; if it cannot, the point moves to the manual plan and this table says so.

The tools: the **Chromium E2E** tests run the real extension in Playwright's Chromium (`tests/e2e/`;
`chromium-stored-data.spec.ts` already closes a profile and opens it with `--restore-last-session`). The **Firefox lab**
(`tests/e2e/lab/`) runs a real Firefox with probe extensions (MV3, with an event background) that call any API a test
asks, and sets Firefox preferences in `lab.ts` (`firefoxUserPrefs`).

| Point (decision)                                                                            | Check                                                                                                                                                                                                                                                                                                                                                                                                                                | Step  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| What an open `view.html` tab does when the add-on reloads (7)                               | **Chromium E2E:** open the view, call `chrome.runtime.reload()` in the service worker (Playwright's `serviceWorker.evaluate`), assert whether the tab is closed or what it shows. **Firefox lab, if the tool allows** reloading a temporary add-on (it installs them over the remote debugging protocol, `installTemporaryAddon`); otherwise manual (M2)                                                                             | 2     |
| `storage.session` survives the background being unloaded (5)                                | **Firefox lab:** a probe writes a value, a short idle time is set (the preference's name, expected `extensions.background.idle.timeout`, is the first thing checked), the probe's background shows it started again (a value kept only in a module variable is gone), then reads the value. **Chromium E2E, if the tool allows** stopping the service worker (the DevTools protocol's `ServiceWorker` domain); otherwise manual (M3) | 6     |
| `downloads.download` with a `blob:` or a `data:` URL from the background (7)                | **Chromium E2E:** from the service worker. **Firefox lab:** from a probe's background. Each asserts the file is complete (`downloads.search`)                                                                                                                                                                                                                                                                                        | 2     |
| `conflictAction: 'overwrite'` in Firefox (7)                                                | **Firefox lab:** a probe writes the same name twice, and `downloads.search` and the file on disk show one file with the second content                                                                                                                                                                                                                                                                                               | 2     |
| `downloads.erase` leaves the file (7)                                                       | **Chromium E2E** and **Firefox lab:** after erasing the entry, the file is still on disk                                                                                                                                                                                                                                                                                                                                             | 2     |
| Whether Firefox opens its downloads panel for a background download (7)                     | Manual (M4): the panel is the browser's own window, which no extension API reports                                                                                                                                                                                                                                                                                                                                                   | after |
| `runtime.onUpdateAvailable` under an MV3 service worker, and a real update (7)              | **Unit tests** for the listener (it backs up, then reloads only with no add-on page open). A real update cannot be offered by any test here: manual (M1)                                                                                                                                                                                                                                                                             | 2     |
| Whether a released version ran Firefox native mode without saving the option (1)            | Not a test: read from the release history (the tags and the versions published) before the first-run rule changes                                                                                                                                                                                                                                                                                                                    | 4     |
| Chromium's `tabs.group` unpins, for a new group and an existing one (6)                     | **Chromium E2E**                                                                                                                                                                                                                                                                                                                                                                                                                     | 5     |
| Pinning takes a tab out of its native group in Chromium; unpinning does not put it back (6) | **Chromium E2E**                                                                                                                                                                                                                                                                                                                                                                                                                     | 5     |
| Firefox: pinning a grouped tab, unpinning it, and the thread's unpin, group, pin again (6)  | **Firefox lab**                                                                                                                                                                                                                                                                                                                                                                                                                      | 5     |
| Restored tabs and native groups are there when `startup.ts` runs (1)                        | **Chromium E2E**, in `chromium-stored-data.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                  | 7     |
| A reopened tab: into its native group, and whether `tabs.onCreated` has `groupId` (2)       | **Chromium E2E:** `sessions.restore()`, then the group it ends in                                                                                                                                                                                                                                                                                                                                                                    | 8     |
| After a crash (1)                                                                           | **Chromium E2E, if the tool allows:** kill the browser's process, open the profile with `--restore-last-session`, then as after a restart. Firefox: manual (M5)                                                                                                                                                                                                                                                                      | 7     |
| Firefox after a restart: values back, native group ids the same (1)                         | Manual (M5): Playwright's Firefox does not restore a session (Success Criteria)                                                                                                                                                                                                                                                                                                                                                      | after |
| Whether Firefox drops a tab's values with the tab (F9)                                      | **Firefox lab:** a value on a tab, the tab closed and restored with `sessions.restore()`, the value read. Accepted as it is (F9), so not tied to a step                                                                                                                                                                                                                                                                              | any   |

#### The manual test plan (after the work of this plan)

Each is run in Firefox (the lowest version with native groups, 139, and the current release) and in Chrome (the current
release), with the add-on built from the finished work, and the result written here with the versions and the date.

- **M1. An update of the add-on.** Install a version that can be updated (Firefox: a build with
  `browser_specific_settings.gecko.update_url` pointing to an update manifest on a local server, which then offers the
  next version; Chrome: how to offer an update outside the Web Store is to be found then). With the view open, offer the
  update. Expected: a backup file is written at once; the add-on reloads only after the view is closed (Firefox); in
  Chrome, note whether it was applied at an idle unload while the view was open.
- **M2.** Only if the Firefox lab cannot reload an add-on: with the view open, reload the add-on from `about:debugging`,
  and note what the tab shows.
- **M3.** Only if a test cannot stop Chromium's service worker: write a link, wait for the service worker to stop
  (`chrome://serviceworker-internals` shows it), wake it with a tab event, and check the group's native group is still
  linked (the view shows the group in its native group without a new one being made).
- **M4. Firefox's downloads panel.** With the downloads panel closed, make a change to the groups and wait past the
  interval of decision 7. Note whether the panel opens or the toolbar's downloads button signals, and whether the entry
  stays in the downloads list after `downloads.erase`.
- **M5. Firefox: a restart and a crash.** With "Open previous windows and tabs" on, two windows each with several groups
  (some named, some with default names, one empty), and a pinned tab: quit and start Firefox; then end its process from
  the system and start it again. Each time, expected: the same groups, names, rectangles and empty groups in each window,
  every tab in its group, the native groups linked (no duplicate native group made), and the pinned tab pinned and in no
  group.
