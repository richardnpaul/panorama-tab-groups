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
12. **Toolchain compatibility was unverified** (now resolved, see the Phase 0 step 2 addendum below).
    TypeScript 7 (npm `latest`) is not usable; the plan pins TypeScript 6.0.3. Under Jest the root
    `babel.config.js` has to go because Stryker 10's instrumenter bundles Babel 8, which led to a runner
    comparison; the plan moves to Vitest 4.1.12 (see addendum).
13. **18 known vulnerabilities in the dependency tree** (`npm audit`: 3 critical, 12 high, 3 moderate). All are
    transitive dev dependencies, so nothing vulnerable ships in the extension (only `src/` is packaged), but they
    run on developer machines and in CI. Main roots: `web-ext` (via `fx-runner` to `shell-quote`, `addons-linter`
    to `image-size`, `firefox-profile` to `adm-zip`, `@devicefarmer/adbkit` to `node-forge`), `undici`, `tmp`,
    `js-yaml`, `qs`, `fast-uri`, `brace-expansion` and `browserslist`. In a throwaway worktree, a plain
    `npm audit fix` reduced 18 to 3 and left the 439 unit tests and lint green. The remaining 3 high findings
    (`node-forge`, `@devicefarmer/adbkit`, `web-ext`) share one root: every released `node-forge` (latest 1.4.0)
    is flagged and no patched version exists. `npm audit fix --force` is **not** an acceptable fix: it downgrades
    `web-ext` from 10.x to 5.1.0. `node-forge` is only reachable through `web-ext`'s Android runner
    (`web-ext run -t firefox-android`), which this project does not use.

## Decisions (ADR)

| Decision               | Choice                                                                                                                                                                                                                                                                                                   | Rationale                                                                                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language               | Strict TypeScript, migrated file by file (`allowJs` while mixed)                                                                                                                                                                                                                                         | Types prove away guards; ports become real compile-checked interfaces                                                                                                                                                                                                 |
| Build                  | `tsc` emits ES modules to `dist/`; a small script copies static assets (html, css, icons, `_locales`, `manifest.json`). No bundler.                                                                                                                                                                      | Keeps the existing multi-file module layout, `type: "module"` background and HTML `<script type="module">` tags unchanged; smallest change                                                                                                                            |
| Unit test runner       | **Vitest 4.1.12 (exact pin)** with `globals: true`, the `istanbul` coverage provider and `@stryker-mutator/vitest-runner` 10.0.0. Replaces Jest and Babel.                                                                                                                                               | Native TypeScript and ESM, so no Babel preset, no `moduleNameMapper` and no Babel 7/8 conflict with Stryker. Mutation results matched Jest exactly in the spike (see addendum). Vitest 5.0.5 is excluded: Stryker's runner silently reports every mutant as survived. |
| Mutation type-checking | `@stryker-mutator/typescript-checker`                                                                                                                                                                                                                                                                    | Mutants that cannot type-check cannot exist in a running program and are reported as compile errors. This is automatic, not a configured exclusion.                                                                                                                   |
| Syntax subset          | `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`; no `enum`, no `namespace`                                                                                                                                                                                             | Guarantees Babel-transpilable output and no runtime constructs that coverage or mutation tools handle badly                                                                                                                                                           |
| Strictness             | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`                                                                                                                                            | Maximum compile-time proof; reduces defensive runtime code                                                                                                                                                                                                            |
| Escape hatches         | Banned: `any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, non-null `!`, and type assertions (`as`, `<T>`) via `@typescript-eslint/consistent-type-assertions: never`. Untrusted data (storage, messages) enters through hand-written type-guard parsers in adapters.                               | A cast is a suppression in disguise; parsers are ordinary, testable code                                                                                                                                                                                              |
| Exhaustiveness         | Use `Record<Union, Handler>` tables and discriminated unions checked by the compiler. No `assertNever` default branches.                                                                                                                                                                                 | An `assertNever` default is unreachable code that coverage can never execute                                                                                                                                                                                          |
| Domain identifiers     | Parse stored numeric group ids at the adapter boundary into a discriminated `GroupRef` (`view` / `ungrouped` / `user` with `id`). Stored data format is unchanged. Branded number types were rejected because creating a brand requires an assertion.                                                    | Removes the `-1`/`-2` sentinel comparisons and string-vs-number bugs without a data migration                                                                                                                                                                         |
| Browser typings        | `@types/firefox-webext-browser` for the adapter layer only. Adapters take a narrow structural type (for example `Pick<typeof browser.tabs, 'query' \| 'update'>`) as a parameter rather than reading the global, so tests pass plain typed objects with no casts. Chromium differences stay in adapters. | Ports stay browser-neutral; tests need no `as unknown as` mocks                                                                                                                                                                                                       |
| Lint                   | `@typescript-eslint` `strict-type-checked` and `stylistic-type-checked` configs on `*.ts`, alongside the existing airbnb-base for `*.js` during the transition                                                                                                                                           | `eslint-config-airbnb-typescript` is not relied on; confirm in Phase 0                                                                                                                                                                                                |

## Addendum: Phase 0 Step 2 Toolchain Verification Results

Run in a throwaway git worktree at commit `933e0169` (Node 24.22.1, Jest 30.4.1, ESLint 8.57.1), using
`src/js/background/utils.js` converted to `utils.ts`. The existing suite (26 suites, 437 tests) passed under the
new transform.

| Check                                  | Result                                                                                                                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Stryker 10.0.0 with Jest 30        | **Works**, but only after deleting the root `babel.config.js`. Stryker's instrumenter bundles Babel 8 and loads the project's root Babel config, which references Babel 7's `@babel/preset-env` and fails with `BABEL_VERSION_UNSUPPORTED`. Inline Jest transform fixes it. |
| (b) Stryker TypeScript checker         | **TypeScript 7.0.2 fails** (`ts.parseConfigFileTextToJson is not a function`: the native compiler has no JS compiler API). **TypeScript 6.0.3 works.**                                                                                                                      |
| (c) typescript-eslint with ESLint 8    | **Works** on 8.72.0 with `strict-type-checked`, `stylistic-type-checked` and `projectService`. Its peer range caps TypeScript at `<6.1.0`, which independently rules out TypeScript 7. The `assertionStyle: 'never'` rule fires on `x as number`.                           |
| (d) Babel preset                       | **`@babel/preset-typescript` 7.29.7** works with Babel 7.29.7 (8.x is not usable).                                                                                                                                                                                          |
| `.js` → `.ts` import resolution (Jest) | **Works** with `moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" }`; the existing test importing `utils.js` resolved `utils.ts` unchanged.                                                                                                                                  |

Pinned versions (exact, to be saved with `--save-exact` for the TypeScript packages):

- `typescript` **6.0.3** (do not upgrade past `<6.1.0` until typescript-eslint and the Stryker checker support a
  newer line; revisit when TypeScript 7 gains the JS API)
- `@stryker-mutator/core`, `@stryker-mutator/jest-runner`, `@stryker-mutator/typescript-checker` **10.0.0**
- `@babel/preset-typescript` **7.29.7**
- `typescript-eslint` **8.72.0**
- `eslint-import-resolver-typescript` **4.4.5** (resolves `./x.js` imports to `x.ts` for `import/*` rules)
- `@types/firefox-webext-browser` (not yet exercised; confirm its version in step 3)

Early evidence for the mutation approach, from `utils.js`, which already had 100% line coverage:

- As JavaScript: 43 mutants, 33 killed, **10 survived (76.74% score)**. Survivors include the `> 0` vs `>= 0`
  boundary in `getLowestPositiveGroupId` and the `'cyan'` string literal, which no test pins down.
- As TypeScript: the checker discarded **17 of the 43 mutants** as compile errors, leaving 26 scored (17 killed,
  9 survived). Types remove a large share of the mutant surface, but the remaining survivors still need
  assertions or simplification. Compile-error mutants are not a configured exclusion.
- A side finding: with `noUncheckedIndexedAccess`, `getColorForGroupId` is typed `string | undefined`. It returns
  `undefined` for negative ids (`-1 % 9 === -1`). Callers must handle that, or the function must be made total.
  Decide in Phase 1 step 8.

### Runner comparison: Jest vs Vitest (decision: Vitest 4.1.12)

Run in two throwaway worktrees at `933e0169`. In the Vitest worktree the suite got a mechanical `jest.` to `vi.`
swap and an `@jest/globals` import swap, with no other test changes.

| Measure                                    | Jest 30.4.1                                                | Vitest                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Stryker on `utils.js` (43 mutants)         | 33 killed, 10 survived (76.74%)                            | **Identical** on 3.2.7 and 4.1.12. On **5.0.5: 0 killed, 43 survived, no error** (unusable).                                        |
| Stryker on `StateManager.js` (140 mutants) | 89 killed, 51 survived (63.57%), 14.9 s wall               | **Identical** 89 / 51 / 63.57% on 4.1.12, 18.0 s wall. No speed advantage under Stryker.                                            |
| Raw unit run                               | about 8 to 13 s                                            | about 3.4 s                                                                                                                         |
| Babel                                      | Required; conflicts with Stryker 10's Babel 8 instrumenter | Not used                                                                                                                            |
| TypeScript and `.js` to `.ts` imports      | `@babel/preset-typescript` plus a `moduleNameMapper`       | Native                                                                                                                              |
| Mechanical-conversion result               | n/a                                                        | 233 of 437 tests pass; the dominant failures are `isolateModules` (50 calls) and `requireMock` (17); a few others were not examined |

Migration cost found: `jest.mock` x35, `jest.fn` x490, `jest.spyOn` x30, `jest.isolateModules` x21,
`jest.requireMock` x28 and `require(` x44 in `tests/unit`. The `fn`, `mock` and `spyOn` uses convert
mechanically. Only the module-isolation idiom needs rewriting, and it is concentrated in the 8 files that test
import-time side effects, which are the files Phase 3 replaces with a composition root.

Pinned for the runner: `vitest` **4.1.12**, `@vitest/coverage-istanbul` **4.1.12**,
`@stryker-mutator/vitest-runner` **10.0.0**. Not needed any more under this decision: `@babel/preset-typescript`,
`@stryker-mutator/jest-runner`, `jest`, `babel-jest`, `jest-environment-jsdom`.

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
  `.eslintrc.js`, `vitest.config.mjs` (new) — toolchain, scripts, gates (`babel.config.js` is deleted)
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
2. **Verify the toolchain** (`package.json`, throwaway worktree) — **DONE**, results in the addendum below.
   - Action: confirmed, on one small module (`src/js/background/utils.js`), that (a) Stryker runs under Jest 30,
     (b) `@stryker-mutator/typescript-checker` works with the chosen TypeScript major, (c) `typescript-eslint` v8
     supports it alongside ESLint 8, (d) a `@babel/preset-typescript` release compatible with Babel 7 is
     available. Outcomes and pinned versions are recorded in the addendum.
   - Why: every later phase depends on these. Risk: Medium.
3. **Test runner migration and TypeScript infrastructure**
   - **3a. Migrate the unit runner from Jest to Vitest (test-only, no source changes). DONE** (result note below). Add `vitest@4.1.12` and
     `@vitest/coverage-istanbul@4.1.12` (exact), `jsdom`, `@stryker-mutator/core` and
     `@stryker-mutator/vitest-runner` at 10.0.0; add `vitest.config.mjs` (`globals: true`, `include`, the `jsdom`
     environment via the `@vitest-environment` docblock). Convert the tests: `jest.` becomes `vi.`,
     `@jest/globals` imports become `vitest`, and the 8 files that use `jest.isolateModules` / `jest.requireMock`
     (`background`, `view/index`, `view/groupNodes`, `options/index`, `options/native-groups`,
     `options/shortcuts`, `share/options`, `migration-status`) move to `vi.resetModules()` plus
     `await import(...)` and `vi.importMock`. Then remove Jest, `babel-jest`, `jest-environment-jsdom`, the
     `@babel/*` packages and `babel.config.js`. Acceptance: all 437 tests pass and `test:coverage` reports the same
     numbers as the baseline (98.25% statements, 89.71% branches).
     - Why: spike evidence in the addendum; avoids building a Babel TypeScript pipeline that would be thrown away.
     - Risk: Medium. The `isolateModules` / `requireMock` rewrite is the bulk of the work (about 100 call sites);
       the spike showed those are the dominant failure cause after a mechanical `jest.` to `vi.` swap; a few other failures (for example mock setup in `options` tests) were not examined and may add work.
     - **Result:** 439 of 439 tests pass (437 plus 2 new tests for `init()` paths that the Jest suite only covered
       by accident). Coverage rose from 98.25 / 89.71 / 97.75 / 98.42 to 98.6 / 90.18 / 98 / 98.77. Stryker on
       `utils.js` matches Jest exactly (33 killed, 10 survived). Jest, `babel-jest`, `jest-environment-jsdom`,
       `@jest/globals`, `@babel/core`, `@babel/preset-env` and `babel.config.js` are removed. ESLint declares the
       Vitest globals for `tests/unit/**`. Conversion notes: `isolateModules` + `require` became
       `vi.resetModules()` + `await import()`; CJS-style function mocks (`() => vi.fn()`) became `{ default: vi.fn() }`;
       `requireMock` became `await import()` of the already-mocked path; `background.test.js` now waits for the
       import-time `init()` to settle in its shared `beforeEach` so it cannot race the test's queued mock values.
     - **Finding for Phase 1:** Stryker's sandbox copies the whole project and fails on Playwright's
       `test-user-data-*` directories (dangling `lock` symlink). The Stryker config needs `ignorePatterns` for
       `test-user-data-*`, `playwright-report`, `test-results` and `coverage`. This only controls the sandbox copy
       and never touches `mutate`, so it does not conflict with the no-exclusions rule; the guard script (step 6)
       must allow exactly these non-source entries and nothing else.
   - **3b. TypeScript infrastructure. DONE** (result note below). (`tsconfig.json`, `tsconfig.build.json`, `package.json`, `.eslintrc.js`).
     Add the compiler options from the Decisions table with `allowJs: true`, `checkJs: false` so unconverted
     JavaScript passes through untouched; add the dependencies at the pinned versions from the addendum; add
     `typecheck` (`tsc --noEmit`, covering `src`, `tests` and `scripts`) and the typescript-eslint override for
     `*.ts`. Vitest resolves `./x.js` imports to `x.ts` natively, so no mapper is needed.
     - Risk: Medium. No source changes yet; all existing tests must still pass unchanged.
     - **Result:** added `tsconfig.json` (strict options from the Decisions table, `allowJs: true`,
       `checkJs: false`, `noEmit`, `types` for `firefox-webext-browser`, `node` and `vitest/globals`, `include` of
       `src`, `tests`, `scripts`); `typecheck` (`tsc --noEmit`) and `lint:typecheck` scripts, so `npm run lint` now
       type-checks; the typescript-eslint override for `*.ts` with `consistent-type-assertions: never`;
       `.ts` added to the ESLint `--ext`, the pre-commit eslint `files` pattern, the pre-commit prettier
       `types_or`, and the Vitest `include` and coverage globs. Exact pins: `typescript` 6.0.3,
       `typescript-eslint` 8.72.0, `eslint-import-resolver-typescript` 4.4.5, `@types/firefox-webext-browser`
       143.0.1, `@types/node` 24.19.2, `@stryker-mutator/typescript-checker` 10.0.0. `tsconfig.build.json` belongs
       to step 4. No source or test files were converted.
     - **Verified end to end with a throwaway `.ts` module and test (since deleted):** `tsc` clean; typescript-eslint
       clean; Vitest and istanbul cover `.ts`; Prettier clean; Stryker with the Vitest runner and the TypeScript
       checker discarded 2 compile-error mutants, killed 3 and surfaced 1 survivor, `value > 0` vs `value >= 0`,
       which is an equivalent mutant to be removed by restructuring (for example `Math.max(value, 0)`).
     - **Finding:** the airbnb `import/extensions` rule demands a `.ts` specifier once the resolver maps
       `./x.js` to `x.ts`. The `*.ts` override sets `{ js: 'always', ts: 'never' }`, which keeps the `.js`
       specifier convention (conversion steps stay pure renames) and makes `.ts` specifiers an error.
     - **Process finding:** pre-commit stashes unstaged changes and lints only what is staged. Staging the converted
       tests without `.eslintrc.js` fails ESLint (`vi` undefined). Stage config and tests together, and always run
       the hooks both ways: `pre-commit run --all-files` and `git add -A && pre-commit run`.
4. **Build pipeline. DONE** (`tsconfig.build.json`, `scripts/copy-static.mjs`, `package.json`,
   `playwright.config.js`, `.github/workflows/*.yml`)
   - Action: `npm run build:dist` emits to `dist/` and copies static assets; `start`, `watch`, `build`,
     `build:xpi` and `lint:webext` point at `dist`; Playwright's extension path and local-server root move to
     `dist` with a `pretest:e2e` build; CI runs the build before E2E and web-ext lint. With no `.ts` files yet
     the output is a straight copy, so E2E is a pure pipeline check.
   - Risk: Medium. Mitigation: land this before any conversion so a failure is attributable to the pipeline.
   - **Result:** `npm run dist` (`dist:clean`, `dist:tsc`, `dist:static`) builds `dist/` with the same 100 files as
     `src/`; non-JS assets are byte-identical. `build`, `build:xpi`, `start`, `watch` (tsc watch, a Node
     `--watch-path` static copy, and `web-ext run`) and `lint:webext` all use `dist`; `pretest:e2e` builds it, so
     the CI workflows needed no change (they call the npm scripts). Playwright's extension path, static root and
     locale lookup point at `dist`. The full E2E suite against `dist/` matches the baseline (42 passed, 6
     skipped). `dist/` and `web-ext-artifacts/` are git-ignored. `scripts/lib/static-assets.mjs` holds the logic
     and `scripts/copy-static.mjs` is a thin entry; both are unit-tested (18 tests) and counted in coverage.
     The scripts are `.mjs` because `package.json` is not `"type": "module"`, and `.mjs` was added to the ESLint
     extension list and the pre-commit hook patterns (this also starts linting `vitest.config.mjs`).
   - **Finding:** `tsc` re-prints every JS file (formatting only) and, because of `strict`, adds `"use strict"` to
     script-style files. `alwaysStrict: false` is deprecated in TypeScript 6 and removed in 7, so it cannot be
     turned off without a suppression. The affected files are `polyfill.js` (imported as a module, so already
     strict), and the two classic `<script>` files `migration-status.js` and `depends/dragscroll.js`. Neither has
     sloppy-mode hazards (checked for implicit globals, `arguments.callee`, `with`, octal literals) and E2E is
     unchanged. `dragscroll.js` becomes an ES module in step 7.
5. **Widen measurement. DONE** (`vitest.config.mjs`)
   - Action: `coverage.include: ["src/**/*.{js,ts}", "scripts/**/*.mjs"]` (already includes `scripts/`), no
     `coverage.exclude`; add `coverage.thresholds` of 100
     for all four metrics. Type-only modules (`ports/*`) emit no runtime statements,
     so they need no special handling. The gate stays advisory in CI until Phase 6.
   - Risk: Low (it will report new gaps; that is the point).
   - **Result:** `coverage.include` is `src/**/*.{js,ts}` plus `scripts/**/*.mjs`, with no `exclude` and no ignore
     patterns. Measured honestly, coverage is **83.73 / 81.08 / 77.44 / 83.89** (statements, branches, functions,
     lines), against the 98.6 / 90.2 / 98.0 / 98.8 that only counted `src/js`. The gap is `src/popup-view/` and
     `src/shared/`, about 1,200 lines at 0%, which Phase 4 replaces. The 100% gate exists as
     `npm run test:coverage:gate` (`vitest run --coverage --coverage.thresholds.100`) and fails by design until
     Phase 6 moves the thresholds into the config and CI.
6. **Ban suppressions. DONE** (`scripts/check-no-suppressions.mjs`, `scripts/lib/suppressions.mjs`,
   `scripts/suppression-allowlist.json`, `package.json` lint script, `.pre-commit-config.yaml`)
   - Action: fail on `istanbul ignore`, `c8 ignore`, `Stryker disable`, `stryker-disable`, `@ts-ignore`,
     `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` (all forms); fail on any `mutate` negation,
     `coveragePathIgnorePatterns` entry, tsconfig `exclude` of source, or `.eslintignore`/`.prettierignore`
     entry other than build outputs, `node_modules`, `coverage` and reports. Wired into `npm run lint` and CI.
   - Risk: Low. It is initially red (6 istanbul ignores, 53 eslint-disables, the stale ignores), so the existing
     occurrences are listed in an enumerated, temporary allow-list that must reach empty by Phase 6.
   - **Result:** `npm run lint:suppressions` (part of `npm run lint`) and an always-run `no-suppressions`
     pre-commit hook. It scans code files (`.js`, `.mjs`, `.cjs`, `.ts`) for coverage, mutation, type and lint
     suppression directives; reads `.eslintignore`, `.prettierignore` and the hook excludes in
     `.pre-commit-config.yaml` for anything other than generated output; checks `tsconfig*.json` `exclude`,
     the Vitest `coverage.exclude`, and (once it exists) the Stryker `mutate` negations and `ignorePatterns`.
     The allow-list is a **ratchet**: `scripts/suppression-allowlist.json` records the exact count per file and
     kind, a new or increased suppression fails, and a count that fell below its allowance also fails until the
     allow-list is lowered, so it can only shrink. It starts at **40 suppressions in 14 entries** (down from 59 after
     the Vitest migration): 6 coverage ignores, 30 lint disables across 9 files, and the `src/popup-view/*` ignore
     entries (`.eslintignore`, `.prettierignore`, 2 hook excludes). Stale ignore entries for files that do not
     exist (`playwright-demo-extension`, two diagnostic scripts, `src/_shared`) were deleted. The guard is itself
     unit-tested and has a **100% mutation score** (242 mutants killed, 0 survived, no suppressions); its
     only equivalent mutant (`config.mutate ?? []`) was removed by restructuring so the default is the returned
     result. The guard caught a literal directive in its own test on the first run.
   - **Finding:** JS files that import a `.ts` module need the TypeScript import resolver and
     `import/extensions: { js: 'always', ts: 'never' }` globally, not only in the `*.ts` override; both are now in
     the base ESLint config.
7. **Vendored code. DONE** (`src/js/depends/dragscroll.js`, `src/view.html`)
   - Action: port into `src/js/view/dragscroll.ts` as a tested ES module (90 lines, UMD wrapper removed) and
     update the `view.html` script tag.
   - Risk: Low.
   - **Result:** `src/js/view/dragscroll.ts` exports `initDragScroll(document, window)` and narrow structural
     types, so the tests use plain typed fakes with no casts. Features nothing in the repo used were dropped
     (`container`, `scroller`, `nochilddrag`, the `body` special case, the exported `reset`), because dead branches
     cannot survive mutation testing. `view/index.js` calls it from `initView`; `view.html` no longer has the
     classic `<script>`; `src/js/depends/` is deleted, along with its ignore entries in `.eslintignore`,
     `.prettierignore`, the pre-commit excludes and the Vitest coverage exclude. Tests were written first
     (12 tests, TypeScript, explicit `vitest` imports) and then the implementation; the view wiring has its own
     test. A new E2E journey drags the canvas and checks `#groups` scrolls (passes on Firefox and Chromium).
     `dragscroll.ts` has a **100% mutation score** (28 killed, 0 survived; 4 mutants discarded as non-compiling).

### Phase 0B: Dependency Vulnerability Remediation. DONE

Can start any time after step 3 and must finish before Phase 1. Each step is its own commit so the lockfile
changes are reviewable. The no-exclusions rule applies here too: no audit allow-list, no `--force` downgrades.
**Outcome: `npm audit` reports 0 vulnerabilities (from 3 critical, 12 high, 3 moderate), and it is now a blocking
CI check.**

V1. **Apply the non-breaking fixes** (`package-lock.json`). DONE

- Action: `npm audit fix` (never `--force`). Exact-pinned packages (`vitest`, `typescript`, the Stryker packages)
  are untouched because `audit fix` stays inside the ranges in `package.json`.
- Result: 18 findings became 3 (`node-forge`, `@devicefarmer/adbkit`, `web-ext`). `package.json` dependency
  ranges and pins did not change (`web-ext` moved to 10.8.0 inside its range). Unit tests, lint and the build
  stayed green.
  After the whole of Phase 0B the full E2E suite passed (44 passed, 6 skipped) on the second of two runs. The
  first run had one failure, `Journey: Move tab between OS windows` on Chromium, which passed alone and in the
  repeat run, so it is recorded here as a suspected pre-existing flake; if it recurs it needs its own
  investigation before the E2E suite is trusted as a refactoring safety net in Phase 3.

V2. **Resolve the `node-forge` chain** (`package.json`, `tools/adbkit-stub/`). DONE

- Context: no patched `node-forge` exists. `web-ext/lib/util/adb.js` imports `@devicefarmer/adbkit`, but only
  `extension-runners/firefox-android.js` imports `adb.js`, and `extension-runners/index.js` loads that with a
  dynamic `import()` only for `--target firefox-android`. So lint, build and desktop run never touch it.
- **Rejected approach:** an npm `overrides` entry pointing at `file:tools/adbkit-stub`. It installed correctly
  but recorded the link relative to `web-ext` in the lockfile, and `npm ci` then failed with
  `Missing: @devicefarmer/adbkit@ from lock file`. This was caught by running `npm ci` in a clean copy; CI uses
  `npm ci`, so it would have broken the build.
- **Chosen approach:** `tools/adbkit-stub` is an npm workspace package (`workspaces: ["tools/adbkit-stub"]`) named
  `@devicefarmer/adbkit` with version `3.3.9`, the exact version `web-ext` pins, so npm links the workspace
  instead of installing the registry package. The lockfile records `resolved: tools/adbkit-stub` at the root and
  a clean `npm ci` works. The stub's `createClient()` throws a message explaining the Android target is disabled
  and pointing at `CONTRIBUTION.md`; running `web-ext run -t firefox-android` prints that message.
- Tests: the stub's behaviour is tested in `tools/adbkit-stub/index.test.js`, colocated because importing a
  workspace package by relative path from `tests/` breaks `import/no-relative-packages`, and importing it by name
  resolves outside Stryker's sandbox so the mutated copy is never exercised. A second test,
  `tests/unit/tools/adbkit-workspace.test.js`, asserts that `@devicefarmer/adbkit` resolves to the stub, that it is
  private, and that its version equals the one `web-ext` pins, so a `web-ext` upgrade that changes the pin fails
  loudly instead of silently reinstalling `node-forge`. The stub has a **100% mutation score** (7 killed, 0 survived).
- **Consequence for Phase 1:** because the test file lives beside the source, the Stryker `mutate` globs must be
  positive and explicit (`tools/adbkit-stub/index.js`, not `tools/**/*.js`), since negations are forbidden.
- Removal instructions for when `node-forge` is fixed are in `CONTRIBUTION.md`.

V3. **Automate keeping it clean** (`.github/dependabot.yml`, `.github/workflows/`). DONE

- `.github/dependabot.yml`: weekly npm updates (dev dependencies grouped for minor and patch) and weekly GitHub
  Actions updates, with `ignore` rules for **major** updates of `vitest`, `@vitest/*`, `typescript` (and minors,
  since typescript-eslint caps below 6.1), `typescript-eslint` and `@stryker-mutator/*`. These are the deliberate
  pins from the toolchain addendum.
- `npm run audit:check` (`npm audit --audit-level=low`) is a blocking step in `node.js.yml` right after `npm ci`,
  and a new weekly `audit.yml` workflow (plus manual dispatch) runs it so new advisories surface without a code
  change. It is deliberately not part of `npm run lint`, so local linting works offline.
- Not a vulnerability, but noticed: `eslint@8.57.1` is end of life (npm prints a deprecation warning). Moving to
  ESLint 9 and flat config is a separate task; it is not in this plan.

### Phase 1: Leaf Modules — Convert, Then 100% Mutation. DONE (three modules deferred)

For each of: `background/constants`, `background/utils`, `share/utils`, `share/options`, `options/*`, `polyfill`,
`background/menu-manager`, `view/tabs`:

8. **Convert to TypeScript** — rename to `.ts`, add types, no behaviour change; existing tests (still `.js`)
   must pass untouched.
9. **Convert its tests to TypeScript** — test-only step, using explicit `vitest` imports and typed fakes.
10. **Run Stryker per file** (`--mutate <file>`), then for every survivor either add an exact-value assertion or
    simplify the code until the mutant cannot exist (delete redundant guards/defaults that the types now prove
    unnecessary, replace hand-rolled loops with array methods). Log-string mutants are eliminated by deleting
    non-error logging, not by asserting on it.
    - Dependencies: Phase 0. Risk: Low. Done when each file reports 100% mutation with no config change.

**Result.** 17 source modules are strict TypeScript with a **100% mutation score**: a clean, non-incremental
`npm run test:mutation` reports 659 mutants killed, 0 survived, 0 uncovered (1m27s), and the break threshold of 100
is enforced by `stryker.config.mjs`. The suite has 806 unit tests; the full E2E suite is unchanged (44 passed, 6
skipped). Converted: `background/{constants,utils}`, `view/tabs`, `share/{options,utils}`, and
`options/{reset,toolbar,theme,view,statistics,shortcuts,translations,native-groups,index}`. Three shared modules were
created because several converted modules needed them: `share/dom.ts` (`requireElement`, `requireElementById`,
`findElement`, `asListener`), `share/guards.ts` (`isRecord`, `isString`, `isBoolean`) and `share/capabilities.ts`
(`detectCapabilities`, `browserModeOf`, which also replaces the duplicated feature detection in `share/options.ts` and
`options/native-groups`). `npm run test:mutation` runs everything listed in `stryker.config.mjs`; `MUTATE=a.ts,b.ts
npm run test:mutation` narrows a run while iterating.

**Deferred, with reasons** (the plan listed these under Phase 1):

- `options/backup` → Phase 4 step 25. It parses an untrusted user file and converts a legacy session format; the right
  shape is pure validation in `core/` plus I/O behind ports, so converting it now would be thrown away.
- `polyfill` → Phase 2 step 12. It is the Chromium shim that Phase 2 turns into typed browser adapters.
- `background/menu-manager` → Phase 2. It calls the JS `stateManager` and the polyfilled `browser.menus`, which the
  `GroupState` and `Menus` ports replace.

**Deliberate behaviour changes** (everything else is behaviour-preserving, and each is pinned by a test):

- `loadOptions()` now validates what storage returns and falls back to the default for any field of the wrong type
  (the Firefox typings return `{ [s: string]: any }`, which strict linting will not pass on as `Options`).
- Shortcut state is saved with an object spread instead of `Object.assign`; the latter wrote to a key named
  `__proto__` through the prototype setter instead of storing data.
- A command with no shortcut shows an empty field instead of the text "undefined"; a click with no identifiable
  shortcut throws a descriptive error instead of a `TypeError`.
- `options/statistics` counts an unusable cached thumbnail as 0 bytes instead of producing `NaN`, and no longer
  logs the active-tab count.
- A missing page element now throws `Element not found: <selector>` (or `Element is not an <Class>`) instead of
  `Cannot read properties of null`. Async event listeners are registered through `asListener`, which logs a
  failure instead of leaving an unhandled rejection.

**Findings that shape later phases:**

- `@types/firefox-webext-browser` types `sessions.setTabValue` as taking `string | object` although this code
  stores numbers. Casting is banned, so each module declares the narrow API it uses and reads the `browser` global
  lazily (`const api = (): Api => browser`). The real `browser` is assignable to such an interface through method
  bivariance, which is the pattern Phase 2's adapters formalise.
- A type parameter that appears only in a return type is an unchecked assertion
  (`no-unnecessary-type-parameters`). `requireElement` therefore takes the element class and checks it with
  `instanceof`, so DOM tests use real jsdom elements (fakes cannot pass `instanceof`) and convert the module and its
  tests together; for those modules steps 8 and 9 were not separable.
- The stale, unreferenced `tests/unit/setup.js` assigned `globalThis.browser`, which overrode the real Firefox typings
  for the whole project through `allowJs`. It is deleted.
- Equivalent mutants were removed by restructuring, not suppressed: the plural-form boundary checks became membership
  tests (`isFewCount`), `getLowestPositiveGroupId` lost two redundant guards, and the Stryker-config helper returns its
  default as the result so a changed default is visible.
- A test helper that adds a listener to the shared jsdom `document` leaks it into later tests; dispatch
  non-bubbling, one-shot events or capture the listener instead.

### Phase 2: Ports, Fakes, and State Unification. DONE (scope adjusted, see below)

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

**Result.** 42 source modules, `scripts/` and `tools/` are at a **100% mutation score** in a clean run (911 mutants
killed, 11 timeouts, 0 survived, 2m26s) with the 100% break threshold enforced. 1,152 unit tests pass; the full E2E
suite is unchanged (44 passed, 6 skipped). Statement and branch coverage across everything in `src/` is 84.22 / 80.89
(the remainder is the JS that Phases 3 and 4 convert).

**What exists now:**

- **Ports** (`src/js/ports/`, types only): `GroupState` (with `Group` and `Rect`), `Clock`, `Scheduler`, `Messaging`,
  `Tabs`, `I18n`, `Logger`, `Menus`, `Windows`.
- **`core/`** (pure): `constants`, `utils` (both moved here from `background/`), and `groups.ts` with
  `ensureUngroupedGroup`, which returns a new list instead of mutating its input.
- **Browser adapters:** `group-state` (reads through a type guard that keeps the stored object and its unknown
  fields), `messaging`, `tabs`, `i18n`, `windows`, `menus` (owns the Chromium `'tab'` to `'all'` retry that was
  copied in three places), `sessions-emulation` and `action-compat` (the Chromium shims from `polyfill.js`).
- **Memory adapters:** `group-state`, `clock`, `scheduler` (manual time), `messaging`, `tabs`, `windows`, `menus`.
  `GroupState` and `Scheduler` have shared contract suites (`tests/support/*-contract.ts`) that run against the real
  and the fake implementation; the sessions emulation also passes the `GroupState` contract.
- **System adapters:** `clock`, `scheduler`.
- **`app/`:** `withUngroupedGroup` (the ungrouped-group rule as a decorator), `createGroupsStore`,
  `createMenuManager`.
- **JS-facing compositions:** `background/StateManager.ts` (`stateManager` is the browser `GroupState` wrapped in the
  ungrouped-group rule), `background/menu-manager.ts`, `view/groups.ts` and `polyfill.ts`. They keep the module paths
  and function names the JS callers already import.

**Scope adjustments** (the plan listed more under step 14):

- **Routed through `GroupState`:** `view/groups` (now a thin layer over `createGroupsStore`) and everything that used
  `stateManager`. **Not** routed: `shared/js/models/*` (the popup, deleted in Phase 4 step 24),
  `options/backup` (rewritten in Phase 4 step 25), and the direct `browser.sessions` / `browser.storage` calls in
  `background.js` and `native-groups.js` (they move with their extraction in Phase 3). `view/index`, `groupNodes`
  and `tabNodes` still read the `layoutMode` and `thumbnail` values directly; those belong to the view rewrite.
- **Ports are defined where there is a consumer.** `NativeGroups`, `Options` and a richer `Tabs` arrive with the Phase 3
  extractions that use them. The `GroupRef` union is deferred to Phase 3 for the same reason: every current caller
  still compares plain numeric ids.
- `StateManager`'s unused methods (background state, window state, batch and migration helpers, `getTabGroups`) were
  deleted rather than ported; nothing called them.

**Deliberate behaviour changes** (each pinned by a test):

- **The ungrouped group survives a save from the view.** The old view wrote only the non-system groups, dropping the
  system group until the background next saved; saving now goes through `stateManager`, which keeps it.
- Stored groups are validated when read: an entry that is not a group (no numeric `id`, no `name`, `containerId` or
  `rect`, or a wrongly typed optional field) is dropped from the list instead of being passed on.
- Numeric reads accept a whole number stored as text (`"3"` becomes `3`) and reject anything else. This was needed
  because the E2E tests (and possibly older data) store ids as text, and treating them as "nothing stored" sent tabs
  to a fallback group.
- Chromium: the sessions emulation now also provides `removeTabValue` and `removeWindowValue`, which the code calls
  but the old shim never defined; a failed write no longer blocks every later one; a key named `__proto__` is stored as
  data. The never-used `browser.menus` alias and `Proxy` (about 45 lines) are gone.
- Context menus: `createMenuItem` now also gets the Chromium fallback; a malformed menu message is ignored instead of
  creating an item titled "id: undefined".
- The view now logs a failed menu update instead of leaving an unhandled rejection, and only treats a delete as
  successful when the background answers `success: true`.

**Findings:**

- **A regression the E2E suite caught.** The first version of the `GroupState` adapter rejected non-numeric ids; the
  Chromium run of "Move tab between existing groups" failed deterministically (Firefox passed). It is the reason the
  tolerant read above exists. It also confirms that Chromium runs only through the sessions emulation, so it must stay
  in the E2E matrix.
- Equivalent mutants removed by restructuring, not suppressed: the memory group state's `undefined` ternary
  (`structuredClone(undefined)` is `undefined`), the Chromium menu retry (`['tab'→'all']` mapping over a two-value
  type is `['all']`), the system scheduler's handle map (`Number()` of a timer is its id), and the store's `?? []`
  default (kept as the result so a changed default shows).
- The ratchet works as designed: deleting `StateManager.js` and `polyfill.js` removed 11 `eslint-disable` comments, and
  the guard failed until the allow-list was lowered. It is down from 40 to 29 suppressions.
- Config changes this phase: `import/prefer-default-export` is off for `*.ts` (named exports are the convention), and
  `@typescript-eslint/no-unused-vars` uses `ignoreRestSiblings: true`, the same setting airbnb applies to the base rule.

### Phase 3: Extract the Background Core. DONE (see the result below; step 21 is split with Phase 4)

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

**Result.** `background.js` (1,901 lines) and `background/native-groups.js` (751 lines) are deleted. The manifest
loads `js/background/main.js`, a composition root of 16 lines that adds every listener before awaiting anything and
then starts `init()`. Everything it used to do is in `core/` and `app/` services over ports, each with memory-adapter
tests and a 100% mutation score; unit tests number about 1,700, and statements, branches, functions and lines are at
100% for everything under `src/js/{core,app,ports,adapters,background,share,options}` and `polyfill`. The full E2E suite
is 46 passed, 8 skipped (the two new cases are Chromium only), and was 43 passed, 6 skipped, and one Chromium failure before the fixes below, "Move tab between OS windows", which fails the same one run in
three on the Phase 2 commit as well (a pre-existing flake, not caused by this phase). After the fixes under Findings
it passed in three full runs of four; the other run failed a different Chromium test that passed in 15 runs alone.

**What exists now** (new in this phase):

- **`core/`:** `visibility` (`planVisibility`: what to show, hide, collapse, expand and activate), `tab-assignment`
  (is this the view tab; the fallback group), `grouping-safety` (would grouping leave the window with no other tab),
  `menu-items` (which group a menu item stands for; the neighbour of the tab that is sent away), `view` (the tab to
  go back to), `messages` (parsers for what the pages send), and `groupBeside` / `nativeGroupIdOf` in `groups`.
- **`app/` services**, each taking only the ports it uses: `visibility-service`, `toolbar-service`,
  `native-group-assignment` (the one flow that makes a native group for a group, used by tab creation, tab
  activation and the migration), `tab-lifecycle` (`tabCreated`, `tabAttached`, `tabDetached`, `tabActivated`),
  `tab-moves` (`moveTab`, `menuClicked`), `view-toggle`, `view-opening`, `commands`, `initialization` (the state and
  `waitForInitialization`, on the `Scheduler` port), `initialization-ui`, `window-groups`, `group-recovery`,
  `startup`, `native-groups-sync` (migration, clean-up and following the browser's own group events), `delete-group`,
  `view-refresh`, `message-handler` (a table of handlers keyed by action), `external-messages`, `browser-events`
  (the tab, storage and install handlers) and `use-native-groups`.
- **Ports** added: `NativeGroups`, `Toolbar`, `Notifications`, `Extension`, `SessionHistory`, `OptionsStore`,
  `MigrationFlag`; `Tabs`, `Windows`, `GroupState` and `Logger` grew. Each has a browser adapter and a memory
  fake; the new browser event wiring is `adapters/browser/events.ts` (`registerListeners`), tested by firing every
  event on a fake emitter and checking which handler gets what.
- **The composition:** `background/compose.ts` builds everything from the browser it runs in and is tested against a
  fake browser; `background/main.ts` only calls it, registers the listeners and starts up.

**Deliberate behaviour changes** (each pinned by a test):

- Toggling to a group whose tabs would all be hidden now always aborts with a logged error; before, the abort
  depended on the `DEBUG` flag. Selecting nothing while there is nothing to show is a no-op; before, it threw.
- Switching groups with the shortcuts skips the system group for ungrouped tabs. It used to stop on it, which
  stored an active group that `toggleVisibleTabs` then refused. From an active group that is not switchable, next
  goes to the first group and previous to the last.
- A tab that is attached to a window whose active group is unknown keeps its group instead of being given
  `undefined`. A tab that was detached has its group forgotten, as before.
- The menu clicks only look at the window of the tab that was clicked. They used to ask every window for the selected
  and visible tabs, so with two windows a single click could move the other window's active tab. A click on an item
  that is no group (or a click that is not on a tab, which Chromium sends for page contexts) is ignored instead of
  storing the group `NaN`. Several selected tabs are moved one after another instead of all at once, so they keep
  their order.
- Declining to make a native group (it would not be safe, or it failed) no longer stops a tab's group from being
  shown; see the findings.
- A native group the browser put in the wrong window now has its tabs taken out again, for all callers; before only
  the migration did that, and tab creation and activation left an orphan group.
- The migration uses the same safety rule as tab creation (do not group the only tab of a window); it used to refuse
  whenever the group held all the tabs. It no longer re-verifies persisted references afterwards: it already drops the
  stale ones, and the extra pass only logged a title mismatch.
- `migrateToHybridGroups` answers `success: false` when it failed. It used to say "Migration completed" whatever
  happened. `resetMigration` answers a failure instead of never answering.
- `setBackgroundState` accepts only `openingBackup` with a boolean; it used to set any key of the background state.
  An unparseable message gets a defined error answer, as does an unknown action.
- Event handlers that fail are logged with the name of the event instead of being left unhandled, and a failed
  message handler answers an error so the sender is not left waiting.
- Dead state is gone: the per-window `viewTabId` map was written but never read, and so was the listener that cleaned
  it. The `onCreated` listener for native groups only logged and is gone. The Chromium fallback in
  `createGroupInWindowIfMissing` was unreachable once the polyfill retries without a window id.
- The `DEBUG` flag and the timing instrumentation are removed; useful messages are `debug` on the `Logger` port.

**Findings:**

- **Two safety rules existed.** Tab creation refused to group only when the group was the single tab in the window;
  the migration refused whenever the group was all the regular tabs. They are now one rule: the first one (decided
  with the user).
- **A group is never recreated when the last one is deleted.** `deleteGroupWithCleanup` creates a new first group
  when no groups are left, but the list it checks always holds the system group, so the branch is dead in the real
  extension (the unit test reaches it with a state that has no system group). Left as it was (decided with the user).
- **Declining to make a native group no longer skips the group switch.** `tabCreated` and `tabActivated` used to
  return early when making the native group was unsafe, which skipped the visibility update, the collapsing of the
  other groups and the toolbar title, so the window switched group only in what was stored. Native groups are
  incidental to switching group (and tab hiding does not exist in Chromium), so the switch now always goes ahead.
- **Three bugs found by writing the E2E cases for this** (all fixed, each with a unit test):
  - A tab that the browser had put in a native group by itself (a tab opened from a grouped tab joins that group) was
    linked to its group's reference even when another group already had that native group, so two groups shared one.
    A native group that another group has is no longer linked.
  - The handler for the browser's "native group updated" event wrote the groups back whether or not any referred to
    that group. The browser reports a group right after it is made, before the group that made it has stored its
    reference, so the write erased the reference. Nothing is written now unless a group refers to the native group.
  - On Chromium all the sessions values (which Chromium lacks) live in one storage entry that each call reads and
    rewrites; calls took turns only within one context, so a write from the view or the options page that overlapped
    one from the background was lost. The calls now take turns under the Web Locks of the extension, which all its
    contexts share, with the old in-context queue where the browser has no locks. This is probably the cause of the
    flaky "Move tab between OS windows" run (it passed in all but one of the last five full runs, against about one
    in three before). A read-modify-write that spans calls (read the groups, change, write them) can still lose an
    update to an overlapping one; the real fix is the Phase 4 work that gives the view a single owner for each
    value.
- **New E2E cases** (`tests/e2e/group-switching.spec.js`, Chromium only, because Firefox's extension pages run behind a
  mock): activating a tab of another group switches to that group and collapses the others (this is what exposed the
  two bugs above), and activating the only tab of a window still switches that window to its group (the early-return
  fix). Findings 2 and 3 (aborting when nothing would be shown, and selecting nothing in an empty group) and the
  shortcut skipping the system group are only reachable through the keyboard shortcuts, which neither Playwright nor
  the browser lets a test press; they are covered by unit tests against the memory adapters.
- Equivalent mutants again removed by restructuring: a stale request's `opened` call (nothing refers to the replaced
  request), `if (ui.isShowing())` before `hide` (which already does nothing when not showing), the migration's
  reference check (now by `typeof` so `null` and absent differ), and the nested sums of the recovery tally (now one
  flat sum, since two negations cancel).
- Typing the colours of native groups as the browser's own union (`NativeGroupColor`) was needed for the real
  `browser` to satisfy the adapter, with no cast.

**Step 21 is split.** The three `istanbul ignore` comments in `background.js` are gone with the file, and the
allow-list entry for it is removed. The three in `view/groupNodes.js` belong to the Phase 4 view rewrite.

### Phase 4: View, Popup, and Options. DONE (see the result below)

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

#### Phase 4 result

Every `.js` file left in `src/` is now TypeScript: the full-page view (`view/`), the popup (`popup-view/`), the
options page backup (`options/backup`) and the migration status page (`migration-status/`) were rewritten over the ports, with `shared/js/models/*` and `shared/js/utilities/node.js` deleted. The suppression
allow-list is `{}`, the `src/popup-view/*` entries are gone from `.eslintignore`, `.prettierignore` and the
pre-commit hooks, and every new module is in the Stryker `mutate` list at 100% (no survivors, no uncovered
mutants). Coverage is 100% on all four metrics.

- **Step 22 (`core/layout.ts`)**: tiling rects, snapping, the clamping of a group to the minimum size, the drop mark
  for a dragged tab, and the rect of a group made by a click, all pure and table-driven. The maths was checked
  against the old code with a differential random test before that was deleted.
- **Step 23 (full-page view)**: `view/{tab-nodes,group-nodes,drag,controller,leave-view,page,start,theme,thumbnail-image}.ts`
  over new ports (`ViewTabs`, `ViewState`, `I18n`, `Downloads`) with memory fakes and browser adapters. Nodes are made
  with DOM calls only, and `view/late.ts` breaks the one construction cycle (the drag handlers need the group nodes that
  need the drag handlers) without a module-level variable. Behaviour that changed, all deliberately:
  - Keyboard navigation between tabs goes round and skips groups with no tabs; it used to stop at the ends and land
    in an empty group.
  - Closing a group makes the first remaining group the active one.
  - Placing a tab is one serial queue; the `modifyingGroupContent` flag that pretended to be a mutex is gone.
  - A tab the view moves itself is counted (`ownMoves`), so the browser's event for that move is not applied a second
    time.
  - The mouse-up listener of a drag is registered with `once`; it used to stack up with every drag.
  - Pressing Enter in the name field of a group saves it, the same as leaving the field; a `<spawn>` typo in the markup
    is now a `<span>`.
- **Step 25 (backup)**: `core/backup.ts` parses and converts the file (an untrusted input, including the legacy session
  format) and `app/backup-service.ts` / `app/backup-controls.ts` do the I/O through `Windows`, `Tabs` and `Downloads`.
  Opening a backup resets `openingBackup` in a `finally`, so a failure no longer leaves the background believing a
  backup is still opening. A tab with no group is saved without a `groupId` instead of `undefined`, and file names
  use a two-digit year.
- **Step 24 (popup)**: `popup-view/{frame,tab-list,groups-frame,detail-frame,start,index}.ts` over `createGroupsStore`,
  `GroupState`, `ViewTabs` and the new `app/popup-service.ts`, with the logic in `core/popup.ts`
  (`searchMode`, `matchingTabs`, `searchGroups`, `moveGroupTo`, `gridRect`, `navigate`, `nextGroupName`,
  `mostRecent`). The old popup built its markup from strings, so a tab title or group name containing markup became
  DOM in an extension page, and a web page chooses its own title; everything is now made with DOM calls and text is text. Other changes:
  - **The search is a text search.** It used to make `new RegExp(query, 'gi')` from what the user typed, so `(` threw
    and `.` matched anything.
  - **`Esc` was never matched** (the key is `Escape`), so Escape did not save a group name in the field.
  - **A new group goes in the next place of a grid.** The old code used `groups.length - 1` as the place, so the first
    group got a negative position, and the 8 by 4 grid for more than 18 groups could not be reached because the
    test for more than 8 came first. Groups can now also be put in order by dragging (`GroupsStore.moveTo`), which
    only the popup's `moveToIndex` did before and which is now tested.
  - **A group with no tabs can be shown** (it opens a tab in it); the old code threw on `tabs[0]`. The popup is now closed
    only after what it started has finished: it used to call `window.close()` right after starting `Group.show()`, which
    could drop the request.
  - Closing a group asks only when it has tabs, as the full view does, and the node is removed only if the background
    removed the group. A blank group name keeps the old name, and a name that is the same is not saved.
  - The left arrow goes back from the tabs of a group when the focus is on the first thing of its row; it used to use
    the remembered place, which a click on a button did not update.
  - A tab with no icon has no `src` (it was `src="undefined"`, a request for a file of that name), "Edit group" is a
    message (`editGroup`) rather than English in the code, and the popup takes its theme from the same `applyAppearance`
    as the view.
  - The popup stopped listening for tab activation to remember the last used tab: a popup is closed by one.
  - **A race found by the new E2E case**: the frame that was shown first removed the active state of its siblings
    100 ms later, and in a tab that is not in front the browser delays timers, so the timer of the groups frame
    removed the active state of the tabs frame that had been shown since. The frame shown last in a shell is now the
    only one that takes the others away (a unit test shows the order).
- **Migration status page**: `migration-status/{status-page,start,index}.ts`; the page loads as a module, looks again
  five seconds after the last look is done (not on an interval, so looks cannot overlap), and shows the new list only
  once it is loaded, where it used to empty it first and flicker. A reset that fails now says so. `messageOf` moved to
  `share/guards.ts`, replacing three copies.
- **Step 26 (suppressions)**: the 14 remaining `eslint-disable` comments are gone: the `_panoramaExtensionId` property
  of the Playwright context is `panoramaExtensionId`; the polling loops are recursion or `expect.poll`; and the one
  import of a development dependency by `playwright.config.js` is allowed by an ESLint override for that file (a
  rule setting, not a suppression, and not something `check-no-suppressions` reports).
- **New E2E cases** (`tests/e2e/popup.spec.js`, all seven on both browsers; the drag case was first skipped on Firefox on a guess
  about the mock, and when run there it passed, so it is not skipped): the groups are listed with their tab counts, the search has the focus, a new group is made
  and named and listed, the tabs of a group are shown and the left arrow goes back, the search finds tabs and treats
  what looks like a pattern as text, the arrow keys move the focus, and a group is dragged to the front.
- **Left for Phase 5/6**: the `mutate` list is still a list of files (all at 100%), to become `src/**/*.ts`; the ports
  have no mutants (types only).

### Phase 5: Drive Remaining Survivors to Zero. DONE (see the result below)

27. **Full Stryker run**, then loop: for each survivor, (a) add an exact-value assertion; (b) if it is
    equivalent, restructure the code so the mutant cannot exist; (c) never add a suppression. Typical
    restructurings: remove redundant `?.` and defaults by validating at the adapter boundary, replace index
    arithmetic with array methods, collapse guards whose removal is unobservable.
    - Done when: the full run reports 100%, zero survived, zero no-coverage.

#### Phase 5 result

`mutate` in `stryker.config.mjs` is now `scripts/**/*.mjs`, `tools/adbkit-stub/index.js` and `src/**/*.ts` (positive
globs only), so a new file is mutated the moment it exists instead of when someone lists it. One forced run with no
incremental cache (5 minutes 41 seconds) reports 100.00: 3,753 killed, 11 timeouts (counted as detected), 0 survived,
0 with no coverage. A further 2,254 mutants are discarded by the type checker because they do not compile; these are
the ones the "restructure so it cannot exist" rule leaves behind by design (for example a condition replaced by
`true` removes the narrowing that the branch relies on). The ports are types only and have no mutants. No
survivors were left from Phase 4, since each module was taken to 100% as it was written, so this phase was the
check that nothing had drifted rather than a loop of fixes.

### Phase 6: Enforce in CI. DONE locally; the workflows have not yet run on GitHub (see the result below)

28. **Hard gates** (`stryker.config.mjs`, `package.json`, `.github/workflows/node.js.yml`)
    - `tsc --noEmit` blocking.
    - Vitest `coverage.thresholds` 100 on all four metrics (blocking).
    - Stryker `thresholds: { high: 100, low: 100, break: 100 }`, `coverageAnalysis: "perTest"`,
      `incremental: true` with the incremental file cached between runs, and the TypeScript checker enabled; PRs
      run incremental, `main` runs a full mutation pass on merge/nightly so the baseline cannot drift.
    - `scripts/check-no-suppressions.js` allow-list empty and blocking.
    - `npm audit --audit-level=low` blocking, with no advisory allow-list (Phase 0B).
    - Risk: Medium (CI duration). Mitigation: per-test coverage analysis and caching; measure before enabling.

#### Phase 6 result

- **`npm test` is the gate.** It is `lint` (Prettier, ESLint, `web-ext lint` on `dist/`, `tsc --noEmit`, the suppression
  guard) and then `test:coverage`. Until now it was lint only, so CI ran no unit test at all. `node.js.yml` already ran
  it across Node 20 to 26, together with `npm audit --audit-level=low` (no allow-list; 0 vulnerabilities).
  Locally it takes 22 seconds and passes.
- **Coverage gate.** `vitest.config.mjs` has `coverage.thresholds` of 100 on statements, branches, functions and lines,
  so `test:coverage` itself fails below that (a run of one folder fails with the three metrics it misses). The
  `test:coverage:gate` script, which only existed to pass the flag, is gone.
- **Mutation gate.** `stryker.config.mjs` already had `thresholds` of 100, `coverageAnalysis: 'perTest'`, the TypeScript
  checker and `incremental`. `.github/workflows/mutation.yml` is new: a pull request restores the incremental report
  from the cache and runs `npm run test:mutation` (1 minute 6 seconds locally with nothing changed); a push to `main`, the
  nightly schedule (03:41 UTC) and a manual run use `npm run test:mutation:full` (`--force`, about 5 minutes 40
  seconds) and save the report to the cache, so the incremental file a pull request starts from is always one from a
  full run.
- **The guard guards the gates.** `check-no-suppressions` (part of `npm test`) now also fails when a coverage threshold
  is not 100 or is missing, when a Stryker `high`, `low` or `break` threshold is not 100 or is missing, and when the
  TypeScript checker or per-test coverage analysis is taken out of the Stryker config. Lowering a gate to make a build
  pass is therefore the same kind of change as adding a suppression: the guard, not a reviewer's memory, stops it.
  The allow-list stays `{}`.
- **Not done, and needs you:** making the three checks (the Node CI matrix, the pre-commit run and the mutation run)
  required status checks on `main` is a repository setting. The two new pieces (the `mutation.yml` workflow and the
  cache keys) have not run on GitHub; the first pull request will show whether the cache restores. Running the workflows locally with
  `act` first, and fixing what that shows, is planned in `act-local-workflow-testing.md`.
- **Left unticked because they name CI**: the mutation score with `break: 100` in CI, and the extension loading from
  `dist/` with the E2E cases green in CI. Both pass locally and are tied to workflows that have not yet run on GitHub.
- **Success criteria not met, so left unticked below:**
  - "All source and tests are strict TypeScript" (planned in `typescript-tests-and-tooling.md`): the source is, but seven Playwright specs, `playwright.config.js`, six
    unit tests of the scripts and tools, and `tools/adbkit-stub` are still JavaScript.
  - "No direct `browser.sessions` / `browser.storage` access outside the `GroupState` adapter" (planned in
    `options-port-and-browser-access.md`): the options pages
    (`options/{theme,toolbar,shortcuts,native-groups,view}.ts`, `share/options.ts`) read and write the user's options in
    `storage.sync`, `options/statistics.ts` reads a tab's thumbnail from `sessions`, and the polyfill sets the
    emulation up. The adapters of the other ports (`view-state`, `appearance-settings`, `migration-flag`,
    `session-history`) are where their own access belongs. The options pages want an `Options` port (one already
    exists in `ports/options.ts` for the background's reads), which is the work that remains.
- **Both met since, by the two follow-up plans** (see their "Result" sections):
  - `typescript-tests-and-tooling.md`: the scripts, the unit tests of the scripts and tools, `vitest.config.ts`,
    `playwright.config.ts`, the fixtures and all eight end-to-end specs are TypeScript under the same strict `tsc` and
    ESLint rules as the source, `allowJs` is gone, and the suppression guard fails on any JavaScript file other than
    `.eslintrc.js`, `stryker.config.mjs` and `tools/adbkit-stub/index.js`, which tools load as JavaScript.
  - `options-port-and-browser-access.md`: the options page reaches the browser through `OptionsStore`, `Shortcuts`,
    `ViewTabs`, `ViewState`, `I18n` and `Messaging`; `share/options.ts` is gone; and an ESLint rule fails on the
    `browser`/`chrome` globals or `.storage`/`.sessions` access anywhere in `src` but the adapters, the polyfill and
    the composition roots. That is the criterion's intent, wider than its wording: the `GroupState` adapter is one of
    several adapters, each of which owns its own part of `storage` or `sessions`.

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

- **Unit (Vitest):** every `core/` function table-driven; `app/` services tested with memory adapters; adapters
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

- **Risk:** Stryker, typescript-eslint or the Vitest runner do not yet support the chosen Vitest or TypeScript
  major — Mitigation: Phase 0.2 verified and pinned exact versions. Never auto-upgrade `vitest` or `typescript`
  majors (disable them in the dependency bot). Vitest 5.0.5 fails silently with Stryker (every mutant
  survives), so the `break: 100` gate would fail loudly rather than pass, but the pin avoids the confusion.
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

- [x] All source and tests are strict TypeScript; `tsc --noEmit` is blocking in CI
- [x] `collectCoverageFrom` is `src/**/*.{js,ts}` with no ignore patterns; 100% statements, branches, functions,
      lines
- [ ] Stryker reports 100% mutation score, 0 survived, 0 no-coverage, with `break: 100` in CI
- [x] Zero suppression comments (coverage, mutation, TypeScript, ESLint) or config exclusions; guard script
      blocking with an empty allow-list
- [x] No `any`, non-null assertions or type assertions in source
- [x] `core/` has no browser, DOM, `Date` or timer references
- [x] `background.js` removed; `background/main.ts` contains no logic
- [x] No direct `browser.sessions` / `browser.storage` access outside the `GroupState` adapter (outside the adapters,
      the polyfill and the composition roots, enforced by ESLint; see the Phase 6 result)
- [x] Popup and full-page view share one group store and model code; the popup is linted and formatted
- [x] `DEBUG` removed; safety aborts are unconditional and tested
- [ ] Extension loads from `dist/` in `web-ext`, Playwright and CI; E2E green on Firefox and Chromium, including
      the new cases above
- [x] `npm audit` reports 0 vulnerabilities and is a blocking CI gate; Dependabot (or Renovate) is configured
- [x] `npm run lint` (prettier, eslint, web-ext) and `npm run typecheck` clean
