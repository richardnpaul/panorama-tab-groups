# Implementation Plan: TypeScript, Functional Core / Ports & Adapters, and 100% Coverage + 100% Mutation Score

## Overview

Migrate the extension to strict TypeScript while refactoring it into a pure functional core, explicit ports for
every `browser.*` dependency, thin adapters, and a logic-free composition root. The goal is to enforce **100%
statement/branch/function/line coverage and a 100% Stryker mutation score as hard CI gates, with zero exclusions
of any kind** (no `istanbul ignore`, no `Stryker disable`, no ignore patterns, no `mutate` negations, no type or
lint suppressions). Every surviving mutant or uncovered branch is resolved by adding an assertion or by
deleting/restructuring the code so the equivalent mutant cannot exist. TypeScript supports this goal: the type
checker proves away many defensive guards that would otherwise produce unkillable mutants.

## Requirements

- Coverage and mutation gates are both 100%, with `break: 100` in CI, and apply to **all** of `src/**/*.{js,ts}`.
- All source ends up as strict TypeScript; `tsc --noEmit` is a blocking CI gate.
- No suppression mechanism of any kind is permitted. A CI check fails the build if one is introduced.
- Behaviour is preserved except where a characterisation test exposes a real bug (see Findings); those are fixed
  in their own steps, tests first.
- Firefox (primary) and Chromium behaviour is unchanged; the existing Playwright E2E suite stays green throughout.
- `StateManager` (or its successor port) is the only access path to `browser.sessions` / `browser.storage`.
- Work follows `test-driven-refactoring`: baseline green, tests first, tests and implementation never edited in
  the same step, and the validation loop (`test:coverage`, `test:unit`, `lint:prettier`, `lint:eslint`, plus
  `typecheck` once it exists) after every step; E2E after every functional change.
- A TypeScript conversion of a file (rename and annotations only) is its own step and never carries a
  behaviour change.

## Findings that shape the plan

1. **Today's "100%" has holes.** Six `istanbul ignore` comments exist (`src/js/view/groupNodes.js` x3,
   `src/js/background.js` x3). `collectCoverageFrom` is `src/js/**` only, so `src/popup-view/` (~774 lines) and
   `src/shared/` (~417 lines) are not measured, and `src/js/depends/` is explicitly ignored.
2. **Behaviour hidden behind `DEBUG`.** In `toggleVisibleTabs`, the safety abort "no tabs would be shown but some
   would be hidden" sits **inside `if (DEBUG)`**. With `DEBUG = false` (the stated production setting) the guard
   disappears. `DEBUG` is a compile-time `true`, so `if (DEBUG)` creates dead/untestable branches throughout
   `background.js` (~106 console calls).
3. **Latent crash.** `toggleVisibleTabs(..., noTabSelected)` does `showTabs[0].id` with no check that `showTabs`
   is non-empty. `noUncheckedIndexedAccess` would have flagged this.
4. **Import-time side effects.** `background.js` evaluates feature detection (`hasTabHide`, `hasTabGroups`,
   `browserMode`), registers all listeners and calls `init()` on import.
5. **Module-level mutable state** in `view/groups.js` (`windowId`, `groups`) and `background.js`
   (`windowStates`, `viewRefreshOrdered`, `backgroundState`).
6. **`StateManager` bypassed** by `view/groups.js`, `shared/js/models/Group.js` and `Tab.js`,
   `options/backup.js`, `background/native-groups.js`; the view and popup both write the `groups` array.
7. **Two UI implementations** (`src/js/view/` and `src/popup-view/` + `src/shared/`).
8. **Hand-rolled loops** (`groups.js` `getLength`, `getIndex`) and wall-clock/timer use (`Date`, `setTimeout`:
   39 sites), including a magic 100 ms window in `tabCreated`.
9. **Stringly-typed domain.** Group ids are numbers with sentinels (`-1` view, `-2` ungrouped), sometimes passed as
   strings (`parseInt(groupId, 10)` in `moveTab`). Message `action` strings are matched in a `switch` with a
   runtime `default`.
10. **No build step today.** `src/` is loaded directly by `web-ext`, by Playwright (`playwright.config.js` uses
    `src` both as the extension path and as the static root for its local server), and by the manifest.
    Introducing TypeScript means a `dist/` output that all of these must target.
11. **Tooling suppressions and stale ignores.** There are 53 `eslint-disable` comments across 14 files.
    `.eslintignore`, `.prettierignore` and `.pre-commit-config.yaml` skip `src/popup-view/*` (so the popup is
    never linted or formatted) and a stale path `src/_shared/js/models/View.js` that no longer exists
    (the real directory is `src/shared`).
12. **Toolchain compatibility is unverified.** `@stryker-mutator/jest-runner` 10.0.0 and
    `@stryker-mutator/typescript-checker` 10.0.0 exist, but support for Jest 30 and for the current TypeScript
    major (npm `latest` is 7.0.2) is not confirmed. `@babel/preset-typescript` latest is 8.x while the repo is on
    Babel 7.

## Decisions (ADR)

| Decision               | Choice                                                                                                                                                                                                                                                                                                   | Rationale                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language               | Strict TypeScript, migrated file by file (`allowJs` while mixed)                                                                                                                                                                                                                                         | Types prove away guards; ports become real compile-checked interfaces                                                                               |
| Build                  | `tsc` emits ES modules to `dist/`; a small script copies static assets (html, css, icons, `_locales`, `manifest.json`). No bundler.                                                                                                                                                                      | Keeps the existing multi-file module layout, `type: "module"` background and HTML `<script type="module">` tags unchanged; smallest change          |
| Jest transform         | `@babel/preset-typescript` (transpile only) with a `moduleNameMapper` mapping `./x.js` imports to `./x`                                                                                                                                                                                                  | Fast; type checking is done once by `tsc --noEmit`, so tests stay quick for Stryker                                                                 |
| Mutation type-checking | `@stryker-mutator/typescript-checker`                                                                                                                                                                                                                                                                    | Mutants that cannot type-check cannot exist in a running program and are reported as compile errors. This is automatic, not a configured exclusion. |
| Syntax subset          | `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`; no `enum`, no `namespace`                                                                                                                                                                                             | Guarantees Babel-transpilable output and no runtime constructs that coverage or mutation tools handle badly                                         |
| Strictness             | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`                                                                                                                                            | Maximum compile-time proof; reduces defensive runtime code                                                                                          |
| Escape hatches         | Banned: `any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, non-null `!`, and type assertions (`as`, `<T>`) via `@typescript-eslint/consistent-type-assertions: never`. Untrusted data (storage, messages) enters through hand-written type-guard parsers in adapters.                               | A cast is a suppression in disguise; parsers are ordinary, testable code                                                                            |
| Exhaustiveness         | Use `Record<Union, Handler>` tables and discriminated unions checked by the compiler. No `assertNever` default branches.                                                                                                                                                                                 | An `assertNever` default is unreachable code that coverage can never execute                                                                        |
| Domain identifiers     | Parse stored numeric group ids at the adapter boundary into a discriminated `GroupRef` (`view` / `ungrouped` / `user` with `id`). Stored data format is unchanged. Branded number types were rejected because creating a brand requires an assertion.                                                    | Removes the `-1`/`-2` sentinel comparisons and string-vs-number bugs without a data migration                                                       |
| Browser typings        | `@types/firefox-webext-browser` for the adapter layer only. Adapters take a narrow structural type (for example `Pick<typeof browser.tabs, 'query' \| 'update'>`) as a parameter rather than reading the global, so tests pass plain typed objects with no casts. Chromium differences stay in adapters. | Ports stay browser-neutral; tests need no `as unknown as` mocks                                                                                     |
| Lint                   | `@typescript-eslint` `strict-type-checked` and `stylistic-type-checked` configs on `*.ts`, alongside the existing airbnb-base for `*.js` during the transition                                                                                                                                           | `eslint-config-airbnb-typescript` is not relied on; confirm in Phase 0                                                                              |

## Target Architecture

```
src/js/
  core/            pure functions, no browser, no I/O, no Date/timers. Return values or "plans".
    groups.ts        group list operations, id allocation, next/previous group
    visibility.ts    planVisibility(input) -> Plan (discriminated union: abort | apply)
    tab-assignment.ts decide which group a new/activated tab belongs to
    grouping-safety.ts validateAndCheckSafety as a pure decision over enriched data
    migration.ts, backup.ts (serialise/validate), layout.ts (tiling/rect maths)
  ports/           TypeScript interfaces and types only, erased at build: GroupState, Tabs, Windows,
                   NativeGroups, Menus, Messaging, Options, Clock, Scheduler, Logger
  adapters/
    browser/         one-line pass-throughs over a narrow browser type (+ polyfill moved here),
                     plus parsers (type guards) for storage and message payloads
    memory/          in-memory fakes implementing every port (used by tests)
  app/             use-cases: take ports as arguments and orchestrate core plans
                   (createVisibilityService(ports), createTabLifecycle(ports), ...)
  background/main.ts  composition root: build adapters, build services, register listeners. No logic.
  view/ options/ popup  consume the same ports/models; DOM builders split from view-model functions
dist/              build output (tsc + copied static assets); what web-ext, Playwright and CI load
```

Rules:

- `core/` imports nothing from the browser, DOM, or other layers.
- `app/` receives ports as parameters (factory functions); no module-level mutable state.
- The logger port is `{debug, warn, error}`; the composition root passes `console` itself, so there is no
  wrapper code to mutate. Debug-only logging and the `new Error().stack` tracing are deleted; `DEBUG` is removed.
- Capability mode (`hybrid` / `collapse-only` / `legacy`) is a value passed into core, derived once in the
  composition root from the browser adapter.
- Optional DOM lookups go through one `requireElement` helper that throws; it is tested once, and call sites carry
  no null-guards.

## Affected Files

- `package.json`, `tsconfig.json` (new), `tsconfig.build.json` (new), `stryker.config.mjs` (new),
  `babel.config.js`, `.eslintrc.js` — toolchain, scripts, gates
- `scripts/copy-static.js` (new) — copies non-TypeScript assets to `dist/`
- `scripts/check-no-suppressions.js` (new) — CI guard (see Phase 0)
- `.github/workflows/node.js.yml`, `.github/workflows/e2e.yml`, `.pre-commit-config.yaml` — typecheck, build,
  gates
- `playwright.config.js` — extension path and static root move from `src` to `dist`; `tests/e2e/**` helpers that
  reference `src`
- `.eslintignore`, `.prettierignore` — remove the popup and stale `_shared` entries (build outputs only remain)
- `src/js/background.js` (→ split into `core/`, `app/`, `background/main.ts`)
- `src/js/background/*`, `src/js/share/*`, `src/js/options/*`, `src/js/view/*`, `src/js/polyfill.js` — converted
  to TypeScript and refactored
- `src/js/depends/dragscroll.js` — ported into tested TypeScript source
- `src/popup-view/**`, `src/shared/**` — migrated onto shared ports/models, duplicate UI removed
- `tests/unit/**` — converted to TypeScript; new tests per extracted unit; `tests/unit/setup.js` shrinks as the
  global fake is replaced
- `tests/e2e/**` — at least one new E2E case per behavioural change/bug fix

## Implementation Steps

Each step is a PR-sized slice. Within a step, tests and implementation are separate commits.

### Phase 0: Baseline, Toolchain, and Guard Rails

1. **Establish baseline** — run `npm run test:unit`, `test:coverage`, `lint`, `test:e2e`; record results.
   - Risk: Low. If the baseline is red, stop and hand back.
2. **Verify the toolchain** (`package.json`, throwaway branch)
   - Action: confirm, on one small module (`src/js/background/utils.js`), that (a) Stryker runs under Jest 30,
     (b) `@stryker-mutator/typescript-checker` works with the chosen TypeScript major, (c) `typescript-eslint` v8
     supports it alongside ESLint 8, (d) a `@babel/preset-typescript` release compatible with Babel 7 is
     available. If TypeScript 7 is not yet supported by the Stryker checker or typescript-eslint, pin the latest
     supported major. Record each outcome and the final pinned versions as an addendum to this plan.
   - Why: every later phase depends on these. Risk: Medium.
3. **TypeScript infrastructure** (`tsconfig.json`, `tsconfig.build.json`, `babel.config.js`, `package.json`,
   `.eslintrc.js`)
   - Action: add the compiler options from the Decisions table with `allowJs: true`, `checkJs: false` so
     unconverted JavaScript passes through untouched; add the dependencies; add
     `@babel/preset-typescript` and the `./x.js` → `./x` `moduleNameMapper` for Jest; add `typecheck`
     (`tsc --noEmit`, covering `src`, `tests` and `scripts`) and the typescript-eslint override for `*.ts`.
   - Risk: Medium. No source changes yet; all existing tests must still pass unchanged.
4. **Build pipeline** (`tsconfig.build.json`, `scripts/copy-static.js`, `package.json`, `playwright.config.js`,
   `.github/workflows/*.yml`)
   - Action: `npm run build:dist` emits to `dist/` and copies static assets; `start`, `watch`, `build`,
     `build:xpi` and `lint:webext` point at `dist`; Playwright's extension path and local-server root move to
     `dist` with a `pretest:e2e` build; CI runs the build before E2E and web-ext lint. With no `.ts` files yet
     the output is a straight copy, so E2E is a pure pipeline check.
   - Risk: Medium. Mitigation: land this before any conversion so a failure is attributable to the pipeline.
5. **Widen measurement** (`package.json` jest config)
   - Action: `collectCoverageFrom: ["src/**/*.{js,ts}"]`, remove `coveragePathIgnorePatterns`; add
     `coverageThreshold` of 100 for all four metrics. Type-only modules (`ports/*`) emit no runtime statements,
     so they need no special handling. The gate stays advisory in CI until Phase 6.
   - Risk: Low (it will report new gaps; that is the point).
6. **Ban suppressions** (`scripts/check-no-suppressions.js`, `package.json` lint script, `.eslintrc.js`)
   - Action: fail on `istanbul ignore`, `c8 ignore`, `Stryker disable`, `stryker-disable`, `@ts-ignore`,
     `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` (all forms); fail on any `mutate` negation,
     `coveragePathIgnorePatterns` entry, tsconfig `exclude` of source, or `.eslintignore`/`.prettierignore`
     entry other than build outputs, `node_modules`, `coverage` and reports. Wired into `npm run lint` and CI.
   - Risk: Low. It is initially red (6 istanbul ignores, 53 eslint-disables, the stale ignores), so the existing
     occurrences are listed in an enumerated, temporary allow-list that must reach empty by Phase 6.
7. **Vendored code** (`src/js/depends/dragscroll.js`, `src/view.html`)
   - Action: port into `src/js/view/dragscroll.ts` as a tested ES module (90 lines, UMD wrapper removed) and
     update the `view.html` script tag.
   - Risk: Low.

### Phase 1: Leaf Modules — Convert, Then 100% Mutation

For each of: `background/constants`, `background/utils`, `share/utils`, `share/options`, `options/*`, `polyfill`,
`background/menu-manager`, `view/tabs`:

8. **Convert to TypeScript** — rename to `.ts`, add types, no behaviour change; existing tests (still `.js`)
   must pass untouched.
9. **Convert its tests to TypeScript** — test-only step, using explicit `@jest/globals` imports and typed fakes.
10. **Run Stryker per file** (`--mutate <file>`), then for every survivor either add an exact-value assertion or
    simplify the code until the mutant cannot exist (delete redundant guards/defaults that the types now prove
    unnecessary, replace hand-rolled loops with array methods). Log-string mutants are eliminated by deleting
    non-error logging, not by asserting on it.
    - Dependencies: Phase 0. Risk: Low. Done when each file reports 100% mutation with no config change.

### Phase 2: Ports, Fakes, and State Unification

11. **Define ports** (`src/js/ports/*.ts`): interfaces and types with one line of contract each, including the
    discriminated `GroupRef` and the persisted-state types.
12. **Browser adapters** (`src/js/adapters/browser/*.ts`): one-line pass-throughs taking a narrow structural
    browser type; `polyfill` moves under it. Storage and message payloads pass through type-guard parsers that
    reject malformed data with a defined result. Tested with plain typed objects, no casts.
13. **Memory adapters** (`src/js/adapters/memory/*.ts`): in-memory implementations of every port, including a
    `Scheduler` with manual `advance(ms)` and a `Clock` with settable time. Contract tests run the same suite
    against both the memory and browser adapters so the fake cannot drift.
14. **`GroupState` port** — evolve `StateManager` into the adapter for `GroupState`; remove console tracing and
    the stack-trace code from `setGroups`. Route `view/groups`, `shared/js/models/*`, `options/backup` and
    `background/native-groups` through it. Introduce `createGroupsStore(groupState, windowId)` to replace
    module-level `windowId` / `groups` in `view/groups`; replace `getLength` / `getIndex` with
    `groups.length` / `findIndex`.
    - Risk: Medium (touches every surface; E2E gates it).

### Phase 3: Extract the Background Core (largest, riskiest — one PR per function)

Order chosen by risk-reduction value. For each: convert the function's file region to TypeScript first (behaviour
unchanged), then characterisation tests, then extract the pure decision into `core/`, then the orchestration into
`app/`, then delete the old function.

15. **`toggleVisibleTabs` → `core/visibility.ts` + `app/visibility-service.ts`**
    - Pure `planVisibility` returns a discriminated `Plan`: `abort` (with reason) or `apply` (tabs to show and
      hide, native groups to collapse or uncollapse, tab to activate); the service performs the calls through
      ports.
    - Fix finding 2: the "would show nothing" abort becomes an unconditional, tested rule (E2E case added).
    - Fix finding 3: `noTabSelected` with nothing to show is a defined no-op, tested.
    - Removes `DEBUG` and the instrumentation timing.
16. **`tabCreated` → `core/tab-assignment.ts` + `app/tab-lifecycle.ts`**: view-tab detection
    (`isViewTabById/ByWindow/ByUrl`) as a pure predicate with the 100 ms window as a named, injected constant
    asserted via the fake clock; fallback group selection (`getLowestPositiveGroupId`) as a pure function.
17. **`tabActivated`, `tabAttached`, `tabDetached`, `moveTab`** — same pattern; native-group creation and
    cross-window safety decisions move to `core/grouping-safety.ts`.
18. **`init`, `initializeTabGroupAssignments`, `salvageGrouplessTabs`, `setupWindows`, `showInitializationUI`**
    — `app/startup.ts`; `waitForInitialization` uses the `Scheduler` port (no polling with raw `setTimeout`).
19. **Message handling** — replace the `handleInternalMessage` switch with a `Record<Action, Handler>` table,
    one handler per action, each returning a promise. Incoming messages enter through a `parseMessage` type
    guard; an unparseable message gets a defined error response (a real, tested branch). The composition root
    adapts the table to `onMessage`. Remove the unused `handleMessage` external handler if review confirms it is
    dead.
20. **`background/main.ts` composition root** — builds adapters/services, registers every listener
    synchronously (MV3 requirement), no logic. A test fires each event on the fake and asserts the right
    service call. `background.js` is deleted (`manifest.json` `background.scripts` updated to the built path).
21. **Remove all six `istanbul ignore` comments** — each is either covered by the new structure or its branch
    deleted. Shrink the Phase 0.6 allow-list for coverage ignores to empty.

### Phase 4: View, Popup, and Options

22. **`core/layout.ts`**: tiling/rect/drag maths extracted from `view/groupNodes`, `view/drag`, `view/index` as
    pure functions with table-driven tests.
23. **DOM builders** in `view/` become thin, typed, return elements, no module state; tests assert class names,
    attributes, text and style values against jsdom. DOM lookups go through `requireElement`.
24. **Popup unification**: `popup-view/` consumes `createGroupsStore` and the same ports; delete
    `shared/js/models/{Group,Tab,View}` duplicates once behaviour is characterised and moved. Keep UI differences
    only in rendering. Remove the `src/popup-view/*` and `_shared` ignore entries so the popup is linted and
    formatted.
25. **`options/backup`**: serialise/validate into `core/backup.ts` (pure), I/O via ports.
26. **Remove the 53 `eslint-disable` comments** — mostly polyfill `no-underscore-dangle` lines and test files;
    restructure or rename so each rule is satisfied. Shrink the lint allow-list to empty.

### Phase 5: Drive Remaining Survivors to Zero

27. **Full Stryker run**, then loop: for each survivor, (a) add an exact-value assertion; (b) if it is
    equivalent, restructure the code so the mutant cannot exist; (c) never add a suppression. Typical
    restructurings: remove redundant `?.` and defaults by validating at the adapter boundary, replace index
    arithmetic with array methods, collapse guards whose removal is unobservable.
    - Done when: the full run reports 100%, zero survived, zero no-coverage.

### Phase 6: Enforce in CI

28. **Hard gates** (`stryker.config.mjs`, `package.json`, `.github/workflows/node.js.yml`)
    - `tsc --noEmit` blocking.
    - Jest `coverageThreshold` 100 on all four metrics (blocking).
    - Stryker `thresholds: { high: 100, low: 100, break: 100 }`, `coverageAnalysis: "perTest"`,
      `incremental: true` with the incremental file cached between runs, and the TypeScript checker enabled; PRs
      run incremental, `main` runs a full mutation pass on merge/nightly so the baseline cannot drift.
    - `scripts/check-no-suppressions.js` allow-list empty and blocking.
    - Risk: Medium (CI duration). Mitigation: per-test coverage analysis and caching; measure before enabling.

## WebExtension API Notes

- No new permissions; `manifest.json` changes only to the `background.scripts` entry path in step 20. Keep
  `type: "module"`.
- The extension now loads from `dist/`. `web-ext lint`, `web-ext run`, `web-ext build` and Playwright must all
  target it.
- MV3: listeners must still be registered synchronously at top level of the entry module; the composition root
  preserves this and must not `await` before registering.
- `tabHide` is Firefox-only; capability mode is computed once in the composition root and passed to core. The
  Chromium shim (`menus` proxy, `sessions.*Value` emulation with its serial lock) is preserved verbatim in the
  browser adapter and covered by the contract tests.
- Firefox vs Chromium: collapse-only mode (no hiding) must have explicit unit cases in `core/visibility.ts`.
- **AMO source submission:** Mozilla requires source code and reproducible build instructions for add-ons whose
  shipped code is generated by a transpiler. Document `npm ci && npm run build:xpi` in the README before the
  first release built from `dist/`, and confirm the exact requirement against current AMO policy.

## Testing Strategy

- **Unit (Jest):** every `core/` function table-driven; `app/` services tested with memory adapters; adapters
  tested with typed structural fakes plus shared contract tests; coverage 100%, mutation 100%.
- **Type level:** `tsc --noEmit` covers source and tests, so a test that drifts from a port fails the build.
- **E2E (Playwright), new cases required:** (a) show-nothing safety abort is active (finding 2);
  (b) `noTabSelected` with an empty target group does not throw (finding 3); (c) popup and full-page view agree
  on group state after a mutation from either (state unification); (d) one case per migrated background flow if
  not already covered by `tests/e2e/user-journeys.spec.js`.
- **Per-step verification loop:** `npm run typecheck && npm run test:coverage && npm run test:unit &&
npm run lint:prettier && npm run lint:eslint`; `npm run test:e2e` for any functional change;
  `npm run lint:webext` before finishing a phase.
- **Mutation:** run per-file during Phases 1–4, full during Phase 5, gated in Phase 6.

## Risks & Mitigations

- **Risk:** Stryker, typescript-eslint or the Babel TypeScript preset do not yet support the chosen Jest or
  TypeScript major — Mitigation: Phase 0.2 verifies first and pins supported versions.
- **Risk:** The new build step breaks the E2E harness or web-ext workflow — Mitigation: Phase 0.4 lands the
  pipeline with no `.ts` files, so E2E isolates pipeline problems from conversion problems.
- **Risk:** Mixing a TypeScript conversion with refactoring hides regressions — Mitigation: conversion steps
  are rename and annotation only, with unchanged tests passing; refactors follow separately.
- **Risk:** A ban on type assertions forces awkward code at boundaries — Mitigation: untrusted data goes through
  type-guard parsers; if a genuine case remains, raise it as a decision instead of adding a cast or a
  suppression.
- **Risk:** Refactor changes timing-sensitive behaviour (races between `tabCreated` and `tabActivated`) —
  Mitigation: characterise ordering with the fake scheduler before extraction; keep the `waitForInitialization`
  semantics; E2E gates each step.
- **Risk:** Mutation run time on a 7k-line codebase plus type-checking each mutant — Mitigation: `perTest`
  coverage, incremental mode, pure core makes tests fast; measure in Phase 1 and budget accordingly.
- **Risk:** Truly equivalent mutants resist restructuring — Mitigation: the rule is to change the code, not the
  gate. If one genuinely cannot be removed, raise it to the user as a decision rather than silently adding an
  exclusion.
- **Risk:** Big-bang temptation — Mitigation: one function per PR in Phase 3; the old function is deleted only
  after its replacement is green.
- **Risk:** Contract drift between fakes and real adapters — Mitigation: shared contract test suite run against
  both.
- **Risk:** AMO review friction for transpiled code — Mitigation: reproducible build documented in the README
  (see API Notes).

## Success Criteria

- [ ] All source and tests are strict TypeScript; `tsc --noEmit` is blocking in CI
- [ ] `collectCoverageFrom` is `src/**/*.{js,ts}` with no ignore patterns; 100% statements, branches, functions,
      lines
- [ ] Stryker reports 100% mutation score, 0 survived, 0 no-coverage, with `break: 100` in CI
- [ ] Zero suppression comments (coverage, mutation, TypeScript, ESLint) or config exclusions; guard script
      blocking with an empty allow-list
- [ ] No `any`, non-null assertions or type assertions in source
- [ ] `core/` has no browser, DOM, `Date` or timer references
- [ ] `background.js` removed; `background/main.ts` contains no logic
- [ ] No direct `browser.sessions` / `browser.storage` access outside the `GroupState` adapter
- [ ] Popup and full-page view share one group store and model code; the popup is linted and formatted
- [ ] `DEBUG` removed; safety aborts are unconditional and tested
- [ ] Extension loads from `dist/` in `web-ext`, Playwright and CI; E2E green on Firefox and Chromium, including
      the new cases above
- [ ] `npm run lint` (prettier, eslint, web-ext) and `npm run typecheck` clean
