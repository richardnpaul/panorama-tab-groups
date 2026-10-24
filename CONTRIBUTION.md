# How to contribute

**Table of content**

- [In General](#in-general)
- [Translations](#translations)
- [Dependency security](#dependency-security)

## In General

If you've never contributed to a project before, [this guide](https://github.com/firstcontributions/first-contributions/blob/master/README.md) is a good place to start. It's also available in multiple languages.

## Translations

The translations are located in `/src/_locales/`. Beneath this directory each language is split into its own directory. In the language directory the translations are structured in the `messages.json` file.

For deeper insight it's recommended to read the [Internationalization guide for web extensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization).

### Update translation

1. Open the messages.json file for the target language.
1. Alter the `message` text for the translation to update.

### Add language

1. Create a directory with the short language code. Allowed are identifiers like `de_DE` or `de`, where the latter is the fallback.
1. Copy the `messages.json` file from the directory `en` in the new directory.
1. Replace all `message`s.
1. For `pluralRule` please see [this definition](https://developer.mozilla.org/en-US/docs/Mozilla/Localization/Localization_and_Plurals#List_of_Plural_Rules). Current implemented rules are 0, 1, 2, 7 and 9 within [the utility function `getPluralForm()`](src/js/share/utils.js);

## After pulling or switching branches

Run `npm install` (the devcontainer does `npm ci` each time it starts) when `package.json` or `package-lock.json`
changed. The hooks and `npm test` run the tools from `node_modules`: with it out of date, `oxlint` and `knip` fail with
`npx canceled due to missing packages`. A pre-commit hook refuses a commit whose `package-lock.json` does not match
`package.json`.

## Linting

[oxlint](https://oxc.rs) lints the code, with its type-aware mode (`oxlint-tsgolint`) switched on in the configuration,
so rules such as `no-floating-promises` and `no-unsafe-*` see the types. `npm run lint:oxlint` runs it (about a second);
`npm run format:oxlint` applies the fixes it can make safely. Prettier does the formatting.

- **Rules live in `.oxlintrc.json`.** They were carried over from `eslint-config-airbnb-base` and `typescript-eslint`'s
  strict and stylistic sets when the project left ESLint (`docs/plans/eslint-10-flat-config.md` has the reasons and the
  comparison). Later `overrides` win over earlier ones; the browser boundary is a rule switched on for `src/**/*.ts` and
  switched off again for the files that may name the browser.
- **Our own rule** (`panorama/no-browser-storage`) is `tools/oxlint/boundary-plugin.ts`, loaded as a plugin. It is unit
  tested and mutation tested like the rest of the code.
- **What the configuration is tested against:** `tests/unit/lint-config.test.ts` lints two fixtures of deliberate
  violations (`tests/unit/lint-fixtures/`) in a project of its own and expects the exact rules and lines. If you
  switch a rule off, or an upgrade of oxlint changes what it finds, that test says so; change its expectation in the
  same commit and say why.
- **Ignoring code is guarded.** `check-no-suppressions` fails on `oxlint-disable` and `eslint-disable` comments, and
  on any `ignorePatterns` entry that is not generated output, or if `options.typeAware` is turned off.
- **Upgrading.** `oxlint` and `oxlint-tsgolint` are pinned exactly; move them together, run `npm test`, and read the
  diff of `tests/unit/lint-config.test.ts` if it fails.
- **Not carried over** (the compiler or another check covers them): `import/no-unresolved`, `import/order`,
  `import/no-useless-path-segments`, `@typescript-eslint/no-unsafe-enum-assignment` (enums are not allowed by
  `erasableSyntaxOnly`) and the linting of JSON (Prettier and the `check-json` hook).
  `import/no-extraneous-dependencies` is done by knip instead (below).

### Dependencies: knip

[knip](https://knip.dev) (`npm run lint:knip`, under a second) compares what the code imports with `package.json`. It
reports a package that is imported but not listed (including one that is only installed because something else needs
it), a listed package nothing uses, an import that does not resolve, a command a script runs that no package provides,
and, outside `src/`, files and exports nothing uses. `src/` is not checked for dead code because
`tests/unit/import-side-effects.test.ts` imports every module there on purpose.

- Its configuration is `knip.json`. It may name only the system tools that are not npm packages (`act`, `pre-commit`,
  `pkill`) and the fixtures that tests load by a path written as text; the guard fails on any other
  `ignore…`, `rules`, `include`, `project` or extra `entry`, and on the knip tags `@public`, `@internal` and `@lintignore`.
- When knip says a package is unlisted, add it to `package.json` (exact version, as the others); when it says one is
  unused, remove it. A package that tests use only through a workspace (`@devicefarmer/adbkit`) is listed with the
  workspace's version.
- It is pinned exactly, like oxlint, and upgraded with `npm test` as the check.

## Pinned tools of the devcontainer

Everything outside npm is pinned by an immutable reference, so a moved tag cannot change what runs:

- **Workflow actions** are pinned by commit SHA with the version as a trailing comment
  (`uses: actions/checkout@<sha> # v7.0.1`), **pre-commit hooks** by commit with `# frozen: <tag>`, and the
  **devcontainer base image** by digest. Dependabot (`github-actions`, `pre-commit` and `docker` in
  `.github/dependabot.yml`) opens the pull requests that move them. To add an action, take a release at least two
  weeks old, resolve its tag to a commit (`git ls-remote https://github.com/<owner>/<repo> 'refs/tags/<tag>*'`, and
  use the `^{}` line for an annotated tag) and write the version in the comment.
- A few things Dependabot does not update, refreshed by hand:
  - `act`: `ACT_VERSION` and `ACT_SHA256` in `.devcontainer/Dockerfile`, from the release's `checksums.txt`
    (`act_Linux_x86_64.tar.gz`).
  - The runner image of `act`: the digest of `catthehacker/ubuntu:act-24.04` in `.actrc` (`docker pull` it and take
    the digest it reports). The image is a community one and moves, which is why it is pinned.
  - The `docker-in-docker` feature: `npx @devcontainers/cli upgrade --workspace-folder .` rewrites
    `.devcontainer/devcontainer-lock.json`.
  - The version of Playwright in `.devcontainer/Dockerfile` (`install-deps`), which must match `package.json`.
- Not pinned, and why: the NodeSource setup script (`curl … | bash`) and the `nodejs` package it installs in the
  Dockerfile, and `pip install pre-commit` inside `pre-commit/action`. Both come from a vendor's repository and would
  need a mirror to be immutable.

## Dependency security

`npm run audit:check` (`npm audit --audit-level=low`) must report no vulnerabilities. It is a blocking step in the Node.js CI workflow and also runs weekly in the `Dependency audit` workflow, so new advisories show up without a code change. Dependabot opens weekly update pull requests.

Fix findings with `npm audit fix`. Never use `npm audit fix --force`: it can downgrade a direct dependency across major versions (for `web-ext` it proposes 5.1.0).

### The `@devicefarmer/adbkit` stub

`web-ext` depends on `@devicefarmer/adbkit`, which depends on `node-forge`. Every released `node-forge` is flagged by an advisory and no fixed release exists. `web-ext` only loads `adbkit` for `web-ext run --target firefox-android`, which this project does not use, so `tools/adbkit-stub` is an npm workspace package with the same name and the version `web-ext` pins (currently `3.3.9`). npm links the workspace instead of downloading the real package. Using the Android target fails with a message that points here.

- If `web-ext` changes the `adbkit` version it pins, update the version in `tools/adbkit-stub/package.json` to match. A unit test fails until you do, and otherwise npm would install the real package again.
- Once `node-forge` has a fixed release, remove the stub: delete `tools/adbkit-stub` (and its entry in `ALLOWED_JAVASCRIPT_FILES` in `scripts/lib/suppressions.ts`), the `workspaces` entry in `package.json` and `tests/unit/tools/adbkit-workspace.test.ts`, remove `tools/**/*.js` from the coverage `include` and `tools/**/*.test.ts` from the test `include` in `vitest.config.ts`, the `tools/adbkit-stub/index.test.ts` override in `.eslintrc.cjs` and `"tools"` from the `include` of `tsconfig.json`, then run `npm install`.
