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

## Dependency security

`npm run audit:check` (`npm audit --audit-level=low`) must report no vulnerabilities. It is a blocking step in the Node.js CI workflow and also runs weekly in the `Dependency audit` workflow, so new advisories show up without a code change. Dependabot opens weekly update pull requests.

Fix findings with `npm audit fix`. Never use `npm audit fix --force`: it can downgrade a direct dependency across major versions (for `web-ext` it proposes 5.1.0).

### The `@devicefarmer/adbkit` stub

`web-ext` depends on `@devicefarmer/adbkit`, which depends on `node-forge`. Every released `node-forge` is flagged by an advisory and no fixed release exists. `web-ext` only loads `adbkit` for `web-ext run --target firefox-android`, which this project does not use, so `tools/adbkit-stub` is an npm workspace package with the same name and the version `web-ext` pins (currently `3.3.9`). npm links the workspace instead of downloading the real package. Using the Android target fails with a message that points here.

- If `web-ext` changes the `adbkit` version it pins, update the version in `tools/adbkit-stub/package.json` to match. A unit test fails until you do, and otherwise npm would install the real package again.
- Once `node-forge` has a fixed release, remove the stub: delete `tools/adbkit-stub`, the `workspaces` entry in `package.json` and `tests/unit/tools/adbkit-workspace.test.js`, remove `tools/**/*.js` from the coverage `include` and `tools/**/*.test.js` from the test `include` in `vitest.config.mjs`, and the `tools/**/*.test.js` entry in `.eslintrc.js`, then run `npm install`.
