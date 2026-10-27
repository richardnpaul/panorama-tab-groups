# Implementation Plan: An Options Port, and No Direct Browser Access Outside the Adapters

## Overview

One success criterion of `hexagonal-core-and-mutation-testing.md` is still unmet: "No direct `browser.sessions` /
`browser.storage` access outside the `GroupState` adapter". The group state, the view state, the migration flag and the
appearance settings each have a port and an adapter now. The user's **options** do not: the options page and
`share/options.ts` read and write `storage.sync` through a private `api()` function in each file, and the statistics
read thumbnails straight from `sessions`. This plan finishes the job and then makes the boundary enforceable, so it
cannot drift back.

The code of the options page is the only part of the extension that was not moved over the ports in Phases 3 and 4, so
its unit tests stub the global `browser` instead of using memory fakes, and parts of it run at import time.

## Where the direct access is now

| File                                                                                                                           | What it touches                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `share/options.ts`                                                                                                             | `storage.sync.get` (load); `runtime.getManifest` and the capabilities at **import time** to build `defaultOptions`; an eager `currentOptions = loadOptions()` that nothing uses |
| `options/theme.ts`, `options/toolbar.ts`, `options/view.ts`                                                                    | `storage.sync.set` of one key (`view.ts` also `runtime.sendMessage`)                                                                                                            |
| `options/shortcuts.ts`                                                                                                         | `storage.sync.set` of the whole options object; `commands.getAll/update/reset`; `commands.getAll()` **at import time**                                                          |
| `options/native-groups.ts`                                                                                                     | `storage.sync.set`; `runtime.sendMessage`; the capabilities                                                                                                                     |
| `options/statistics.ts`                                                                                                        | `tabs.query({})` (all windows) and `sessions.getTabValue(id, 'thumbnail')`; `i18n`                                                                                              |
| `options/translations.ts`                                                                                                      | `i18n.getMessage`                                                                                                                                                               |
| `share/utils.ts` (`getPluralForm`)                                                                                             | `i18n.getMessage('pluralRule')`                                                                                                                                                 |
| `background/compose.ts`                                                                                                        | `detectCapabilities(browser)` and `getManifest()`: a composition root, so allowed to name `browser`                                                                             |
| `adapters/browser/{appearance-settings,view-state,migration-flag,session-history,sessions-emulation,events}.ts`, `polyfill.ts` | their own port's access, which is where it belongs                                                                                                                              |

The success criterion names `storage` and `sessions`; the rest of the table (`commands`, `i18n`, `runtime`, `tabs`) is
included because the enforcement in Phase 4 is for the `browser` global as a whole, and a rule that allowed some of
the options page to keep it would have to carve out files.

## Requirements

- Outside `adapters/`, the composition roots and `polyfill.ts`, no module in `src/` names the `browser` global or reads
  `storage` or `sessions`. A lint rule says so and fails the build.
- The options have one port, with a browser adapter and a memory fake that pass the same contract test (as
  `GroupState` already does).
- Nothing in `src/` runs a browser call when its module is imported.
- Every moved module keeps 100% coverage and 100% mutation score with no suppression, and `tsc`, ESLint and the
  suppression guard stay clean.
- The behaviour of the options page does not change, except where a step says so.

## Design

**Core** (`core/options.ts`, pure): the `Options` type, `createDefaultOptions(manifestVersion, hasTabGroups)`,
`parseOptions(stored, defaults)` and the shortcut parser, moved out of `share/options.ts` unchanged. They already take
their inputs as arguments; only the file they sit in mixes in I/O.

**Port** (`ports/options.ts`, extending what is there):

```ts
export interface OptionsStore {
  load(): Promise<Options>;
  /** Keep the given options and leave the others as they are */
  save(changes: Partial<Options>): Promise<void>;
}
```

`save` takes a partial because the pages save one key at a time and `shortcuts.ts` saves the shortcut map; no caller
needs the whole object written back. (Today `shortcuts.ts` writes the whole `Options`, which stores the defaults of every
other key as if the user had chosen them.)

**Adapters**: `adapters/browser/options.ts` (`createBrowserOptions(getApi)`, with `getApi` lazy like the other
adapters, reading the manifest version and the capabilities when `load` is called, never at import) and
`adapters/memory/options.ts`. A shared contract in `tests/support/options-contract.ts` covers: defaults when nothing is
stored, a stored value of the wrong type falls back, `save` merges, `save` of a shortcut leaves the rest, copies in and
out. Both adapters run it.

**Statistics** need no new port for thumbnails: `ViewState.thumbnail(tabId)` exists and its adapter already reads both the
old (string) and the current (record) form, which `statistics.ts` re-implements. The tabs of **all windows** are new:
add `listAll(): Promise<ViewTab[]>` to `ViewTabs` (the adapter is `tabs.query({})`, the fake returns what it holds).

**The appearance settings overlap**: `adapters/browser/appearance-settings.ts` reads `theme` and `toolbarPosition` from
`storage.sync` with its own defaults, and the options pages write those same keys. Decide in step 1 whether it keeps its
own port (smaller, already tested, and also owns the `useDarkTheme` migration) or becomes a view over `OptionsStore`.
The recommendation is to keep it separate but give both adapters one definition of the key names and defaults in
`core/options.ts`, so there is a single place that says what `theme` defaults to.

**The pages** become factories with their dependencies as arguments, as `options/backup.ts` already is: for example
`createThemeSaver({ options })` returns the handler, and `options/start.ts` is the one place that builds them from the
browser adapters. `options/index.ts` is left as the import of the polyfill and a call, like `view/index.ts`.
Shortcuts need a `Shortcuts` port (`getAll`, `update`, `reset` over `browser.commands`), the one other API with
page-specific behaviour; `i18n` already has a port; `runtime.sendMessage` is `Messaging`, which exists.

## Affected Files

- New: `core/options.ts`, `ports/shortcuts.ts`, `adapters/browser/{options,shortcuts}.ts`,
  `adapters/memory/{options,shortcuts}.ts`, `options/start.ts`, `tests/support/options-contract.ts`, and the tests
  for each.
- Changed: `ports/options.ts`, `ports/view-tabs.ts` (+ both adapters), every file in `options/`, `share/utils.ts`
  (`getPluralForm` takes its message from an `I18n`), `background/compose.ts` (builds the options adapter), the files
  that import `loadOptions` or `Options` from `share/options.ts` (`app/*`, `options/backup.ts`).
- Removed: `share/options.ts` and its test, once its pieces have moved.
- Config: `.eslintrc.js` (Phase 4), `stryker.config.mjs` needs nothing (the `src/**/*.ts` glob already covers new files).
- Tests: `tests/unit/options/*` move from a stubbed global `browser` to the memory fakes; the E2E cases in Phase 5.

## Implementation Steps

Each step ends with `npm run typecheck`, the unit tests for the files touched, ESLint and Prettier, and for a new module
a mutation run limited to it (`MUTATE=src/js/core/options.ts npm run test:mutation`); the whole `npm test` runs at the end
of each phase. As in earlier phases, a mutant that cannot be killed is removed by restructuring the code, not by a
suppression.

### Phase 1: Pure core and the port

1. **Decide the appearance-settings question** above and write the answer into this file.
2. **`core/options.ts`**: move `Options`, `ShortcutOption`, `createDefaultOptions`, `parseOptions` and the parsers from
   `share/options.ts`, with their existing tests moved beside them. `share/options.ts` re-exports nothing; callers are
   updated in the same commit, so there is no period with two copies.
3. **`ports/options.ts`**: add `save`, with the contract test written first (it fails for lack of an adapter).

### Phase 2: Adapters

4. **`adapters/memory/options.ts`**, then **`adapters/browser/options.ts`**, each run against the contract. The browser
   adapter takes `getApi`, reads `runtime.getManifest()` and the capabilities inside `load`, and calls
   `storage.sync.get(defaults)` and `storage.sync.set(changes)`. Cases: a failing `storage` rejects through; nothing is
   evaluated at import.
5. **Wire the background**: `compose.ts` builds `createBrowserOptions(() => browser)` in place of `{ load: loadOptions }`;
   `options/backup.ts` likewise. `loadOptions`, `defaultOptions` and the unused `currentOptions` are deleted.

### Phase 3: The pages

6. **`ViewTabs.listAll`** with both adapters, and **`options/statistics.ts`** rewritten over `ViewTabs`, `ViewState` and
   `I18n`; its private thumbnail parsing is deleted because the adapter already does it. The sizes shown must match the
   old code for string and record thumbnails (a table-driven test).
7. **`ports/shortcuts.ts` and its adapters**, then `options/shortcuts.ts` as a factory; the import-time
   `commands.getAll()` becomes a call made by `start.ts`.
8. **`theme`, `toolbar`, `view`, `native-groups`, `translations`** as factories over `OptionsStore`, `Messaging`, `I18n` and
   the capabilities (passed in as a value, not read from `browser`); `share/utils.getPluralForm` takes an `I18n`, and
   its callers in `view/` and `popup-view/` pass the one they already hold, which removes the last global read in `src/js/share`.
9. **`options/start.ts`** composes the above and `options/index.ts` reduces to the polyfill import and one call, with the
   same unit test shape as `view/index.ts`. The existing `tests/unit/options/*` files are rewritten against the fakes
   in the same step as each module (they are the characterisation of its behaviour and must pass first, unchanged in what
   they assert, before they are moved).

### Phase 4: Make the boundary a rule

10. **ESLint**: in `.eslintrc.js` add `no-restricted-globals` for `browser` and `chrome` over `src/**`, and an override
    that turns it off for exactly: `src/js/adapters/**`, `src/js/polyfill.ts`, `src/js/background/{main,compose,StateManager}.ts`,
    and the `start.ts` and `index.ts` of each page (`view`, `popup-view`, `options`, `migration-status`). Add
    `no-restricted-syntax` (or `no-restricted-properties`) for `.storage` and `.sessions` member access with the same
    override. The list of allowed files is the architecture written down, so it is reviewed like code.
    - Accepted by the owner: an ESLint override that names files is configuration, not a suppression comment, and the
      suppression guard does not report it. It is still an exception list, so it is reviewed like code.
11. **Prove it fails**: add a line using `browser.storage` to a module outside the list, confirm ESLint fails, and remove it.

### Phase 5: End to end and close-out

12. **E2E** (`tests/e2e/options-persistence.spec.js`, or `.ts` if the tooling plan has landed): change the theme, the
    toolbar position and the view on the options page, reload, and see the same choices checked; toggle a shortcut off and
    on and see its form follow. Runs on both browsers. This is the check that the real `storage.sync` adapter and the
    real page agree, which no unit test of either alone shows.
13. **Close-out**: full `npm test`, full forced Stryker run, full E2E, `pre-commit` (all files and staged); write a
    "Result" section here; tick the criterion in `hexagonal-core-and-mutation-testing.md`.

## Risks and Mitigations

- **A behaviour change hides in a move.** `shortcuts.ts` today writes the entire options object, so the first shortcut
  toggle stores every default. With `save(Partial)` it stores only the shortcut map. This is the one intended change;
  a test pins it, and the plan says so here so it is not a surprise in review.
- **`storage.sync` on Chromium and Firefox differ at the edges** (quota, an unset key). The adapter contract runs
  against typed fakes only; the E2E case in step 12 is what exercises the real API on both.
- **The options page loads late in the extension's life**: the polyfill must still be imported before anything reads
  `browser`. `options/index.ts` keeps that import first, and a test asserts the order, as `view/index` does.
- **Rule too broad or too narrow**: step 10's file list may miss a legitimate site or let one through. Step 11 and a
  read of every file in the list guard against both.
- **Size**: about twelve modules move. Mitigation: each step leaves the tree green, so the work can stop after any
  phase; Phase 1 and 2 alone already remove `share/options.ts` and the import-time reads.

## Result

- **Step 1, decided: the appearance settings keep their own port.** `core/options.ts` exports `DEFAULT_THEME` and
  `DEFAULT_TOOLBAR_POSITION`, and both `createDefaultOptions` and `adapters/browser/appearance-settings.ts` use them,
  so one place says what `theme` and `toolbarPosition` default to. The `useDarkTheme` migration stays where it was.
- **Core and port.** `core/options.ts` is `share/options.ts` without its I/O (moved with `git mv`; the pure tests moved
  to `tests/unit/core/options.test.ts`). `OptionsStore` has `save(Partial<Options>)`. The four app services that only
  read options (`commands`, `use-native-groups`, `view-refresh`, `backup-service`) now ask for
  `Pick<OptionsStore, 'load'>`, so their tests did not have to grow a `save`.
- **Adapters.** `adapters/browser/options.ts` reads the manifest version and the capabilities inside `load`, and
  `adapters/memory/options.ts` keeps copies in and out. Both pass the eight cases of
  `tests/support/options-contract.ts`. `compose.ts` and the options page build the browser adapter; `loadOptions`,
  `defaultOptions` and `currentOptions` are gone with `share/options.ts`.
- **Statistics.** `ViewTabs.listAll()` (`tabs.query({})`) and `ViewState.thumbnail` replace the module's own reads and
  its private thumbnail parsing; the test stores string, record and malformed thumbnails through the real
  `view-state` adapter and expects the same sizes as before. One small difference: `listAll` leaves out a tab the
  browser reports without an id or window, where the old code counted it as a tab with an empty thumbnail.
  `tabs.query` gives every tab an id, so the numbers shown do not change in practice.
- **Shortcuts.** `ports/shortcuts.ts` (`getAll`, `update`, `reset`) with a browser adapter and a memory fake under one
  contract. The adapter leaves out a command without a name, so the page no longer checks for one.
- **The pages** are factories (`createThemeSaver`, `createToolbarSaver`, `createViewSaver`, `createShortcutHandlers`,
  `createStatistics`, `createBackupHandlers`; `addTranslations(i18n)` and `initNativeGroupsOption(ports)` take their
  ports). What `options/index.ts` did is `options/page.ts` (`createOptionsPage(ports).start()`), built from the
  browser by `options/start.ts`; `index.ts` is the polyfill import and one `addEventListener`, and its test checks the
  polyfill loads first. `getPluralForm(i18n, …)` takes an `I18n`; its callers are `view/group-nodes.ts` and
  `popup-view/groups-frame.ts`, whose tests now give the plural rule through the `i18n` fake instead of a global.
- **The one intended behaviour change:** turning a shortcut off or on stores `{ shortcut }` only, not every option.
  The unit test checks what the store holds, and the E2E case shows it on both browsers.
- **The rule (Phase 4).** `.eslintrc.js` forbids the `browser` and `chrome` globals (airbnb's own list of restricted
  globals is kept) and any `.storage` or `.sessions` member access in `src/**/*.ts`, except in `src/js/adapters/**`,
  `src/js/polyfill.ts`, `background/{main,compose,StateManager,menu-manager}.ts` and the `start.ts` of the view, the
  popup, the options page and the migration status page. Two differences from step 10: `background/menu-manager.ts`
  is on the list (it builds the menu manager over the browser adapters at module level, a composition root the plan
  missed), and the pages' `index.ts` files are not (none of them names the browser, so listing them would only widen
  the exception). A `browser.storage` call and an `api.sessions` read added to `options/theme.ts` both failed the
  rule, and were removed.
- **Nothing runs on import.** `tests/unit/import-side-effects.test.ts` imports each of the 140 modules of `src` that
  is not an entry point under a `browser` that records every property read and call, and expects none. A
  module-level `browser.runtime.getManifest()` added to `core/utils.ts` made it fail (through every module that
  imports that one), and was removed. The entry points (`background/main.ts`, `polyfill.ts`, the pages' `index.ts`)
  start things on load by design.
- **E2E (Phase 5).** `tests/e2e/options-persistence.spec.ts`: choosing the freeform view, the dark theme, the left
  toolbar and then the popup view, and turning the "next group" shortcut off and on, survive a reload of the page,
  checked against values that differ from the defaults. The radio buttons are chosen through their labels, whose
  pictures cover them. On Firefox the extension pages run against the mock `browser` of `tests/e2e/fixtures.ts`, whose
  `commands.getAll` returned `[]`; it now lists the manifest's commands and keeps `update`/`reset` in `localStorage`,
  so the shortcut forms are wired on Firefox as well. 4 new passes (2 cases × 2 browsers).
- **Close-out:** `npm test` green (100% coverage), forced Stryker run 100% (3,781 mutants: 3,771 killed, 10 timed out, 0 survived, 0 without coverage; it first showed one survivor, an equivalent mutant in the new memory `Shortcuts` fake, removed by restructuring `reset`), E2E 64 passed and 8 skipped on both browsers (the 60/8 of before plus the 4 new options cases),
  `pre-commit run --all-files` green.

## Success Criteria

- [x] `grep` for `browser.storage`, `browser.sessions`, and the `api = () => browser` pattern finds only the adapters,
      the polyfill and the composition roots
- [x] The ESLint rule of step 10 is on and a deliberate violation fails it
- [x] `OptionsStore` has a browser adapter and a memory fake that pass one contract test
- [x] No module in `src/` makes a browser call when imported (entry points aside, by design; see the result)
- [x] `share/options.ts` is gone; `getPluralForm` takes an `I18n`
- [x] Coverage 100%, mutation 100% (full forced run), `npm test` green, E2E green on both browsers including the new case
- [x] The criterion is ticked in `hexagonal-core-and-mutation-testing.md`
