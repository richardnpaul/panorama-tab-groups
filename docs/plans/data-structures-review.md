# Implementation Plan: A Review of the Extension's Data Structures

> **Status: Phase 1 is done and Phase 4 is done; Phases 2 and 3 are the owner's** (the decisions are listed under "Result").
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

`docs/spec.md` still describes `backgroundState` and `windowStates` in `storage.local`; the code no longer uses them.

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
(never grouped), discarded tabs, a tab dragged to another window while the extension sleeps (MV3 service worker), the
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
   The backup format stays readable (version 1 is read forever, written as the newest).

### Phase 4: Keep it true

7. `docs/spec.md` rewritten from the code (it describes keys that no longer exist), with a section "Stored data" that is
   checked by a test against the keys the adapters use.

## Risks and Mitigations

- **A migration that corrupts users' groups.** Mitigation: a backup is offered/written before a shape change; migrations
  are idempotent and tested on the old shapes, including the odd ones the readers already tolerate (a thumbnail as a plain
  string, `useDarkTheme`).
- **Churn without benefit.** Mitigation: Phase 1 decides on evidence; a finding that does not show up in the
  experiments is dropped, not fixed.
- **Reworking storage on Chromium while its extension model is also changing.** Mitigation: the work stays behind
  `GroupState` and `ViewState`; the emulation is the only part that changes shape.

## Success Criteria

- [x] The inventory and the scenario matrix are filled in and checked against the code (the keys by a test)
- [x] F1 and F2 are tested in Chromium and the results recorded here; **Firefox could not be asked about a restart**
      (Playwright's Firefox does not restore its session), which `native-groups-migration-and-user-journeys.md` also found
- [ ] A property test of the invariants exists and passes: **the data layer is covered**; the invariants over what a person does
      (no tab lost, every group exists...) need the world of fakes of the native-groups branch, and are described below
- [ ] Every persisted shape that remains has a version and a migration test: **not done, the owner's** (F7)
- [x] `docs/spec.md` matches the code and a test keeps its list of stored keys true

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

- **`tests/e2e/chromium-stored-data.spec.ts`**: two facts about the values the add-on keeps in Chromium, asked of a real
  Chromium 156 with a profile that is closed and opened again with the session restored.
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
  - The values of closed tabs and windows are **never removed** (opening and closing 14 tabs left 19 tab entries, which
    survive a restart), as `chromium-stored-data.spec.ts` shows.
  - It is an unbounded cost, not an invisible one: **every read loads the whole object**, and every tab asks for its group,
    so each costs the size of everything ever stored. In real Chromium a read of the object took 0.2 ms at 100 entries,
    1.6 ms at 1,000, 14 ms at 10,000, 75 ms at 50,000 and 155 ms at 100,000 (a write about 1.5 times that). An assignment is a
    read and a write, so at 50,000 entries recovering 100 tabs at start-up takes about 20 seconds, which is past the 10 seconds
    the extension gives itself. An entry is 27 bytes, and each tab that is ever opened adds one: at 200 new tabs a day 50,000 is reached in about eight months; the quota of
    `storage.local` (10 MB) is a long way off (370,000 entries).
  - **Thumbnails do not make it worse:** Chromium has no `tabs.captureTab`, so none is ever stored there.
  - **Ids are not reused:** the ids of tabs and windows are large and went on rising across a restart. That half of the hypothesis
    was not supported (one restart, in Playwright's Chromium).
- **F2, everything depends on ids that are not stable: confirmed, and worse than guessed, in Chromium.** A session that is
  restored brings back each tab and window **with a new id**, so the values under the old ids do not reach them. The extension
  does not find its groups, their names or their places for the restored window, and makes it one new group; the entries under
  the old ids stay for ever (F1). Chromium restores the native tab groups itself, so what a person sees is a window of native groups
  next to an add-on that has forgotten them. Firefox keeps the values with a restored window (a fact shown in the native-groups
  branch), and what it does after a full restart could not be asked.
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
- **F8, `containerId`: see F3,** it is not used.
- **F9, thumbnails as session values: Firefox only** (see F1), where the browser drops them with the tab; there is no limit
  in the extension, and the statistics page shows the total.
- **F10, ids of different kinds are all `number`: confirmed by the types;** no test.

### The scenario matrix

|                                      | Legacy mode (hide tabs)                                | Native mode                                                                                | Chromium (collapse + emulation)                                                                 |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| One profile, one window, one group   | one `groups` list with `-2` in it; tabs have `groupId` | as legacy, and the group refers to a native group once it has a tab to put in one          | the same, in `__mock_sessions`                                                                  |
| One window, many groups, many tabs   | as above                                               | only the shown group refers to a native group (`tab-moves`: the others have theirs hidden) | native groups for the shown group; nothing is hidden                                            |
| Several windows                      | the lists are per window, and group ids repeat         | a native group lives in one window; the references are per window                          | as native; the entries are by window id                                                         |
| After a restart                      | Firefox: kept with the window and tabs                 | the reference may be stale (J8 of the native-groups branch, which links it again)          | **all entries are under old ids: every group, name and place is lost** (F2); native groups stay |
| After restoring a closed window      | Firefox: values come back with it                      | the group comes back with its id in Firefox (a fact of the native-groups branch)           | new ids: as after a restart                                                                     |
| After a crash                        | as a restart                                           | as a restart                                                                               | as a restart                                                                                    |
| After an update that changes a shape | **no version to tell which shape is stored** (F7)      | the same                                                                                   | the same, and the whole object is rewritten by the next call                                    |
| With a backup imported               | a window of its own, groups renumbered by position     | the same                                                                                   | the same                                                                                        |

### Decisions for the owner (Phase 2), with a recommendation

1. **Chromium forgets its groups at every restart (F2). Recommended first.** Chromium does keep what it needs: the native tab
   groups, with the title and colour the add-on gave each (`native-group-assignment` sets both). On start, in a window that has
   native groups and none of the add-on's groups for it, **make the groups from the native groups** (title as name, the tabs in it
   as members, the tabs in none as ungrouped). It needs no new storage and no version. A cheaper partial measure is to match
   restored tabs to the old entries by address and place in the window.
2. **Prune the emulation (F1), after 1.** Once restored tabs are matched or rebuilt, every entry whose tab or window is not open
   is an orphan: remove them at start. Without 1 it throws away the only copy, so the order matters.
3. **A version for the stored data (F7)** before any change of shape: one number under one key in `storage.local`, read at
   start, with a migration for each step, and the backup (which already has one) written from it.
4. **`containerId` (F3, F8):** remove it from the type and the guard, or give it its one value. It is never read.
5. **Move `nativeGroupId` out of the stored group (F3, F2):** the groups of the add-on keep what the user owns, and the link to
   the browser's groups is rebuilt at start (the journeys of the native-groups branch have `relink` for it).

### The property test of the invariants that is still to write

The plan asks for random sequences of what a person does (open and close tabs and windows, move tabs, make and delete groups,
restart) with invariants: every tab has a group that exists, the active group exists, no two groups of a window share an id,
every `nativeGroupId` is real or dropped, no tab is lost. It needs a browser that holds tabs, windows and native groups
together, which is the world of fakes in `tests/support/world` of **`fix/native-groups-migration-user-journeys`**; with
`createWorld()` it is about forty lines of fast-check (an action is a call of the world, the invariants are reads of it).
It was not written here, to keep this branch independent of that one, and is the natural first test to add once it is in.
