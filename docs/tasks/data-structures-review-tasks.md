# Task Breakdown: `data-structures-review.md` Post-Review Fixes

> **Purpose:** Track the resolution of findings from the codebase audit against [`docs/plans/data-structures-review.md`](../plans/data-structures-review.md).
> Tasks are partitioned into **9 self-contained chunks** with disjoint file scopes so each chunk can be implemented, tested, and verified independently without merge or logical conflicts.

---

## Chunk Overview & Independence Matrix

| Chunk       | Scope                                                          | Primary Production Files Touched                                                                                    | Overlaps With Other Chunks?                                         | Status      |
| :---------- | :------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------ | :---------- |
| **Chunk 1** | Governance & External Agent Hygiene                            | `.agents/agents/code-reviewer.md`                                                                                   | None                                                                | `[x] Done`  |
| **Chunk 2** | View & Popup Store / UI Edge Cases                             | `src/js/app/stored-groups-wait.ts`                                                                                  | None                                                                | `[x] Done`  |
| **Chunk 3** | Automatic Backups & Add-on Update Concurrency                  | `src/js/app/addon-update.ts`, `src/js/app/auto-backup.ts`                                                           | None                                                                | `[x] Done`  |
| **Chunk 4** | Chromium Window Rebuild Matching & Toolbar Sync                | `src/js/app/window-rebuild.ts`, `src/js/app/window-groups.ts`                                                       | None                                                                | `[ ] To Do` |
| **Chunk 5** | Startup, Migrations & Emulation Zombie Prevention              | `src/js/app/startup.ts`, `src/js/app/migrations.ts`, `src/js/adapters/browser/sessions-emulation.ts`                | None                                                                | `[ ] To Do` |
| **Chunk 6** | Native Group Sync (`relinkWindow` & Firefox `cleanup`)         | `src/js/app/native-groups-sync.ts`                                                                                  | None                                                                | `[ ] To Do` |
| **Chunk 7** | Background Tab Lifecycle, `deleteGroup` & `onTabUpdated` Races | `src/js/app/browser-events.ts`, `src/js/app/tab-lifecycle.ts`, `src/js/app/delete-group.ts`                         | None                                                                | `[ ] To Do` |
| **Chunk 8** | View Drag Native Sync & Context Menu Pinned Active Move        | `src/js/app/tab-moves.ts`, `src/js/view/drag.ts`, `src/js/app/message-handler.ts`                                   | None (run after Chunk 7 if sharing `ownMoves` / `moveTab` patterns) | `[ ] To Do` |
| **Chunk 9** | Test Model (`world.ts`), Property Generator & Test Timeouts    | `tests/support/world/world.ts`, `tests/unit/journeys/random-actions.property.test.ts`, `tests/unit/*/start.test.ts` | None (best run after Chunks 2–8)                                    | `[ ] To Do` |

---

## Workflow Per Chunk

Every chunk must follow the repository's TDD and Verification & Validation rules:

1. **Red:** Write or update unit/property/E2E tests that reproduce the finding and fail on the current code.
2. **Green:** Implement the minimal fix behind the port/service boundary.
3. **Gates (per chunk):**
   - `npm run format`
   - `npm run lint`
   - `npx vitest run --coverage --maxWorkers=2` (100% Statements, Branches, Functions, Lines)
   - `MUTATE=<touched-files> npm run test:mutation` (100% mutation score on touched files)
4. **Update Status:** Mark the chunk `[x] Done` in this file.

---

## Chunk Details

### Chunk 1: Governance & External Agent Hygiene

- **Status:** `[x] Done`
- **Touched Files:**
  - `.agents/agents/code-reviewer.md`
- **Findings Addressed:**
  - **1.1 (HIGH — External Source Integrity):** Line 33 of `.agents/agents/code-reviewer.md` was modified from `- **Report** if you are >80% confident it is a real issue` to `- **Report** if you are >95% confident it is a real issue`. Per `.agents/rules/verification-validation-rules.md` Section 4 and `.agents/EXTERNAL-SOURCES.md` (`9dd23be23d65f181`), imported agent files must differ from upstream only by Prettier.
- **Action Steps:**
  - [x] Restore `.agents/agents/code-reviewer.md` via `git checkout -- .agents/agents/code-reviewer.md`.
  - [x] Verify with `git diff .agents/agents/code-reviewer.md` and `npm run lint:prettier`.

---

### Chunk 2: View & Popup Store / UI Edge Cases

- **Status:** `[x] Done`
- **Touched Files:**
  - `src/js/app/stored-groups-wait.ts`
  - `tests/unit/app/stored-groups-wait.test.ts`
- **Findings Addressed:**
  - **2.1 (MEDIUM — `waitForStoredGroups` system group false positive):** In `src/js/app/stored-groups-wait.ts:22-25`, `groups !== undefined && groups.length > 0` returned immediately when `stateManager` (`withUngroupedGroup`) returned `[{ id: -2, ... }]` before any user group (`id >= 0`) existed, causing `groupsStore.load()` to render an empty group list.
    - _Fix:_ Updated `waitForStoredGroups` to check `groups !== undefined && groups.some(({ id }) => !isReservedGroupId(id))` and added TDD unit test in `tests/unit/app/stored-groups-wait.test.ts`.
  - **2.2 (Closed as False Positive with Evidence — Popup refresh on delete):** `tests/unit/popup/groups-frame.test.ts:565-573` (`it('does not show the groups again while some are left')`) and `docs/plans/data-structures-review.md:783-785` (Round 11) explicitly specify that `showAgain()` is only invoked when the last group in the list is deleted (`list.querySelector('.list__item') === null`) so the new first group created by the background is shown.
  - **2.3 (Closed as False Positive with Evidence — `GroupsStore.transform` / `moveTo` & `groupNodes.raise`):** `docs/plans/data-structures-review.md:773-780` (Rounds 9–10) and `tests/unit/app/groups-store.test.ts:523-543` explicitly specify that `transform` and `moveTo` update the view's in-memory groups immediately to stay in sync with the already-moved DOM node while only `save` waits its turn. `groupNodes.raise` is unchanged from `main` and intentionally updates only the session z-index without triggering storage writes or automatic backup notifications on every click.
- **Verification:**
  - [x] `npx vitest run tests/unit/app/stored-groups-wait.test.ts --coverage` (100% coverage)
  - [x] `MUTATE="src/js/app/stored-groups-wait.ts" npm run test:mutation` (100% mutation score)

---

### Chunk 3: Automatic Backups & Add-on Update Concurrency

- **Status:** `[x] Done`
- **Touched Files:**
  - `src/js/app/addon-update.ts`
  - `src/js/app/auto-backup.ts`
  - `tests/unit/app/addon-update.test.ts`
  - `tests/unit/app/auto-backup.test.ts`
- **Findings Addressed:**
  - **3.1 (MEDIUM — Concurrent `tabRemoved` calls `extension.reload()` multiple times):** In `src/js/app/addon-update.ts:41-57, 77-85`, `waiting = false` was set after `await isWaiting()` and `await tabs.idsOfAddressesUnder(...)`. When multiple tabs closed simultaneously (e.g., closing a window), two `tabRemoved` events could both observe `open.length === 0` and call `extension.reload()` twice.
    - _Fix:_ Serialized update check and reload execution via `inTurn` in `src/js/app/addon-update.ts` and added TDD unit test in `tests/unit/app/addon-update.test.ts`.
  - **3.2 (MEDIUM — `writeIfDue` and `whenQuiet` check `wroteRecently()` outside `queue`):** In `src/js/app/auto-backup.ts:73, 145-181`, `wroteRecently()` read `log.read()` before chaining onto `queue`. If a backup write was in flight on `queue`, `log` still held the previous `last` timestamp, so a second duplicate backup was queued right behind the in-flight write.
    - _Fix:_ Evaluated `wroteRecently()` inside the serialized `inTurn` queue in `writeIfDue` and `whenQuiet` in `src/js/app/auto-backup.ts`, and added TDD unit tests in `tests/unit/app/auto-backup.test.ts`.
- **Verification:**
  - [x] `npx vitest run tests/unit/app/addon-update.test.ts tests/unit/app/auto-backup.test.ts --coverage` (100% coverage)
  - [x] `MUTATE="src/js/app/addon-update.ts,src/js/app/auto-backup.ts" npm run test:mutation` (100% mutation score)

---

### Chunk 4: Chromium Window Rebuild Matching & Toolbar Sync

- **Status:** `[ ] To Do`
- **Touched Files:**
  - `src/js/app/window-rebuild.ts`
  - `src/js/app/window-groups.ts`
  - `tests/unit/app/window-rebuild.test.ts`
  - `tests/unit/app/window-groups.test.ts`
- **Findings Addressed:**
  - **4.1 (HIGH — Tie-breaking prefers oldest closed window from days ago over open-at-quit or most-recently-closed window):** In `src/js/app/window-rebuild.ts:144-204`, `closedWindows()` returns all non-open stored windows without checking `getClosedAt(windowId)` or filtering out windows older than `CLOSED_WINDOW_KEPT_MS` (7 days). When two candidate windows tie on `leftOver` and `active` (such as windows with default group names `"Group 0"`), `better` sorts by `first.closed.windowId - second.closed.windowId`, picking the oldest window closed days ago (smallest `windowId`) ahead of the window that was open when the browser quit (`closedAt === undefined`) or closed most recently.
    - _Fix:_ Read `closedAt` for stored candidate windows, filter out entries expired past `CLOSED_WINDOW_KEPT_MS`, and rank open-at-quit (`closedAt === undefined`) ahead of closed windows, then most-recently-closed (`closedAt` descending), before falling back to `windowId`.
  - **4.2 (HIGH — `Set` vs. multiset matching in `fitOf`):** In `src/js/app/window-rebuild.ts:164-176`, `fitOf` uses `new Set(...)` on `closed.groups.map(titleOf)` and `restored.natives.map(({ title }) => title)`. If a restored window has two native groups titled `"Work"` and an old window has only one `"Work"`, `fitOf` falsely considers the old window a fit.
    - _Fix:_ Verify multiset inclusion (every native group title in `restored.natives` can be matched one-to-one with a group in `closed.groups`) and compute `leftOver` as `closed.groups.length - restored.natives.length`.
  - **4.3 (MEDIUM — `createGroupInWindowIfMissing` resets toolbar title after `rebuildWindow` succeeds):** In `src/js/app/window-groups.ts:97-103`, after `await rebuildWindow(windowId)` returns `true` and sets `activeGroup`, line 103 still executes `await toolbar.showNoActiveGroup(windowId)`.
    - _Fix:_ Do not overwrite the rebuilt window's toolbar title with `showNoActiveGroup` when `rebuildWindow(windowId)` returns `true`.
- **Verification:**
  - [ ] `npx vitest run tests/unit/app/window-rebuild.test.ts tests/unit/app/window-groups.test.ts`
  - [ ] `MUTATE="src/js/app/window-rebuild.ts,src/js/app/window-groups.ts" npm run test:mutation`

---

### Chunk 5: Startup, Migrations & Emulation Zombie Prevention

- **Status:** `[ ] To Do`
- **Touched Files:**
  - `src/js/app/startup.ts`
  - `src/js/app/migrations.ts`
  - `src/js/adapters/browser/sessions-emulation.ts`
  - `tests/unit/app/startup.test.ts`
  - `tests/unit/app/migrations.test.ts`
  - `tests/unit/adapters/browser/sessions-emulation.test.ts`
- **Findings Addressed:**
  - **5.1 (HIGH — Chromium restart runs `migrations.atStart()` before `windowRebuild.rebuildAll()` and leaves `archive` unmigrated):** In `src/js/app/startup.ts:55-59` and `src/js/app/migrations.ts:160-182`:
    1. On a Chromium restart, restored windows have new window IDs while stored groups are under old window IDs in `__mock_sessions` (`groupState.listStoredWindowIds()`).
    2. `migrations.atStart()` only queries `windows.listIds()`, sees `undefined` groups on all new window IDs, skips `autoBackup.writeIfDue(...)`, and stamps `schemaVersion = 5` on the empty new window IDs.
    3. `windowRebuild.rebuildAll()` then copies unmigrated `closed.groups` (still carrying `containerId`) from `archive` into the already-"migrated" new window IDs, bypassing `dropContainers` (v1→v2). The same bypass occurs when reopening a pre-v2 closed window via `rebuildWindow(windowId)`.
    - _Fix:_ Ensure `windowRebuild.rebuildAll()` runs before (or in coordination with) `migrations.atStart()`, and ensure stored windows in `__mock_sessions` (`listStoredWindowIds()`) are migrated (stripping `containerId`) so neither startup rebuild nor runtime `rebuildWindow` copies unmigrated v1 groups.
  - **5.2 (MEDIUM — `migrate(windowId)` writes zombie `{ schemaVersion: 5 }` into `privateSessions` for closed/empty windows):** In `src/js/app/migrations.ts:118-133`, `migrate(windowId)` unconditionally calls `setSchemaVersion(windowId, DATA_VERSION)` even when the window has no stored groups (`getGroups(windowId) === undefined`) and is already closed. In Chromium, `sessions-emulation.ts:179-184` catches `windows.get(windowId)` rejecting and writes a zombie entry into `privateSessions`.
    - _Fix:_ Only write `setSchemaVersion` when the window actually has stored groups or is currently open (or avoid migrating unstored closed windows).
  - **5.3 (LOW — `sessions-emulation.ts` `ids()` coerces empty/whitespace keys to `0`):** In `src/js/adapters/browser/sessions-emulation.ts:221-226`, `Object.keys(...).map(Number).filter((id) => Number.isInteger(id))` turns `""` into `0`.
    - _Fix:_ Filter keys with `/^-?\d+$/u` before `Number(...)` (matching `group-state.ts:87`).
  - **5.4 (LOW — Early startup rejection leaves `waitForInitialization()` blocked for 11s):** In `src/js/app/startup.ts:52-63`, if `firstRun.decideNativeGroups()`, `migrations.atStart()`, or `windowRebuild.rebuildAll()` rejects before `recovery.initializeTabGroupAssignments()`, `initialization.finish()` is never called.
    - _Fix:_ Ensure `recovery.initializeTabGroupAssignments()` (or `initialization.finish()`) is still reached or guarded so event handlers are not stranded until timeout.
- **Verification:**
  - [ ] `npx vitest run tests/unit/app/startup.test.ts tests/unit/app/migrations.test.ts tests/unit/adapters/browser/sessions-emulation.test.ts`
  - [ ] `MUTATE="src/js/app/startup.ts,src/js/app/migrations.ts,src/js/adapters/browser/sessions-emulation.ts" npm run test:mutation`

---

### Chunk 6: Native Group Sync (`relinkWindow` & Firefox `cleanup`)

- **Status:** `[ ] To Do`
- **Touched Files:**
  - `src/js/app/native-groups-sync.ts`
  - `src/js/background/compose.ts` (if `toggleVisibleTabs` needs to be passed to `createNativeGroupsSync`)
  - `tests/unit/app/native-groups-sync.test.ts`
- **Findings Addressed:**
  - **6.1 (MEDIUM — `relinkWindow` links a group even when some of its tabs are ungrouped or when another group spans 2+ native groups):** In `src/js/app/native-groups-sync.ts:218-240`:
    1. `nativeIdsOf` filters out tabs where `browserGroupId === -1` (`undefined`), so a group with 1 tab in native group `50` and 1 ungrouped tab (`-1`) gets `ids = [50]` (`ids.length === 1`), links to `50`, and is skipped by `migrate()`, leaving its second tab permanently outside the native group.
    2. `shared` is computed only after collapsing multi-group `ids` (`ids.length !== 1`) to `undefined` and filtering out `-2`, so a native group shared between Group 0 (`[500]`) and Group 1 (`[500, 600]`) or `-2` (`[500]`) is not detected as shared.
    - _Fix:_ Include `-1` (ungrouped) in a group's distinct tab states when deciding whether _all_ of its tabs are in a single native group, and compute `shared` from all native group IDs present across all groups (including `-2` and groups spanning multiple native groups).
  - **6.2 (MEDIUM — Switching Native Groups OFF in Firefox (`cleanup`) does not hide inactive groups' tabs, and `cleaning` flag is not re-entrant):** In `src/js/app/native-groups-sync.ts:90, 306-351`:
    1. When native groups are turned off in Firefox, `cleanup()` removes all tabs from their native groups (expanding inactive groups into the tab strip), but never calls `toggleVisibleTabs` (or hides tabs of inactive groups) for Legacy Mode.
    2. `let cleaning = false` is reset in `finally` by whichever concurrent `cleanup()` call finishes first.
    - _Fix:_ Serialize/deduplicate concurrent `cleanup()` calls via an in-flight promise (or `inTurn`) and apply visibility (`toggleVisibleTabs(shown, windowId)`) per window after ungrouping.
- **Verification:**
  - [ ] `npx vitest run tests/unit/app/native-groups-sync.test.ts`
  - [ ] `MUTATE="src/js/app/native-groups-sync.ts" npm run test:mutation`

---

### Chunk 7: Background Tab Lifecycle, `deleteGroup` & `onTabUpdated` Races

- **Status:** `[ ] To Do`
- **Touched Files:**
  - `src/js/app/browser-events.ts`
  - `src/js/app/tab-lifecycle.ts`
  - `src/js/app/delete-group.ts`
  - `src/js/background/compose.ts` (if `ownMoves` is injected into `createTabLifecycle` / `createGroupDeletion`)
  - `tests/unit/app/browser-events.test.ts`
  - `tests/unit/app/tab-lifecycle.test.ts`
  - `tests/unit/app/delete-group.test.ts`
- **Findings Addressed:**
  - **7.1 (HIGH — `tabAttached` and `deleteGroup` trigger `tabs.onUpdated({ groupId: -1 })` without `ownMoves`):**
    1. In `src/js/app/tab-lifecycle.ts:330-353`, moving a grouped tab across windows fires `tabs.onUpdated({ groupId: -1 })`. `tabAttached` sets `setTabGroup(tabId, activeGroup)` and awaits `tabCreated(tab)` without `ownMoves.during([tabId], ...)`, allowing `followNativeGroupOf` to overwrite the tab's group in the new window with `-2`.
    2. In `src/js/app/delete-group.ts:62`, `ungroupTabs` calls `nativeGroups.removeTabs(inGroup)` without `ownMoves.during(inGroup, ...)`, racing with `closeTabs` and `tabClosed` to write `-2` into `privateSessions`.
    - _Fix:_ Wrap `tabAttached` and `deleteGroup`'s `removeTabs` in `ownMoves.during(...)`.
  - **7.2 (MEDIUM — `onTabUpdated` in `browser-events.ts` misses `now.pinned` and early-returns after `changeInfo.groupId`):** In `src/js/app/browser-events.ts:158-214`:
    1. `followNativeGroupOf` checks `if (tab.pinned === true)` before `await tabs.get(tabId)`, but never checks `if (now.pinned) return;` after `tabs.get(tabId)` resolves (and passes `tab.windowId` instead of `now.windowId`).
    2. `if (changeInfo.groupId !== undefined)` returns early on line 189 before checking `if (changeInfo.pinned !== undefined)` on line 191.
    3. `unpinned()` (`L114`) does not check `groups.some(({ id }) => id === active)` if `active` points to a deleted group.
    4. The `isView` branch (`L198`) does not await `waitForInitialization()`.
    - _Fix:_ Check `if (now.pinned) return;` and use `now.windowId` in `followNativeGroupOf`; allow both `groupId` and `pinned` handlers to run if both are present; validate `active` against `groups` in `unpinned()`; await `waitForInitialization()` in `isView`.
  - **7.3 (MEDIUM — Reopening a closed tab into a recreated/unlinked native group pulls it into `activeGroup`'s native group):** In `src/js/app/tab-lifecycle.ts:95-193`, if all tabs of Group 1 (`"Alpha"`) were closed (clearing its `nativeGroupId` link) and a tab is reopened via `Ctrl+Shift+T`, Chromium recreates native group `"Alpha"` with a new `nativeGroupId`. `groupOfNativeGroup` sees no link, assigns `activeGroup`, and `assignNewTabToNativeGroup` pulls the tab out of `"Alpha"` into `activeGroup`'s native group.
    - _Fix:_ When `tab.browserGroupId > 0` has no existing link in `groupState`, check if an unlinked group in `groups` matches the native group's title (via `nativeGroups.get(tab.browserGroupId)`) and link/assign it, or avoid pulling a tab that already has `tab.browserGroupId > 0` into a different group's native group.
- **Verification:**
  - [ ] `npx vitest run tests/unit/app/browser-events.test.ts tests/unit/app/tab-lifecycle.test.ts tests/unit/app/delete-group.test.ts`
  - [ ] `MUTATE="src/js/app/browser-events.ts,src/js/app/tab-lifecycle.ts,src/js/app/delete-group.ts" npm run test:mutation`

---

### Chunk 8: View Drag Native Sync & Context Menu Pinned Active Move

- **Status:** `[ ] To Do`
- **Touched Files:**
  - `src/js/app/tab-moves.ts`
  - `src/js/view/drag.ts`
  - `src/js/app/message-handler.ts` (if view drag notifies or delegates to background `ownMoves` / `moveTab`)
  - `tests/unit/app/tab-moves.test.ts`
  - `tests/unit/view/drag.test.ts`
- **Findings Addressed:**
  - **8.1 (HIGH — Dragging a tab between groups in `view.html` triggers `followNativeGroupOf` in the background and overwrites the tab's group to `-2`, and leaves native groups out of sync):** In `src/js/view/drag.ts:54, 72-121, 224-238`, `putTabInGroup` and `dropOnTab` run in the `view.html` page process with a page-local `ownMoves` counter, call `groupState.setTabGroup(tabId, groupId)`, and call `tabs.moveTo(tabId, -1)`. In Chromium, moving a grouped tab past its native group fires `tabs.onUpdated({ groupId: -1 })` in the background (where `ownMoves.includes(tabId)` is `false`), which overwrites the tab's group to `-2` (`UNGROUPED_GROUP_ID`). Furthermore, `view/drag.ts` never puts the moved tab into the target group's native group.
    - _Fix:_ Coordinate tab group moves from `view/drag.ts` with the background (or sync native group membership and background `ownMoves`) so dragging a tab in `view.html` updates the target group's native group and is not clobbered to `-2` by `followNativeGroupOf`.
  - **8.2 (MEDIUM — `moveActiveTab` in `tab-moves.ts` fails when the active tab being moved via context menu is pinned):** In `src/js/app/tab-moves.ts:192-212, 249-251`, when the active tab is pinned (`own === undefined`), `moveActiveTab` looks for neighbours with `getTabGroup(id) === undefined` (only pinned tabs) instead of unpinned tabs in the window's shown group (`activeGroup`), leaving the moved tab active while trying to hide/collapse it in the target group.
    - _Fix:_ When `own === undefined` (pinned tab), look for a neighbour in the window's `activeGroup` (or among visible unpinned tabs) so focus shifts before moving the tab to an inactive group.
- **Verification:**
  - [ ] `npx vitest run tests/unit/app/tab-moves.test.ts tests/unit/view/drag.test.ts`
  - [ ] `MUTATE="src/js/app/tab-moves.ts,src/js/view/drag.ts" npm run test:mutation`

---

### Chunk 9: Test Model (`world.ts`), Property Generator & Test Timeouts

- **Status:** `[ ] To Do`
- **Touched Files:**
  - `tests/support/world/world.ts`
  - `tests/unit/journeys/random-actions.property.test.ts`
  - `tests/unit/view/start.test.ts`
  - `tests/unit/popup/start.test.ts`
  - `tests/unit/options/start.test.ts`
  - `tests/unit/migration-status/start.test.ts`
- **Findings Addressed:**
  - **9.1 (LOW — `world.deleteGroup` still simulates the pre-Round-11 view bug):** In `tests/support/world/world.ts:405-412`, `world.deleteGroup` still overwrites `activeGroup` with `first.id` when `tabIds.length > 0`, which was removed from `src/js/view/group-nodes.ts` in Review Round 11.
    - _Fix:_ Remove lines 405–412 in `tests/support/world/world.ts` so `world.deleteGroup` matches the real view and popup.
  - **9.2 (LOW — `random-actions.property.test.ts` lacks `createGroup` and `renameGroup` actions):** Adding `createGroup` and `renameGroup` exercises 3+ groups per window and custom group titles across restarts.
  - **9.3 (LOW — Dynamic `import()` timeout in `tests/unit/*/start.test.ts` under heavy parallel Istanbul coverage):** Increase the timeout (or pre-import) on the initial `start.test.ts` test cases so `npm test` under full CPU load never hits the 5,000 ms default timeout.
- **Verification:**
  - [ ] `npm test`
