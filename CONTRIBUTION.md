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

### Machine translations waiting for a native speaker

These were written by machine, so that they make sense, and have not been checked by a speaker of the language. Corrections are
welcome. Three sets:

- **The drafts:** 64 languages that were added as drafts on 2026-10-28 (`DRAFT_LOCALES` in `tests/support/target-locales.ts`; the table in
  [`docs/plans/languages.md`](docs/plans/languages.md) says "draft"). A speaker who has read one takes it out of that list.
- **The older languages, filled on 2026-10-29:** the 44 to 58 messages each of `de el es fr hu ko pl pt_BR tr zh_CN zh_TW` lacked were
  written by machine (`git log` of each `messages.json` says which), as was `closeGroupWarning` of `hu`, `pl` and `tr`, which now has forms.
  The messages that were there before are as they were.
- **Single messages**, from when the add-on was renamed:

- `optionKeyboardShortcutsToggle` in `pl` ("Przełącz widok grup kart") and `tr` ("Sekme Alanları Görünümünü Aç/Kapat",
  which keeps that file's word "alan" for a group).

### Update translation

1. Open the `messages.json` file for the target language.
1. Alter the `message` text for the translation to update, or add the messages the language lacks (`npm run report:locales` says how many each language lacks).
1. Keep what the code puts in: `$1` (a number or a name given by the program), `{link}` (where the link goes in the sentence of `optionKeyboardShortcutsManage`) and the labels of a message with forms (below). A message holds no markup; `\n` is a line break.
1. Run `npm run test:unit`. `tests/unit/locales.test.ts` checks the file, and when a language now lacks fewer messages it asks you to lower its number in `tests/unit/locale-gaps.json`, so that the number only goes down.

### Messages with forms

A message that depends on a count has one form for each form the language has, written as `form=text` and separated by `|`:

```json
"tabCount": { "message": "one=$1 tab|other=$1 tabs" }
```

The forms are the ones of the [Unicode CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) for the language: `zero`, `one`, `two`, `few`, `many` and `other`. English and German have `one` and `other`; Czech has `one`, `few` and `other`; Polish and Ukrainian have `one`, `few` and `many` for whole numbers (and `other` for fractions, which a count is not); Arabic has all six. `other` is used for a count that has no form of its own. A language that says the same for every count (Japanese, Chinese, Korean) writes the text alone, with no labels. The test says which forms a message lacks for the counts 0 to 1000.

### Add language

Which languages are wanted, and which folder name a browser takes for each, is in [`docs/plans/languages.md`](docs/plans/languages.md): start from its table.

1. Create a directory named like the language of the browser it is for: the language alone (`de`, `fr`, `tr`), and a region only where the languages differ (`pt_BR`, `zh_CN`, `zh_TW`). A name with a region that the browser does not report, as `fr_FR` and `tr_TR` were, is never loaded: those two and `el_GR` showed English to every Greek, French and Turkish user until they were renamed. `tests/e2e/locales.spec.ts` starts Chromium in the language of every folder and fails for one it does not load, and `tests/e2e/firefox-locale-folders.spec.ts` does the same for Firefox (it downloads the language packs it needs). A folder that no language of any browser takes is never seen: `docs/plans/languages.md` says which those are.
1. Copy the `messages.json` file from the directory `en` into it, and replace all `message`s.
1. Add the language to `tests/unit/locale-gaps.json` with the number of messages it still lacks (0 when it has them all), and to `tests/unit/locale-copies.json` with the number of its messages that are the same as English (`npm run report:locales` prints it; the add-on's name, the link and the units of size do not count). Look at each copy: a word that is the same in the language (`Import`, `Status`) is fine, a sentence is not.
1. Run `npm test`, and `npx playwright test locales --project=chromium`: it keeps a picture of the options page, the view and the popup in the language (attachments of the test), so that a reviewer can look at it without speaking it. A language that runs from the right (Arabic, Hebrew) is put on the page the right way round by itself; look at the pictures for what does not turn.
1. Say in the pull request who read the translation, or that nobody has. The owner waived the need for a reader (2026-10-28): a language nobody has read is added to `DRAFT_LOCALES` and is a draft until someone reads it.

What `npm test` checks of every language: valid JSON; no message that English lacks; the same placeholders as English in each message; no markup; a form for every count; a name that looks like a language; no more messages missing, and no more that are the same as English, than were written down. Pull requests show what each language lacks on the page of the run (`npm run report:locales` prints it).

### Texts in the code

Every text a person reads comes from `messages.json`; a test (`tests/unit/literal-texts.test.ts`) fails on a text written in the code, and the tests of each page fail on a text that is on the page and not from a message. A new text needs a new English message, which every language then lacks (raise their numbers in `tests/unit/locale-gaps.json`, as the test says). The names of groups and tabs are the user's own and are not messages.

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
- **Our own rule** (`tgv/no-browser-storage`) is `tools/oxlint/boundary-plugin.ts`, loaded as a plugin. It is unit
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

### The `deepmerge` replacement

`web-ext` depends on `addons-linter`, which pins `deepmerge` to `4.3.1` exactly. Every released `deepmerge` (up to `4.3.1`, the latest) is flagged by [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4): `mergeObject()` writes the keys of its inputs onto its result, so an object with its own `__proto__` property (as `JSON.parse` makes) sets the prototype of the result. No fixed release exists, and `npm audit fix --force` offers only `web-ext@3.2.1`, a downgrade of seven major versions. `addons-linter` is a development tool (it lints the built extension) and nothing of it ships, but the audit gate is kept at `low`, so `tools/deepmerge-patched` is an npm workspace package with the same name and the version `addons-linter` pins. It is `deepmerge` 4.3.1 (MIT) with every property of the result defined on it, so no key can reach its prototype, and without the check for React elements. `tools/deepmerge-patched/index.test.ts` has the proof for the advisory.

- If `addons-linter` changes the `deepmerge` version it pins, update the version in `tools/deepmerge-patched/package.json` to match. A unit test fails until you do, and otherwise npm would install the published package again.
- Once `deepmerge` has a release that fixes the advisory (or `addons-linter` stops using it), remove the replacement: delete `tools/deepmerge-patched` (and its entry in `ALLOWED_JAVASCRIPT_FILES` in `scripts/lib/suppressions.ts` and in `mutate` in `stryker.config.mjs`), the `workspaces` entry in `package.json`, the entry in `knip.json` and `tests/unit/tools/deepmerge-workspace.test.ts`, then run `npm install`.

### The `@devicefarmer/adbkit` stub

`web-ext` depends on `@devicefarmer/adbkit`, which depends on `node-forge`. Every released `node-forge` is flagged by an advisory and no fixed release exists. `web-ext` only loads `adbkit` for `web-ext run --target firefox-android`, which this project does not use, so `tools/adbkit-stub` is an npm workspace package with the same name and the version `web-ext` pins (currently `3.3.9`). npm links the workspace instead of downloading the real package. Using the Android target fails with a message that points here.

- If `web-ext` changes the `adbkit` version it pins, update the version in `tools/adbkit-stub/package.json` to match. A unit test fails until you do, and otherwise npm would install the real package again.
- Once `node-forge` has a fixed release, remove the stub: delete `tools/adbkit-stub` (and its entry in `ALLOWED_JAVASCRIPT_FILES` in `scripts/lib/suppressions.ts`), the `workspaces` entry in `package.json` and `tests/unit/tools/adbkit-workspace.test.ts`, remove `tools/**/*.js` from the coverage `include` and `tools/**/*.test.ts` from the test `include` in `vitest.config.ts`, the `tools/adbkit-stub/index.test.ts` override in `.eslintrc.cjs` and `"tools"` from the `include` of `tsconfig.json`, then run `npm install`.
