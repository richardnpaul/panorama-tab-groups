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
- Once `node-forge` has a fixed release, remove the stub: delete `tools/adbkit-stub` (and its entry in `ALLOWED_JAVASCRIPT_FILES` in `scripts/lib/suppressions.ts`), the `workspaces` entry in `package.json` and `tests/unit/tools/adbkit-workspace.test.ts`, remove `tools/**/*.js` from the coverage `include` and `tools/**/*.test.ts` from the test `include` in `vitest.config.ts`, the `tools/adbkit-stub/index.test.ts` override in `.eslintrc.js` and `"tools"` from the `include` of `tsconfig.json`, then run `npm install`.
