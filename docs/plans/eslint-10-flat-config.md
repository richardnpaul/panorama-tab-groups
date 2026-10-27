# Implementation Plan: Move to ESLint 10 and the Flat Configuration

## Overview

`npm ci` prints eight deprecation warnings. Six of them come from the ESLint 8 the project uses
(`eslint@8.57.1`, `@humanwhocodes/config-array`, `@humanwhocodes/object-schema`, and through `flat-cache`: `rimraf@3`,
`glob@7`, `inflight`). The other two come from `web-ext` → `addons-linter`, which pins its own `eslint@9.39.4` and
`cheerio` → `whatwg-encoding`; `web-ext` 10.8.0 and `addons-linter` 10.14.0 are the latest releases, so those two
cannot be fixed here.

Moving ESLint is more than a version change, which is why the earlier answer was "not cleanly". This plan records
what was found by trying it, so the decision is made on evidence.

## What was tried (a throwaway copy of the repository, nothing in the repository changed)

ESLint 10.13.0 was installed in a copy, with the plugins that block it replaced, and a flat configuration was built
that reproduces the present one. Then:

- The whole repository lints clean with ESLint 10 in 8 seconds. The one complaint is that `@typescript-eslint/parser`
  is only a transitive dependency and would have to be listed.
- ESLint 10's resolved configuration for 11 sample files (source, adapter, composition root, unit test, end-to-end
  test, script, both configs, the stub and its test, a `.mjs` file) has **the same rules as ESLint 8's**, by name and by
  option (ESLint 10 prints the defaults it fills in, which is the only difference): 240 rules on TypeScript files,
  178 on JavaScript files, none missing and none extra.
- A file of 27 deliberate violations (unresolved and extensionless imports, `any`, a non-null assertion, a type
  assertion, `browser` and `.storage` outside an adapter, `var`, `with`, `eval`, loose equality, a floating promise and
  more) gives **identical findings, rule by rule and line by line**, under ESLint 8 and ESLint 10.
- A fresh `npm ci` leaves two deprecation warnings (`eslint@9.39.4` and `whatwg-encoding`, both from `web-ext`) and
  `npm audit` finds 0 vulnerabilities.

## Second trial: `eslint-config-airbnb-extended` instead of a snapshot

`eslint-config-airbnb-extended` 3.3.0 (published 2026-10-02) is a maintained, flat-native reimplementation of the Airbnb
rules with TypeScript support, so it was tried in a second throwaway copy, with the project's strict
`typescript-eslint` sets and its deliberate overrides layered on top:

- **It works on ESLint 10, though it declares `eslint ^9` only.** An `overrides` entry in `package.json`
  (`"eslint-config-airbnb-extended": { "eslint": "$eslint" }`) satisfies npm; the lint ran and gave the same result as
  on ESLint 9.
- **The repository has three findings, none in source code:** the two configuration files that import development
  dependencies and the stub's test (each handled today by an override that has to be ported), and `process` in
  `stryker.config.mjs` (the package sets no Node globals; the `globals` package does). Lint time is the same, 10 s.
- **The rules differ from today's, which is the point and the cost.** Of the 240 rules enforced on TypeScript, 170 are
  the same by name. The differences, besides the strict `typescript-eslint` rules that stay as they are:
  - Core rules become their TypeScript-aware versions (`no-shadow`, `no-use-before-define`, `prefer-destructuring`,
    `default-param-last`, `no-loop-func`, and `camelcase` becomes `@typescript-eslint/naming-convention`).
  - Rules that no longer exist or moved out of core are gone (`global-require`, `no-new-require`, `no-path-concat`,
    `no-buffer-constructor`, `lines-around-directive`, `no-new-object`, `valid-typeof`, and `import/named` and
    `import/no-named-as-default-member`, which the compiler covers).
  - New: `import/no-cycle` and `import/prefer-default-export` (both off today by choice, so they stay off),
    `import/default`, `import/namespace`, `import/no-empty-named-blocks`, `import/no-rename-default`,
    `prefer-object-has-own`, `prefer-promise-reject-errors`, `no-new-native-nonconstructor`, and three `@stylistic`
    rules (which Prettier turns off).
- **On the 27-violation file** 22 of 27 findings are identical. The others are the browser-boundary rules (not ported
  in the trial), the TypeScript form of `prefer-destructuring`, and the import rules and `no-restricted-syntax`, which
  need the project's settings. They show what the Phase 1 test has to pin.
- **What it costs.** It declares React, Next.js, accessibility and React-hooks plugins as ordinary dependencies, which
  this project never uses: 67 more packages (865 against 787 in the installed tree) and 31 MB in `node_modules`, and more code in the supply chain of a
  repository that has just pinned its actions by SHA. It is a single package maintained by a small group; I did not
  assess its bus factor. It lags ESLint by a major (the `overrides` entry is the visible sign), and ESLint 11 would
  again need an override or a release.

## Other tools tried: oxlint and Biome

Both were tried in a throwaway copy against today's rules (the ESLint 10 configuration of the first trial, which
reproduces them exactly), using each tool's own migration command and the same two fixtures (27 general violations, and
25 deliberate type-aware ones: floating and misused promises, `any` flowing through assignments, calls and returns,
unnecessary conditions, template-literal operands, unbound methods, a thrown string and so on).

|                                                                                                                | ESLint 10 + airbnb-extended                               | oxlint 1.89 + tsgolint 7                                                                           | Biome 2.6                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules of today's 270 it can take                                                                               | all (by design, with about twenty changed)                | 240 migrated, 24 skipped                                                                           | 173 directly, about 198 counting "inspired" ones                                                                                                                                                                                                                |
| Type-aware rules (`no-floating-promises`, `no-unsafe-*`, `restrict-template-expressions`, `unbound-method`, …) | yes                                                       | **yes, 25 of 25 findings identical to ESLint's** (`tsgolint` calls itself stable since 2026-07-22) | **36 TypeScript rules not implemented**, including the whole `no-unsafe-*` family, `restrict-template-expressions`, `unbound-method`, `await-thenable` and `consistent-type-assertions`; `no-floating-promises` and `no-misused-promises` only as nursery rules |
| Whole repository                                                                                               | 10 s                                                      | **0.55 s** (1.1 s with the JS plugins below)                                                       | not measured; fast, but see above                                                                                                                                                                                                                               |
| Needs a flat-config rewrite                                                                                    | yes                                                       | **no** (one `.oxlintrc.json`)                                                                      | no (`biome.json`)                                                                                                                                                                                                                                               |
| ESLint left in `node_modules`                                                                                  | 10, plus 67 packages for React, Next.js and accessibility | none of its own; only `web-ext`'s `eslint@9.39.4`                                                  | none of its own                                                                                                                                                                                                                                                 |
| `npm ci` deprecation warnings that remain                                                                      | 2 (from `web-ext`)                                        | 2 (from `web-ext`)                                                                                 | 2 (from `web-ext`)                                                                                                                                                                                                                                              |

**Biome is not an option for this project.** It does cover the general rules, but "no `any`, no type assertions, no
unchecked values" is enforced here by the type-aware rules above, and Biome has no equivalent for about a third of
them. The online reports are right. (Biome as a formatter in place of Prettier is a separate question, not looked at.)

**Oxlint is a real alternative to ESLint**, and its migration command is honest about what it cannot take. The gaps,
and what was done about each in the trial:

| Gap                                                                                | In this project                                                                          | Trial                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-restricted-syntax` (selectors)                                                 | the `.storage` / `.sessions` half of the browser boundary                                | a rule of our own as a JS plugin, 20 lines, loaded with `jsPlugins`: fires on the violation at the right lines, silent in an exempt adapter |
| ignore list inside an `override`                                                   | the list of files exempt from the boundary                                               | a later override that turns the rules off for those files; same effect, verified                                                            |
| `import/no-extraneous-dependencies`                                                | catches an import of a package that is only installed by accident                        | `eslint-plugin-import-x` loaded as a JS plugin under another name (`import-x-js`); works, but it pulls `eslint` in as a peer                |
| `import/no-unresolved`, `import/order`, `import/no-useless-path-segments`          | all but the first are cosmetic; an unresolved import is already a compile error in `tsc` | dropped                                                                                                                                     |
| `@typescript-eslint/no-unsafe-enum-assignment`                                     | the compiler option `erasableSyntaxOnly` already forbids enums                           | dropped                                                                                                                                     |
| Deprecated or stylistic rules (`camelcase`, `spaced-comment`, `global-require`, …) | superseded by rules it does implement                                                    | dropped                                                                                                                                     |
| Linting JSON                                                                       | `eslint-plugin-json` only checked syntax                                                 | dropped; Prettier and the `check-json` hook already do it                                                                                   |

Other differences to know: a syntax error stops oxlint's analysis of that file (ESLint's parser tolerated a `with`
statement in a module and went on); `import/no-duplicates` compares the text of the specifier, so `x.ts` and `x.js` are
not one module to it (such an import is already forbidden by `import/extensions`); and the JS plugin interface is
labelled alpha by oxlint. A fresh install of the whole toolchain without a lockfile also showed two moderate advisories
(`qs`, in a transitive dependency of a development tool); that comes from re-resolving without our lockfile, not from
oxlint, and the repository's lockfile audits clean.

## Why not ESLint 9

ESLint 9 is on the `maintenance` tag (9.39.5 is the last), and **9.39.5 is deprecated too**, as is 9.39.4. Moving to 9
would leave the project's own ESLint deprecated, and add nothing that 10 does not. Everything above was tried on 10.

## What blocks the move, and the replacement for each

| Today                                             | Problem                                                                                                                           | Replacement                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `eslint@8`, `.eslintrc.cjs`, `.eslintignore`      | ESLint 10 reads only the flat configuration; `.eslintrc*` and `.eslintignore` are gone (it warns that `.eslintignore` is ignored) | `eslint.config.mjs`, with `ignores` for what `.eslintignore` held                                                                  |
| `eslint-config-airbnb-base@15.0.0`                | Last release 2021, peer dependency `eslint ^7 \|\| ^8`; it is a legacy shareable config                                           | `eslint-config-airbnb-extended`, or its resolved rules kept in the repository (see Decision 1)                                     |
| `eslint-plugin-import@2.32.0`                     | Peer dependency stops at ESLint 9                                                                                                 | `eslint-plugin-import-x@4` (peer `^10`), the maintained fork, registered under the name `import` so the rule names stay `import/…` |
| `eslint-plugin-json@3.1.0`                        | Calls `context.getFilename()`, which ESLint 10 removed                                                                            | `@eslint/json`, the official plugin                                                                                                |
| `eslint-import-resolver-typescript@4.4.5`         | Fine as it is; it exports `createTypeScriptImportResolver` for `import-x`                                                         | Kept, used through `settings['import-x/resolver-next']`                                                                            |
| `@typescript-eslint/*` (`typescript-eslint@8.72`) | Already supports ESLint 10                                                                                                        | Kept; `@typescript-eslint/parser` becomes a direct dependency                                                                      |
| `--ext=.js,.mjs,.cjs,.ts,.json` in the scripts    | `--ext` does not exist in the flat configuration; files are chosen by `files` in the config                                       | The scripts become `eslint .`                                                                                                      |
| `eslint-config-prettier`                          | Fine (peer `>=7`); in the flat configuration it is a config object that goes last                                                 | Kept, last in the list                                                                                                             |

Not a problem, found by trying: none of the 178 rules airbnb enables, nor any option they carry, was removed or
changed in ESLint 10, and `import-x` has every `import/…` rule the configuration uses.

## Decisions (for the owner)

1. **What replaces `eslint-config-airbnb-base`?** It cannot be installed next to ESLint 10 without an `overrides`
   entry that hides its peer dependency, and it will not be updated again.
   - **A. `eslint-config-airbnb-extended` (the conservative choice).** The maintained successor, flat-native and TypeScript-aware,
     so there is no list of rules for the project to own. It lints this repository with three findings, none in
     source (see the second trial). It needs one `overrides` entry for ESLint 10, drags in React and Next plugins the
     project does not use, and changes about twenty rules (listed above), which the Phase 1 test records and the owner
     reviews once.
   - B. Keep today's resolved rules in the repository (`eslint/rules-*.json`, written by a one-off script from
     `eslint --print-config`). Nothing changes in what is enforced, shown rule for rule on ESLint 10, and there is no
     extra dependency. The cost is about 300 rules of uncommented JSON that nobody upstream maintains, and the
     TypeScript-unaware core rules stay as they are.
   - C. Keep airbnb through `@eslint/eslintrc`'s `FlatCompat` and an `overrides` entry for the peer dependency. Keeps a
     dead package and a hidden peer conflict, and does not run on ESLint 10 without more.
   - D. `eslint:recommended` plus a short chosen list. Smallest and most readable, but it changes what is enforced
     and needs its own review of what to keep.

   - E. **Leave ESLint for oxlint** (see "Other tools tried"): the same type-aware checks, half a second to a
     second instead of ten, no flat-config rewrite, and no ESLint of ours in the tree. The cost is a younger tool whose
     JS plugin interface is alpha (used here only for a 20-line rule of our own and, optionally, for
     `import/no-extraneous-dependencies`), a few rules dropped (listed above), and a change of what the suppression
     guard reads: `.oxlintrc.json` (`ignorePatterns`, `overrides`) instead of `.eslintignore`, and `oxlint-disable` as
     well as `eslint-disable` comments.

   **Recommendation after all three trials: E, with A as the fallback.** Oxlint matched ESLint on every type-aware check
   tried, is roughly ten times faster, avoids the flat-config rewrite and leaves ESLint out of our own dependencies,
   which also ends the six deprecation warnings this plan started from. The price is a younger tool and one alpha
   interface (JS plugins) for two things: the 20-line boundary rule, and, if wanted,
   `import-x`'s `no-extraneous-dependencies`. If either is unwelcome, A is a safe, well-trodden choice that lints
   the same code with about twenty rule changes. B is exactly what runs today but leaves 300 rules of JSON to own.
   Biome is excluded (36 type-aware TypeScript rules missing).

   **If E is chosen, Phases 2 and 3 are rewritten, Phase 1 stays as it is:** the test of the lint runs `oxlint` instead
   of the `ESLint` class (JSON output, rule ids normalised); `.oxlintrc.json` (generated once by `@oxlint/migrate`, then
   edited by hand: the plugins removed, the exempt files as a later override, the `jsPlugins` entries added) replaces
   `.eslintrc.cjs` and `.eslintignore`; `lint:eslint` becomes `oxlint --type-aware`; the pre-commit hook runs
   `oxlint`; the guard reads `ignorePatterns` and `overrides` from `.oxlintrc.json` and counts `oxlint-disable`
   comments; the editor uses the oxc extension; the three accepted JavaScript files become two (`.eslintrc.cjs` goes,
   and the boundary plugin is `.mjs` and is added, so the list stays at three). `eslint` and its plugins leave
   `package.json` (the two remaining warnings, from `web-ext`, stay).

2. **Where does the configuration live?** `eslint.config.mjs` takes the place of `.eslintrc.cjs` in the list of
   JavaScript files that tools must read as JavaScript, so the list stays at three. (`eslint.config.ts` needs `jiti`
   and would remove the exception, at the price of another dependency.) Recommended: `.mjs`.
3. **`import-x` for `import`, `@eslint/json` for `eslint-plugin-json`:** no real alternative; recorded for review.

## Requirements

- What ESLint enforces on every file is unchanged by the move: the same rules with the same options, and the same
  findings on a fixed set of deliberate violations.
- The `browser`/`chrome`/`.storage`/`.sessions` boundary rule of `options-port-and-browser-access.md` and its list of
  exempt files are carried over exactly.
- Lowering the lint is as guarded as before: the suppression guard looks at `ignores` in the new configuration the
  way it looked at `.eslintignore`, which today it would not see.
- `npm run lint`, `npm run format`, the pre-commit hook and the editor integration keep working.
- `npm ci` prints no deprecation warning that this project controls.

## Affected Files

- New: `eslint.config.mjs`, `eslint/rules-*.json` (only with Decision 1B), `tests/unit/lint-config.test.ts` and its fixture.
- Removed: `.eslintrc.cjs`, `.eslintignore`.
- Changed: `package.json` (dependencies and the `lint:eslint` and `format:eslint` scripts), `package-lock.json`,
  `scripts/lib/suppressions.ts` and its test (the ignore check, the list of JavaScript files),
  `.pre-commit-config.yaml` (hook file types), `.github/copilot-instructions.md`, `CONTRIBUTION.md`, `TESTING.md`
  (names of the files), `.github/dependabot.yml` (the ESLint major pin, if wanted).

## Implementation Steps

Each step ends with `npm run typecheck`, `npm run lint` and the tests it touched.

### Phase 1: A test that holds the lint still, on ESLint 8

1. **`tests/unit/lint-config.test.ts`**: uses the `ESLint` class (`lintText` with a `filePath`) to lint a fixture of
   deliberate violations and expects the exact list of rule ids and lines, once for a file in `src/` (boundary rules
   on), once for an adapter (off), once for a test file, once for a plain `.mjs` file. The fixture is held as text so
   the repository itself does not contain the violations. It passes on ESLint 8 now and must pass **unchanged** on 10.
   - Done when it passes, and fails if one rule is switched off (checked by hand).
2. **Snapshot** the resolved configuration of the 11 sample files (`eslint --print-config`) outside the repository, as
   the baseline for the comparison in Phase 2.

### Phase 2: The new configuration

3. **Dependencies** (`package.json`): `eslint` 10.13.0 exact; add `eslint-plugin-import-x` (1B; 1A brings it),
   `@eslint/json`, `globals`, `@typescript-eslint/parser` (and the plugin if it is imported), and with 1A
   `eslint-config-airbnb-extended` with its `overrides` entry; remove `eslint-config-airbnb-base`,
   `eslint-plugin-import`, `eslint-plugin-json`. Run `npm audit`.
4. **`eslint.config.mjs`** in layers (with Decision 1A the rules come from `eslint-config-airbnb-extended`'s
   `base.recommended` and `base.typescript` and its plugin configs; with 1B they come from `eslint/rules-*.json`, written
   by a one-off script from the snapshot): ignores; JavaScript and TypeScript files (globals from `globals`: browser, es2021, node, webextensions, plus
   `browser`); TypeScript (parser with `projectService`, the TypeScript rule layer); the browser boundary on `src/**`
   minus the exempt files (the list from `options-port-and-browser-access.md`, now in one place); the config files that
   may import development dependencies (`eslint.config.mjs`, `playwright.config.ts`, `vitest.config.ts`); the stub's test
   (`packageDir`); JSON files; `eslint-config-prettier` last.
5. **Compare**: with 1B, `eslint --print-config` on the 11 files against the baseline (rule names equal, options equal
   after the defaults ESLint 10 fills in) and Phase 1's test passing unchanged. With 1A the rules differ by design: list
   each difference, decide it (keep the new rule, or turn it off as the project does today for `no-console`, `no-alert`,
   `no-param-reassign` and `import/no-cycle`), and change the expectations of Phase 1's test in the same commit, one
   line per decision. Fix the configuration, never the baseline.
6. **Delete** `.eslintrc.cjs` and `.eslintignore`. Dot-files and dot-folders are ignored in the config (`**/.*`), as
   ESLint 8 did by default.

### Phase 3: Around it

7. **Scripts and hooks**: `lint:eslint` and `format:eslint` lose `--ext`; the `eslint` pre-commit hook's `files` pattern
   stays (it passes the files that changed). Check the hook on a staged file, and the editor.
8. **The guard** (`scripts/lib/suppressions.ts`): `.eslintignore` and `.prettierignore` are read today
   (`ALLOWED_IGNORE_ENTRIES`). Add a check of `ignores` in `eslint.config.mjs`, loaded through `importConfig` like the
   Vitest and Stryker configs, with the same allowed list of generated folders. Without it, ignoring a source folder
   in the new configuration would pass the guard. Table-driven tests, mutation 100%.
   Replace `.eslintrc.cjs` by `eslint.config.mjs` in `ALLOWED_JAVASCRIPT_FILES`.
9. **Docs**: the names of the files in `CONTRIBUTION.md`, `.github/copilot-instructions.md`, the remarks in
   `typescript-tests-and-tooling.md` and `options-port-and-browser-access.md` stay as they are (they record decisions
   at the time); a note in each result points here.

### Phase 4: Close-out

10. Full `npm test`, a forced Stryker run, the E2E suite on both browsers (nothing in them should change), `pre-commit
run --all-files`, `act` on `node.js.yml` and `pre-commit.yml`, a fresh `npm ci` to read the warnings, a "Result"
    section here, and the success criteria ticked.

## Risks and Mitigations

- **Silent loss of a rule in the translation.** Mitigation: Phase 1's test, written before the change and run
  unchanged after; the comparison of resolved configurations; the same 27-violation fixture as in the trial.
- **`eslint-plugin-import-x` differs from `eslint-plugin-import` in a rule the 27 violations do not reach**
  (`no-cycle`, `no-named-as-default`). Mitigation: the project's own lint is clean on both; rules that are on are
  listed by the comparison; the fixture gains a case for any rule that matters when the plugin is swapped.
- **1A: the package follows ESLint late and carries unused plugins.** Mitigation: ESLint is pinned exactly and the
  `overrides` entry is commented; the cost is visible in `npm ls`, and B remains available (the snapshot can be taken
  from the working configuration at any time).
- **1B: the snapshot is a wall of rules nobody reads.** Mitigation: it is generated from a script kept in the pull
  request description and the layers are separate files; pruning it (Decision 1D) is a later change that this one
  makes possible and does not make.
- **Editor integration.** The ESLint extension of VS Code finds `eslint.config.mjs` by itself; checked in Phase 3.
- **Dependabot.** ESLint 11 and plugins that lag it. Mitigation: `eslint` stays pinned exactly, as `vitest` and
  `typescript` are (their reasons are in `.github/dependabot.yml`).
- **Time.** The trial took less than an hour and found no rule that could not be carried over. Expect half a day for
  the real change with the guard and the tests.

## Result

Decision 1E was taken at the owner's request: the project left ESLint for oxlint. The ESLint 10 and
`airbnb-extended` routes above were trials only and are not in the repository.

- **Dependencies.** `eslint`, `eslint-config-airbnb-base`, `eslint-config-prettier`, `eslint-plugin-import`,
  `eslint-plugin-json`, `eslint-import-resolver-typescript`, `typescript-eslint` and `@typescript-eslint/eslint-plugin`
  are gone from `package.json`; `oxlint` 1.89.0 and `oxlint-tsgolint` 7.0.2005 are added, pinned exactly. `npm audit`:
  0 vulnerabilities. A clean `npm ci` in the Node 26 runner image prints two deprecation warnings, `eslint@9.39.4` and
  `whatwg-encoding`, both `web-ext`'s. (npm also installs ESLint 10 as a peer of one of `web-ext`'s dependencies; nothing
  of ours uses it.)
- **Configuration.** `.oxlintrc.json`, written by `@oxlint/migrate` from the ESLint 10 trial configuration and then
  edited: 240 rules (the 24 it skipped are in `CONTRIBUTION.md`), the `src/**` browser boundary as an override with a
  later override that turns it off for the exempt files, `options.typeAware: true`, and `tgv/no-browser-storage`
  as a plugin. `.eslintrc.cjs` and `.eslintignore` are deleted. `eslint-disable` and `oxlint-disable` are both
  suppressions to the guard.
- **The plugin is TypeScript.** `tools/oxlint/boundary-plugin.ts` is 38 lines, loaded by oxlint directly (Node 26 strips
  the types), with its own small types because oxlint exports none for plugins. It is unit tested (13 tests), in the
  coverage and Stryker scope, and mutation tested at 100% (an equivalent mutant in the first version, `?? ''`, was removed
  by restructuring). No new JavaScript file: the accepted list is now two (`stryker.config.mjs`, the stub).
- **Not carried over.** `import/no-extraneous-dependencies` was tried as a JS plugin and dropped: installing
  `eslint-plugin-import-x` for it pulled ESLint 8.57.1 back in as its peer and with it the six deprecated packages this
  work removes. It was restored at the owner's request with **knip** instead (below).
- **Knip, added afterwards.** `knip` 6.41.0 (the newest release at least 14 days old) is pinned exactly and runs as
  `lint:knip` (part of `npm run lint`, under a second) and as an always-run pre-commit hook. On the first run it found
  real things: `tslib` in `dependencies` that nothing imports (removed), `main: "index.js"` pointing at no file
  (removed), `vite/client` imported by a test but only present through Vitest (`vite` 8.3.5 is now listed), the stub
  `@devicefarmer/adbkit` resolved by a test but not listed (now a development dependency, which npm links to the
  workspace), and an export used nowhere (un-exported). It was shown to report an import of an unlisted package. Its
  configuration (`knip.json`) names three system tools as binaries (`act`, `pre-commit`, `pkill`), the test fixture that
  is loaded by a path written as text. It first also listed `@playwright/mcp` (a development dependency that nothing in the
  repository refers to); the owner was not sure it was used, so it was removed together with that exception, and
  `ignoreDependencies` is now forbidden in the file altogether. The guard fails on any other `ignore…`, `rules`,
  `include`, `project` or entry in it, and on the
  knip tags `@public`, `@internal` and `@lintignore`; each was shown to fail. One limit: `src/` is not checked for dead
  code, because `import-side-effects.test.ts` imports every module there with `import.meta.glob`, which knip follows.
- **Phase 1, as it was done.** The test of the configuration (`tests/unit/lint-config.test.ts`, with fixtures kept as
  `.txt` in `tests/unit/lint-fixtures/`) was written against oxlint, not against ESLint 8 first: its expectations are
  oxlint's findings on the two fixtures, which in the trials equalled ESLint's (all 25 type-aware findings; and the
  general fixture except the rules listed above). It lints the fixtures in a project of its own with the real config,
  plugin and `tsconfig.json`, and checks that generated code and dot-folders are skipped and that an adapter may name
  the browser. Switching `no-floating-promises` off made it fail, as intended.
- **The guard** reads `.oxlintrc.json` (`ignorePatterns` limited to generated output and dot-folders, `options.typeAware`
  must stay on), counts `oxlint-disable`, no longer reads `.eslintignore` and no longer allows `.eslintrc.cjs`. A stray
  JavaScript file and an `ignorePatterns` entry for `src/js/options/**` were each shown to fail it. It does not look
  at the per-file `off` entries of `overrides`, which is how the exempt files of the boundary are written.
- **Around it.** `lint:oxlint` and `format:oxlint` replace the ESLint scripts; the pre-commit hook runs `oxlint`; the
  devcontainer recommends the oxc extension; Dependabot no longer pins `typescript-eslint`; the docs name the new files.
- **An incident worth recording.** A `rm -rf node_modules package-lock.json` meant to force a clean resolve failed
  halfway (`node_modules` is a mounted volume) and removed the lockfile. It was restored from git and only the stale
  ESLint 8 entry was removed from it, so nothing unrelated moved: the five packages whose versions changed are the
  ESLint ones and `esquery`/`eslint-scope`/`file-entry-cache`/`flat-cache`, all of them ESLint's own.
- **Speed.** The linter takes 0.55 to 1.1 s on the whole repository, where ESLint took 8 to 10 s.
- **Close-out.** `npm test` green (113 files, 2,798 tests, 100% on all four metrics, 0 oxlint findings, knip clean); forced Stryker
  run 100% (3,845 mutants: 3,836 killed, 9 timed out, 0 survived); E2E 64 passed and 8 skipped on both browsers, with no Node deprecation warning; `pre-commit run --all-files` green; `act` on `node.js.yml` and `pre-commit.yml` green.

## Success Criteria

These replace the criteria written for the ESLint 10 route.

- [x] No ESLint of ours in `package.json`; `eslint-config-airbnb-base`, `eslint-plugin-import`, `eslint-plugin-json`,
      `.eslintrc.cjs` and `.eslintignore` are gone
- [x] `tests/unit/lint-config.test.ts` pins the rules and lines found on deliberate violations, and fails when a rule is
      switched off
- [x] The rules differ from the old ones only as listed (Result, and `CONTRIBUTION.md`)
- [x] The suppression guard fails when a source folder is added to `ignorePatterns`
- [x] `npm ci` prints only the two deprecation warnings that come from `web-ext`
- [x] `npm test`, the forced Stryker run, the E2E suite and `pre-commit run --all-files` pass
