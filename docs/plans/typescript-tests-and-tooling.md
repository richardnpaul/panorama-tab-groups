# Implementation Plan: TypeScript for the Remaining Tests, Scripts and Tooling

## Overview

One success criterion of `hexagonal-core-and-mutation-testing.md` is still unmet: "All source and tests are strict
TypeScript". The source under `src/` is, and so are all but six of the unit-test files. What is still JavaScript:

| Area                 | Files                                                                                                              | Lines |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ----- |
| Scripts              | `scripts/check-no-suppressions.mjs`, `scripts/copy-static.mjs`, `scripts/lib/{static-assets,suppressions}.mjs`     | 256   |
| Tests of the scripts | `tests/unit/scripts/{check-no-suppressions,copy-static,static-assets,suppressions}.test.js`                        | 777   |
| Tool stub and tests  | `tools/adbkit-stub/{index.js,index.test.js}`, `tests/unit/tools/adbkit-workspace.test.js`                          | 63    |
| Playwright config    | `playwright.config.js` (the Firefox proxy, the fixtures, the web server)                                           | 577   |
| End-to-end specs     | `tests/e2e/{extension,group-switching,integration,options-navigation,popup,tab-groups-view,user-journeys}.spec.js` | 1,884 |
| Other configuration  | `vitest.config.mjs`, `stryker.config.mjs`, `.eslintrc.js`                                                          | 150   |

`tsconfig.json` already includes `tests` and `scripts` with `allowJs` and `checkJs: false`, so none of this JavaScript is
type-checked today. ESLint's strict type-aware rules apply only to `.ts` files. The aim is that a mistake in a test or in
the guard script is caught by the same checks as a mistake in the extension.

## Requirements

- Every `.js`, `.mjs` and `.cjs` file in the repository is either converted or on a short, named list of files that must
  stay JavaScript for a reason a tool imposes (see Decision 2), and a check fails if a new one appears.
- Converted files pass `tsc` (with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, as the source does), the
  strict type-checked ESLint rules, and Prettier, with no type assertion, no `any`, and no suppression.
- Coverage stays 100% and the mutation score stays 100%: the scripts are mutated today (`scripts/**/*.mjs`), and the
  globs must follow the files.
- Every npm script, pre-commit hook and workflow that runs a converted file keeps working on every Node version the
  project supports.
- A conversion changes the type of a file, not what it does: each converted test must pass before and after with the same
  assertions.

## Decisions (made by the owner)

- **Decision 1: A, `tsx`.** **Decision 2:** the three files that must stay JavaScript are accepted. **Decision 3:** the
  end-to-end suite is converted last. The text below records the options as they were put.

1. **How are the TypeScript scripts run?** `node scripts/foo.ts` needs Node's type stripping, which is on by default
   only from Node 22.18 and 24.3 (to be confirmed against the release notes when this starts), and it needs `.ts`
   in every import specifier, which the repository forbids elsewhere (`import/extensions` has `ts: 'never'`).

   | Option                                         | For                                                                                              | Against                                                                                                                                                                              |
   | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | **A. `tsx`** (one more pinned dev dependency)  | Runs `.ts` with `.js` specifiers on every Node; the scripts import each other as the source does | Another dependency in the audit scope (it uses `esbuild`, already present through Vite)                                                                                              |
   | **B. Node type stripping**                     | No dependency                                                                                    | Needs Node ≥ 22.18 (the matrix still has 20.x, which is end of life and which the act plan already proposes to drop); `.ts` specifiers and an ESLint override for the scripts folder |
   | **C. Compile first** (`tsc` to a build folder) | No runtime dependency, any Node                                                                  | A build step in front of `lint:suppressions` and `dist:static`; two copies of each script on disk                                                                                    |

   **Chosen: A**, and revisit B when the supported Node range is settled in the workflow plan.

2. **What may stay JavaScript?** Three things are consumed by tools that read JavaScript and cannot read TypeScript:
   `.eslintrc.js` (ESLint 8's legacy configuration), `stryker.config.mjs` (Stryker loads `.json`, `.js`, `.mjs` and
   `.cjs`), and `tools/adbkit-stub/index.js` (a drop-in package that `web-ext` loads as it is). Everything else
   converts: `vitest.config.ts` and `playwright.config.ts` are supported by their tools. The three are listed in the
   guard from Phase 5, so the list cannot grow by accident.
3. **Is the end-to-end suite converted last?** Yes, and it can be a separate release of the plan: it is the largest part
   (1,884 lines, `user-journeys.spec.js` alone is 1,016), it needs the most typing work, and the unit-test side has the
   stronger safety net. The plan is written so that stopping after Phase 3 is a valid state.

## Affected Files

- `scripts/**` become `.ts`; `tests/unit/scripts/*.test.js`, `tests/unit/tools/*.test.js` become `.test.ts`.
- `vitest.config.mjs` → `vitest.config.ts`; `playwright.config.js` → `playwright.config.ts` (its fixtures move to
  `tests/e2e/fixtures.ts`); `tests/e2e/*.spec.js` → `.spec.ts`.
- `package.json` (scripts that run `node scripts/…`), `tsconfig.json` (`allowJs` off once nothing needs it),
  `.eslintrc.js` (the plain-JS test overrides for globals are deleted), `stryker.config.mjs` (mutate globs),
  `scripts/lib/suppressions.mjs` → `.ts` (the new check), `.pre-commit-config.yaml` (hook file types, if any),
  `tests/unit/scripts/static-assets.test` (a path in a sample list).

## Implementation Steps

Each step ends with `npm run typecheck`, ESLint, Prettier and the tests it touched. A converted file is first
type-checked against its existing tests unchanged, so a failure points at the types, not at behaviour.

### Phase 1: Choose the runner and convert the scripts (smallest, best covered)

1. **Decision 1 is settled (A).** Add `tsx` at an exact version, run `npm audit`, and replace
   `node scripts/…` with `tsx scripts/…` in `package.json` (`lint:suppressions`, `dist:static`, `watch:static`, which
   currently passes `node --watch-path`).
2. **Convert `scripts/lib/static-assets` and `scripts/copy-static`**, then **`scripts/lib/suppressions` and
   `scripts/check-no-suppressions`**. The guard's rules are written so the file never matches its own patterns; the
   conversion must keep that property (the test that checks it moves with the file). `readText`, `importConfig` and the
   file list become typed dependencies, so the `importConfig` parameter gets an `unknown` result and a small parser for the
   two configs, not a cast.
3. **Update the globs** that name the old paths: `stryker.config.mjs` (`scripts/**/*.mjs` → `scripts/**/*.ts`),
   `vitest.config.mjs` coverage `include`, and `ALLOWED_*`/`COVERAGE` sample strings in the tests.
   - Done when: the full unit run is 100%, a Stryker run of `scripts/**` is 100%, and `npm test` passes.

### Phase 2: Convert the tests of the scripts and tools

4. **`tests/unit/scripts/*.test.js` and `tests/unit/tools/adbkit-workspace.test.js`** to TypeScript. They use the
   `vi.mock` of `node:fs` and `node:child_process` with spread arguments, which TypeScript needs typed; use `vi.mocked`
   and typed `vi.fn` signatures rather than casts. `tools/adbkit-stub/index.test.js` converts with them; the stub itself
   stays JavaScript (Decision 2), and its test imports it through a declaration file or a typed wrapper so the test is
   checked.
5. **`.eslintrc.js`**: delete the override that gave plain-JS tests their `describe`/`it` globals once none remain.

### Phase 3: Convert the configuration that can be TypeScript

6. **`vitest.config.mjs` → `vitest.config.ts`**, typed with `defineConfig`. The guard's `importConfig` loads it, so the
   guard's loader must handle a `.ts` config (it runs under the same runner as the scripts, so a dynamic import works).
   Update the names in the guard and its tests.
7. **State check**: `tsc`, `npm test`, a forced Stryker run and the pre-commit hooks all green. This is the planned
   stopping point if Decision 3 defers the end-to-end suite.

### Phase 4: The end-to-end suite

8. **Split the fixtures from the config**: `playwright.config.js` today both configures Playwright and exports the
   extended `test` and `expect` that every spec imports (`../../playwright.config.js`). Move the fixtures and the Firefox
   proxy to `tests/e2e/fixtures.ts`, leaving `playwright.config.ts` as `defineConfig(...)` only. Specs then import from
   `./fixtures.js`. Do this in JavaScript first, with the suite green, so the move and the typing are separate steps.
9. **Type the fixtures**: the extension id, the protocol, the page proxy (a `Proxy` over `Page` that rewrites
   `moz-extension://` URLs for Firefox) and the persistent-context launch for each browser. The `Proxy` handler is the hard
   part; type it with the `Page` method signatures it forwards, with no assertion, and keep the existing property
   `panoramaExtensionId` as a typed field on a wrapper rather than on the Playwright context.
10. **Convert the specs, smallest first**: `options-navigation`, `tab-groups-view`, `integration`, `extension`,
    `group-switching`, `popup`, then `user-journeys` (21 `evaluate` calls, many large). Code inside `page.evaluate` runs in
    the page, so it is checked against the DOM and the `browser` types from `firefox-webext-browser`; where the page-side
    data is `unknown`, parse it with the guards in `share/guards.ts` rather than assert. After each file, run that spec on both
    browsers, and after the last, the whole suite (59 passed, 9 skipped at the time of writing).
11. **Remove the leftovers**: `allowJs` from `tsconfig.json`, and the `.js` branches of the `include`/`files` patterns in the
    pre-commit hooks and ESLint overrides.

### Phase 5: Make it stay that way

12. **Extend the guard** (`scripts/lib/suppressions.ts`): fail when a tracked `.js`, `.mjs` or `.cjs` file exists that is
    not on the list of three from Decision 2. Table-driven tests, 100% mutation, as for the rest of the guard.
13. **Close-out**: full `npm test`, forced Stryker run, full E2E on both browsers, `pre-commit` (all files and staged),
    a "Result" section here, and the criterion ticked in `hexagonal-core-and-mutation-testing.md`.

## Risks and Mitigations

- **Typing the Playwright fixtures is slow and is where a cast is most tempting.** Mitigation: Phase 4 is separable, the
  `Proxy` is typed with the forwarded method signatures, and if a genuine case needs a cast it is raised as a decision, as
  in earlier phases.
- **The strict type-aware ESLint rules will flag a lot in test code** (`no-unsafe-*`, `require-await` in mock
  implementations, `unbound-method` on `expect(browser.fn)`, which Phase 4 of the main plan already met and solved by
  keeping the mocks in variables). Mitigation: fix the code, never the rule; the same patterns are already in
  `tests/unit/popup/*`.
- **A script that runs in CI on every Node version stops working on an old one** if Decision 1 is B. Mitigation: Option A
  is the recommendation, and the act plan's matrix change is settled first or together.
- **The guard loads the Vitest config**, so converting that config can break the guard that protects it. Mitigation:
  step 6 changes both in one commit and runs the guard's own tests and `npm run lint:suppressions` before anything else.
- **`tools/adbkit-stub` cannot be checked as TypeScript.** Mitigation: it is eleven lines, is covered and mutated at 100%,
  and is on the explicit list, so it is a recorded exception and not a hole.

## Result

Done in the order of the phases, with the end-to-end suite last (Decision 3). Everything in the repository is
TypeScript except the three files of Decision 2, and the suppression guard now fails on any other JavaScript file.

- **Phase 1.** `tsx` is pinned at 4.23.15 (`npm audit`: 0 vulnerabilities) and runs `lint:suppressions`,
  `dist:static`, `watch:static` (`node --watch-path=src --import tsx …`, so the watching is unchanged) and the
  `no-suppressions` pre-commit hook. One addition the plan did not foresee: **`scripts/package.json`** with
  `"type": "module"`. `tsx` decides between ESM and CommonJS by the nearest `package.json`, the root one has no `type`,
  and the guard uses top-level `await`, which CommonJS does not allow. Setting `"type": "module"` at the root instead
  would have made `.eslintrc.js` (CommonJS) fail to load, and renaming it would change the list of Decision 2.
  - The guard's dependencies are typed (`Repository`); `importConfig` returns `unknown`, and the configs are read
    through a `field` accessor over the guards of `src/js/share/guards.ts`, not cast. Two small exported helpers came
    out of that: `defaultExportOf` (the default export of a loaded module) and `parseAllowlist` (only numbers are
    allowances).
  - `listHookExcludes` takes the captured path with `flatMap((match) => match.slice(1, 2))`: the obvious
    `.map((m) => m[1]).filter(isString)` would leave a filter that can never remove anything, an equivalent mutant.
  - Stryker over `scripts/**/*.ts`: 226 mutants, 100%.
- **Phase 2.** All six unit tests of the scripts and tools are TypeScript, mocks typed with `vi.fn<…>()`, no cast.
  The stub stays JavaScript and its test reads it through `tools/adbkit-stub/index.d.ts`; `tools` joins the `tsconfig`
  `include` so that test is checked. Because the stub is a package of its own, its test needs an
  `import/no-extraneous-dependencies` override pointing at the root `package.json` (configuration, not a suppression).
  The plain-JS test globals override in `.eslintrc.js` is gone.
- **Phase 3.** `vitest.config.ts` uses `defineConfig`; the guard loads it through `tsx`, and lowering a threshold in it
  was shown to fail the guard. Its test `include` is now `.ts` only. **Follow-up:** Vite prints a notice that a `.ts`
  config in a package without `"type": "module"` will not load with its future native loader. It is a warning today;
  the fixes are `vitest.config.mts` or a root `"type": "module"` (which brings `.eslintrc.cjs` with it), and both
  change a name this plan fixed, so neither was made here. **Done since:** the root `package.json` has
  `"type": "module"`, `.eslintrc.js` is `.eslintrc.cjs` (the entry in `ALLOWED_JAVASCRIPT_FILES` changed with it), and
  `scripts/package.json`, which only existed for the guard, is gone. The notice no longer appears, and Playwright,
  Stryker, `tsx` and `web-ext` were each run to check. `eslint-10-flat-config.md` replaces `.eslintrc.cjs` in turn.
- **Phase 4.** `playwright.config.ts` holds only `defineConfig`; the fixtures and the Firefox proxy are in
  `tests/e2e/fixtures.ts`, split first in JavaScript with the suite green. The typing choices:
  - The Firefox extension id lives in a `WeakMap<BrowserContext, string>` rather than on the context object.
  - The page proxy implements `goto` and `url` as `Page['goto']` and `Page['url']`; any other method is forwarded with
    `Reflect.apply` into an `unknown` result, because `Function.prototype.bind` returns `any`.
  - `prefs.js` and the manifest are parsed with the guards of `share/guards.ts`; `process.env` is filtered to defined
    values because the Firefox launch `env` does not accept `undefined`.
  - In the specs, code inside `page.evaluate` is serialized, so it cannot call an imported guard: values from
    `sessions` (typed `string | object | undefined`, though the extension stores numbers and arrays) are narrowed
    in-line or read as `unknown`. A helper that returns a tab's or window's id throws where the old code would have
    passed `undefined` to the browser.
  - Calls in the Chromium service worker use `browser` instead of `chrome`: the polyfill makes them the same object
    there, and only `browser` has types.
  - `user-journeys.spec.ts` had five copies of "make the group active and open tabs in it"; they are one typed helper
    that keeps the same order of calls.
  - Counts: 68 tests listed before and after, 60 passed and 8 skipped on both browsers before and after. One full run
    during the conversion reported 59 passed, with the 68th outcome hidden by how the output was filtered; the rerun
    and every run since gave 60/8.
- **Phase 5.** The guard's `listJavaScriptFiles` reports a `javascript|<file>` violation for any `.js`, `.mjs` or `.cjs`
  file not in `ALLOWED_JAVASCRIPT_FILES`; a stray `src/js/stray.js` was shown to fail `npm run lint:suppressions`.
  `allowJs` and `checkJs` are gone from `tsconfig.json`.
- **Found on the way:** the forced Stryker run failed its dry run on the stub workspace test, which compared the
  resolved stub with `tools/` under the working folder. In Stryker's sandbox the working folder is a copy while
  `node_modules` still links to the repository, so the two differ. The test now compares with the `tools/` folder
  beside the `node_modules` in use, which is what "npm links the in-repo stub" means.
- **Close-out:** `npm test` green (109 files, 2,723 tests, 100% on all four metrics); forced Stryker run
  100% (3,781 mutants: 3,771 killed, 10 timed out, 0 survived, 0 without coverage; it first showed one survivor, an equivalent mutant in the new memory `Shortcuts` fake, removed by restructuring `reset`); E2E 64 passed and 8 skipped on both browsers (the 60/8 of before plus the 4 new options cases); `pre-commit run --all-files` green. The Node matrix is now Node 26 only
  (`act-local-workflow-testing.md`); `npm ci`, the whole `npm test`, the E2E suite and the full mutation run
  also passed on Node 26.12.1 under `act`, so the first run on GitHub is the only thing left to see.

## Success Criteria

- [x] No tracked `.js`, `.mjs` or `.cjs` file exists outside the three named in Decision 2, and the guard fails if one appears
- [x] `tsc --noEmit` covers the scripts, the tests and the end-to-end suite with `allowJs` removed
- [x] The converted files pass the strict type-checked ESLint rules with no suppression, no assertion and no `any`
- [x] Coverage 100%, mutation 100% (full forced run), `npm test` green on every Node version in the matrix (Node 26 is the only one, under `act`; GitHub has not run it yet)
- [x] The end-to-end suite passes on both browsers with the same counts as before the conversion
- [x] The criterion is ticked in `hexagonal-core-and-mutation-testing.md`
