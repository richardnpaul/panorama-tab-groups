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
| **Chunk 4** | Chromium Window Rebuild Matching & Toolbar Sync                | `src/js/app/window-rebuild.ts`                                                                                      | None                                                                | `[x] Done`  |
| **Chunk 5** | Startup, Migrations & Emulation Zombie Prevention              | `src/js/app/migrations.ts`, `src/js/adapters/browser/sessions-emulation.ts`                                         | None                                                                | `[x] Done`  |
| **Chunk 6** | Native Group Sync (`relinkWindow` & Firefox `cleanup`)         | `src/js/app/native-groups-sync.ts`                                                                                  | None                                                                | `[x] Done`  |
| **Chunk 7** | Background Tab Lifecycle, `deleteGroup` & `onTabUpdated` Races | `src/js/app/browser-events.ts`, `src/js/app/tab-lifecycle.ts`, `src/js/app/delete-group.ts`                         | None                                                                | `[x] Done`  |
| **Chunk 8** | View Drag Native Sync & Context Menu Pinned Active Move        | `src/js/app/tab-moves.ts`, `src/js/view/drag.ts`, `src/js/app/message-handler.ts`                                   | None (run after Chunk 7 if sharing `ownMoves` / `moveTab` patterns) | `[x] Done`  |
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

- **Status:** `[x] Done`
- **Touched Files:**
  - `src/js/app/window-rebuild.ts`
  - `tests/unit/app/window-rebuild.test.ts`
- **Findings Addressed:**
  - **4.1 (HIGH — Tie-breaking prefers oldest closed window from days ago over open-at-quit or most-recently-closed window):** In `src/js/app/window-rebuild.ts:144-204`, `closedWindows()` did not read `getClosedAt(windowId)`. When two candidate windows tied on `leftOver` and `active` (such as windows with default group names `"Group 0"`), `better` sorted by `first.closed.windowId - second.closed.windowId`, picking a window closed days ago (smaller `windowId`) ahead of a window that was still open when the browser quit (`closedAt === undefined`) or closed more recently.
    - _Fix:_ Read `getClosedAt(windowId)` in `closedWindows()` (defaulting open-at-quit `undefined` to `Number.MAX_SAFE_INTEGER`) and rank by `second.closed.closedAt - first.closed.closedAt` in `better` before falling back to `windowId`; added TDD unit test in `tests/unit/app/window-rebuild.test.ts`.
  - **4.2 (Closed as False Positive with Evidence — `Set` vs. multiset matching in `fitOf`):** `docs/plans/data-structures-review.md:369-371` ("its stored groups' names include every native group's title ... an exact set of titles first") and `tests/unit/app/window-rebuild.test.ts:402-419` (`it('give a group to the first of two native groups with one title, and one of its own to the other')`) explicitly specify and test that a restored window with two native groups sharing one title (`'Work'`) matches a kept window with one `'Work'` group, giving the kept group to the first native group (`claimed.has(only.id)` in `src/js/app/window-rebuild.ts:214`) and creating a new group for the second.
  - **4.3 (Closed as False Positive with Evidence — `createGroupInWindowIfMissing` calling `toolbar.showNoActiveGroup`):** `src/js/app/window-groups.ts:39-43` and `tests/unit/app/window-groups.test.ts:226-234` (`it('shows that the window has no active group yet, either way')`) explicitly specify and test that `createGroupInWindowIfMissing` calls `toolbar.showNoActiveGroup(windowId)` even when a window already has groups.
- **Verification:**
  - [x] `npx vitest run tests/unit/app/window-rebuild.test.ts --coverage` (100% coverage)
  - [x] `MUTATE="src/js/app/window-rebuild.ts" npm run test:mutation` (100% mutation score)

---

### Chunk 5: Startup, Migrations & Emulation Zombie Prevention

- **Status:** `[x] Done`
- **Touched Files:**
  - `src/js/app/migrations.ts`
  - `src/js/adapters/browser/sessions-emulation.ts`
  - `tests/unit/app/migrations.test.ts`
  - `tests/unit/adapters/browser/sessions-emulation.test.ts`
- **Findings Addressed:**
  - **5.1 (HIGH — Chromium restart runs `migrations.atStart()` without migrating stored windows in `__mock_sessions`):** In `src/js/app/migrations.ts:165-181`, `migrations.atStart()` only queried `windows.listIds()`, ignoring `groupState.listStoredWindowIds()`. On a Chromium restart (where restored windows have new IDs and old windows are in `listStoredWindowIds()`) or when a closed window from v1 was kept in `__mock_sessions`, `migrations.atStart()` missed those stored windows, skipped `autoBackup.writeIfDue(...)` when open windows had no stored groups yet, and left `archive` unmigrated so `windowRebuild` copied v1 groups with `containerId`.
    - _Fix:_ Combined `await windows.listIds()` and `await groupState.listStoredWindowIds()` (`new Set(...)`) in `migrations.atStart()` so all stored windows are backed up and migrated at startup before `windowRebuild.rebuildAll()` or `rebuildWindow()` reads `archive`; added TDD unit test in `tests/unit/app/migrations.test.ts`.
  - **5.2 (Closed as False Positive with Evidence — `migrate(windowId)` setting `schemaVersion` on windows without stored groups):** `tests/unit/app/migrations.test.ts:124-131` (`it('notes the version of a window that has nothing stored yet')`) and `tests/unit/adapters/browser/sessions-emulation.test.ts:528-540` (`it('keeps apart what cannot be asked about, as a window that has closed')`) explicitly specify and test this behaviour, and `closedWindows.prune()` (`src/js/app/closed-windows.ts:160-162`) removes all non-open `privateWindowIds`.
  - **5.3 (LOW — `sessions-emulation.ts` `ids()` coerces empty/whitespace keys to `0`):** In `src/js/adapters/browser/sessions-emulation.ts:221-226`, `Object.keys(...).map(Number).filter((id) => Number.isInteger(id))` turned `""` and whitespace strings into integer keys (`0`, `5`).
    - _Fix:_ Filtered keys with `WHOLE_NUMBER_TEXT` (`/^-?\d+$/`) before `.map(Number)` in `src/js/adapters/browser/sessions-emulation.ts`, and added TDD unit test cases in `tests/unit/adapters/browser/sessions-emulation.test.ts`.
  - **5.4 (Closed as False Positive with Evidence — `startup.ts` error propagation):** `tests/unit/app/startup.test.ts:80-106` (`it.each(steps)('stops where %s fails, and says so by failing')`) explicitly specifies that `startup.ts` stops and rejects when any step rejects, while `migrations.atStart()` (`src/js/app/migrations.ts:145,187`) and `windowRebuild.rebuildAll()` (`src/js/app/window-rebuild.ts:336-340`) already catch and log their own internal errors.
- **Verification:**
  - [x] `npx vitest run tests/unit/app/migrations.test.ts tests/unit/adapters/browser/sessions-emulation.test.ts --coverage` (100% coverage)
  - [x] `MUTATE="src/js/app/migrations.ts,src/js/adapters/browser/sessions-emulation.ts" npm run test:mutation` (100% mutation score)

---

### Chunk 6: Native Group Sync (`relinkWindow` & Firefox `cleanup`)

- **Status:** `[x] Done`
- **Touched Files:**
  - `src/js/app/native-groups-sync.ts`
  - `tests/unit/app/native-groups-sync.test.ts`
- **Findings Addressed:**
  - **6.1 (MEDIUM — `relinkWindow` misses shared native groups when one of the sharing groups spans 2+ native groups):** In `src/js/app/native-groups-sync.ts:230-240`, `shared` was computed only after collapsing multi-group `ids` (`ids.length !== 1`) to `undefined`, so a native group shared between Group 3 (`[88]`) and Group 4 (`[88, 99]`) was not detected as shared and Group 3 was linked to `88`. (Note: linking a group whose grouped tabs are in one native group while some of its tabs are ungrouped is explicitly required by `tests/unit/app/native-groups-sync.test.ts:139-153`, `it('links a group to the native group of the tabs it has in one, though some are in none')`, and closed as a false positive with that evidence.)
    - _Fix:_ Computed `shared` from `found.flatMap(({ ids }) => ids)` before collapsing `ids` to `link` in `src/js/app/native-groups-sync.ts`, and added a TDD unit test in `tests/unit/app/native-groups-sync.test.ts`.
  - **6.2 (MEDIUM — Concurrent `cleanup()` calls race and reset `cleaning` early):** When `useNativeGroups` is switched off in Options, `storage.onChanged` (`browser-events.ts:239`) and `{ action: 'cleanupNativeGroups' }` (`message-handler.ts:67`) both invoke `nativeGroupsSync.cleanup()` concurrently (`tests/support/world/world.ts:441-454`). With `let cleaning = false`, both ran `cleanWindow` in parallel and the first to finish reset `cleaning = false` in `finally` while the second was still running. (Note: `cleanup()` intentionally does not call `toggleVisibleTabs` because the Options tab or another tab may be active when the setting is toggled, as specified in `J6 switching native groups off` and `docs/plans/data-structures-review.md:806`.)
    - _Fix:_ Replaced `let cleaning = false` with an in-flight `let cleaning: Promise<void> | undefined` in `src/js/app/native-groups-sync.ts` so concurrent `cleanup()` calls share the single running cleanup promise; added a TDD unit test in `tests/unit/app/native-groups-sync.test.ts`.
- **Verification:**
  - [x] `npx vitest run tests/unit/app/native-groups-sync.test.ts --coverage` (100% coverage)
  - [x] `MUTATE="src/js/app/native-groups-sync.ts" npm run test:mutation` (100% mutation score)

---

### Chunk 7: Background Tab Lifecycle, `deleteGroup` & `onTabUpdated` Races

- **Status:** `[x] Done`
- **Touched Files:**
  - `src/js/app/browser-events.ts`
  - `src/js/app/tab-lifecycle.ts`
  - `src/js/app/delete-group.ts`
  - `src/js/background/compose.ts`
  - `tests/unit/app/browser-events.test.ts`
  - `tests/unit/app/tab-lifecycle.test.ts`
  - `tests/unit/app/delete-group.test.ts`
- **Findings Addressed:**
  - **7.1 (HIGH — `tabAttached` and `deleteGroup` trigger `tabs.onUpdated({ groupId: -1 })` without `ownMoves`):**
    - _Fixed:_ Wrapped `tabAttached` (`src/js/app/tab-lifecycle.ts:336-358`) and `deleteGroup`'s `nativeGroups.removeTabs(inGroup)` (`src/js/app/delete-group.ts:66`) in `ownMoves.during(...)`, wired `ownMoves` into `createTabLifecycle` and `createGroupDeletion` in `src/js/background/compose.ts`, and added TDD tests in `tests/unit/app/tab-lifecycle.test.ts` and `tests/unit/app/delete-group.test.ts`.
  - **7.2 (MEDIUM — `onTabUpdated` in `browser-events.ts` misses `now.pinned` and early-returns after `changeInfo.groupId`):**
    - _Fixed:_ Checked `if (now !== undefined && !now.pinned)` in `followNativeGroupOf`, ordered `if (changeInfo.pinned !== undefined)` before `if (changeInfo.groupId !== undefined)` so coalesced `{ pinned: true, groupId: -1 }` updates clear the pinned tab's group, validated `active` against `groups` (`groups?.some(({ id }) => id === active) === false`) in `unpinned()`, and awaited `waitForInitialization()` in the `isView` branch in `src/js/app/browser-events.ts`. Added TDD tests in `tests/unit/app/browser-events.test.ts`.
  - **7.3 (MEDIUM — Reopening a closed tab into an unlinked native group):**
    - _Closed as False Positive with Evidence:_ `docs/plans/data-structures-review.md:403-407` explicitly specifies: _"If Chromium reopens it inside a native group (`tab.browserGroupId !== -1` ...), the tab goes to the group linked to that native group in decision 5's mapping. Otherwise it goes to the active group, as every tab does today (`tab-lifecycle.ts`, `groupOfNewTab`)."_ Furthermore, `tests/unit/app/tab-lifecycle.test.ts:185-196` (`it('is in the group the window shows when no group goes with the native group it is in')`) directly tests and requires that a tab created with an unlinked `browserGroupId` (`77`) is assigned to `activeGroup` (`1`).
- **Verification:**
  - [x] `npx vitest run tests/unit/app/browser-events.test.ts tests/unit/app/tab-lifecycle.test.ts tests/unit/app/delete-group.test.ts tests/unit/background/compose.test.ts --coverage` (100% coverage)
  - [x] `MUTATE="src/js/app/browser-events.ts,src/js/app/tab-lifecycle.ts,src/js/app/delete-group.ts,src/js/background/compose.ts" npm run test:mutation` (100% mutation score)

---

### Chunk 8: View Drag Native Sync & Context Menu Pinned Active Move

- **Status:** `[x] Done`
- **Touched Files:**
  - `src/js/app/tab-moves.ts`
  - `src/js/view/drag.ts`
  - `src/js/view/start.ts`
  - `src/js/app/message-handler.ts`
  - `src/js/core/messages.ts`
  - `src/js/background/compose.ts`
  - `src/js/ports/tabs.ts`, `src/js/adapters/browser/tabs.ts`, `src/js/adapters/memory/tabs.ts`
  - `src/js/ports/view-tabs.ts`, `src/js/adapters/browser/view-tabs.ts`, `src/js/adapters/memory/view-tabs.ts`
  - `tests/support/world/browser-model.ts`, `tests/support/world/model-ports.ts`
  - `tests/unit/app/tab-moves.test.ts`, `tests/unit/view/drag.test.ts`, `tests/unit/view/start.test.ts`,
    `tests/unit/app/message-handler.test.ts`, `tests/unit/core/messages.test.ts`,
    `tests/unit/adapters/browser/small-ports.test.ts`, `tests/unit/adapters/memory/steps15-ports.test.ts`,
    `tests/unit/adapters/view-ports.test.ts`, `tests/unit/world/browser-model.test.ts`
  - `tests/e2e/user-journeys.spec.ts`
- **Findings Addressed:**
  - **8.1 (HIGH — Dragging a tab between groups in `view.html` leaves native groups out of sync, and can be clobbered to
    `-2`):**
    - _Reproduced (in part):_ the Chromium E2E journey "Move tab between existing groups" was extended to check, after
      the drop, that the view still shows the tab in group B once reopened, and that every tab of group B is in one native
      group. On the code before this chunk it failed in real Chromium: group B's tabs were in two native groups
      (`[1110981857, 781558561]`), as `view/drag.ts` never put the moved tab in the target group's native group. The
      overwrite to `-2` did not happen in that run (the tab was still in group B after the reload); it depends on how
      Chromium reports the move, and the fix removes its cause either way.
    - _Fixed:_ the view no longer stores the group or moves the tab itself. `view/drag.ts` asks the background
      (`{ action: 'placeTab', tabId, groupId, windowId, beside }`, parsed by `parseTabPlacement` in
      `src/js/core/messages.ts` and handled in `src/js/app/message-handler.ts`), and shows the tab again where it is
      (`groupNodes.insertTab`) when the background did not place it. The new `TabMoves.placeTab` in
      `src/js/app/tab-moves.ts` sends the tab to its group with `moveTab` (stored group, end of the window, the group's
      native group, made if there is none, shown or hidden as the menu does) and then puts it next to the tab it was
      dropped by (`Tabs.moveBeside`, a new port method), inside the background's `ownMoves`, putting it back in its
      group's native group if the move took it out at the edge of the group. The page-local move counter in
      `view/drag.ts` and `ViewTabs.moveTo`, now unused, were removed. TDD tests in `tests/unit/app/tab-moves.test.ts`
      (`placeTab, for a tab the view dropped`), `tests/unit/view/drag.test.ts`, `tests/unit/view/start.test.ts`,
      `tests/unit/app/message-handler.test.ts`, `tests/unit/core/messages.test.ts` and the adapters' tests.
    - _E2E:_ the extended journey passes in Chromium (real extension). Its reload and native-group checks run only
      there: the Firefox page tests run against a stand-in `browser` with no background (it answers every message
      with `{ success: true }`), so they cannot show a move the background makes.
  - **8.2 (MEDIUM — `moveActiveTab` picks the wrong neighbour when the active tab is pinned):**
    - _Fixed:_ for a pinned tab, `moveActiveTab` (`src/js/app/tab-moves.ts`) hands over to the tabs of the group the
      window shows (`getActiveGroup`), and keeps the pinned tab itself in the list so `neighbourOf` finds its place;
      where the window shows no group it falls back to the other pinned tabs, as before. Unpinned tabs with no stored
      group keep the old matching. TDD tests in `tests/unit/app/tab-moves.test.ts` (`for the active tab`).
- **Verification:**
  - [x] `npx vitest run --coverage --maxWorkers=2` (4633 tests; 100% statements, branches, functions, lines)
  - [x] `MUTATE="src/js/app/tab-moves.ts,src/js/view/drag.ts,src/js/app/message-handler.ts,src/js/core/messages.ts,src/js/adapters/browser/tabs.ts,src/js/adapters/memory/tabs.ts,src/js/adapters/browser/view-tabs.ts,src/js/adapters/memory/view-tabs.ts,src/js/view/start.ts,src/js/background/compose.ts" npm run test:mutation`
        (100% after sharpening three `drag.test.ts` assertions; the last run was `MUTATE="src/js/view/drag.ts"`)
  - [x] `npm run lint` (0 errors, 0 warnings)
  - [x] `npm run test:e2e -- -g "Move tab between existing groups|Drag tab outside"` (4 passed: Chromium and the
        Firefox page tests)
  - [x] `npm run test:e2e` (full suite: 333 passed, 0 failed, 259 skipped)

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
