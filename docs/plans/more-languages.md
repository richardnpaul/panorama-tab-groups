# Implementation Plan: Support Many More Languages

> **Status: Phases 1, 2, 3 and 5 are done** on the branch `feature/more-languages`; Phase 4 (new languages) is
> prepared and **waits for the owner and for reviewers**: see "Result". The table below is the state before the work.

## Overview

The extension has 15 locales, but most are far from complete, and the code has gaps that no translator can fill:
some text is written in English in the code, the plural handling understands five rules, there is no right-to-left
support, and nothing checks a translation for being whole. Adding languages before those are fixed would add more
half-translated locales. This plan makes the extension translatable properly first, then adds languages.

## Where things stand (measured)

English has 50 messages. The others, with the number missing (those fall back to English):

| Locale | Missing |     | Locale | Missing |     | Locale | Missing |
| ------ | ------- | --- | ------ | ------- | --- | ------ | ------- |
| de     | 5       |     | hu     | 16      |     | tr_TR  | 16      |
| el_GR  | 1       |     | ko     | 17      |     | zh_CN  | 16      |
| es     | 16      |     | pl     | 16      |     | zh_TW  | 16      |
| es_AR  | 16      |     | pt     | 16      |     | fr_FR  | 1       |
| pt_BR  | 12      |     | ru     | 1       |     |        |         |

Other findings:

- `ko` has no `pluralRule` message and one message whose `$1` placeholders differ from the English one.
- `getPluralForm` (`src/js/share/utils.ts`) implements the plural rules 0, 1, 2, 7 and 9 only (the Mozilla numbering).
  Languages such as Arabic, Welsh, Irish, Czech/Slovak (a few forms) and Lithuanian need others, and an unknown rule
  silently returns the whole `a|b|c` string.
- **English in the code**, not in `messages.json`: `Restoring tab groups...` (initialization-ui), `Invalid file`
  (backup-controls), the five native-groups explanations and the feedback line (`options/native-groups.ts`), the
  statistics suffixes in `formatByteSize` (`bytes`, `KiB`, ...), the answers of the message handler, and the whole
  migration status page (`migration-status/status-page.ts`, nine strings and three dialogs). `options/reset.ts` is a
  placeholder (`Not implemented yet`).
- The HTML pages carry English text that a script replaces from the messages at start-up, so a missing message shows
  English and any element the script does not know stays English.
- There is no `dir` handling and the CSS uses physical left/right properties, so right-to-left languages would be
  mirrored wrongly.
- Nothing in CI says a locale is incomplete, has a bad placeholder or a wrong plural rule.

## Requirements

- Every user-visible string comes from `messages.json`; a test fails on a literal that should be a message.
- A locale check in CI: same keys as English (or an explicit allow-list of untranslated keys), same placeholders,
  a valid plural rule, valid JSON, and no unused or undefined message names in the code.
- Plural forms follow the language, for all the languages added, from one source of truth.
- Right-to-left languages render correctly.
- A translator can contribute without building the extension, and a reviewer can check a translation without speaking
  the language (machine-readable checks, a screenshot per locale).

## Decisions for the owner

**Taken for the work that is done** (each can be changed; what Phase 4 waits for is marked):

1. **Which languages, and in what order?** Candidates by size of the Firefox user base and the cost of the script:
   Japanese, Italian, Dutch, Swedish, Czech, Ukrainian, Indonesian, Vietnamese, Thai, Arabic and Hebrew (right-to-left,
   so they need Phase 3), Finnish, Danish, Norwegian, Romanian. Choose a first batch of about five.
2. **Where do translations come from?** (a) Community pull requests against `messages.json` (today's way, documented in
   `CONTRIBUTION.md`); (b) a translation service (Weblate offers hosted plans for open-source projects, with a web interface and
   checks for translators; check its current terms); (c) a machine draft reviewed by a native speaker before it is merged. Whatever the
   answer, say in the pull request which it was.
3. **Plural rules: keep the Mozilla numbering or use `Intl.PluralRules`?** `Intl.PluralRules(locale)` gives the
   categories (`one`, `few`, `many`, ...) for every language the browser knows, which makes the numbered rules and
   the `pluralRule` message unnecessary. The cost is changing the message format of the plural strings (`a|b|c` keyed
   by rule number becomes keyed by category) and migrating 15 files. Recommended: switch, once, in Phase 2.
4. **The store listings** (the add-on description and screenshots on addons.mozilla.org and the Chrome Web Store) are
   translated separately by those stores; are they in scope?

- **Decision 2, where translations come from:** (a) community pull requests, with (c) a machine draft allowed only when
  it is listed as waiting for a native speaker (`CONTRIBUTION.md`, as for `pl` and `tr` earlier) and a reviewer is named
  in the pull request. **Still open for Phase 4: no reviewers exist yet, so no new language was added.**
- **Decision 3, plural rules: switched to `Intl.PluralRules`, once.** The messages carry labelled forms
  (`one=$1 tab|other=$1 tabs`, the CLDR names), `pluralRule` is gone from every file, and the language is the browser's
  own (`@@ui_locale`, which a real Chromium gave as `de`, `pt_BR`, `zh_TW` for the language it was started in; it
  was `getUILanguage()` that said `en-US` throughout).
- **Decision 1, which languages:** not decided; see Phase 4 below for a proposal of a first batch that tests the code.
- **Decision 4, the store listings:** out of scope here.
- **The folders `el_GR`, `fr_FR`, `tr_TR` were renamed `el`, `fr`, `tr`, and `es_AR` was removed** (see "Found", below).
- **"Reset PTG" was deleted** with its stub (`options/reset.ts`): it only showed "Not implemented yet", and "PTG" is the
  old name. Bring it back, under a real name, with a real behaviour, if a reset is wanted.
- **The answers of the message handler** (`Migration completed` and the like) stay English: nothing reads them, they are
  a protocol between two parts of the add-on and not a text a person sees.
- **The migration status page was translated** and not deleted: the native-groups plan makes it the place for progress.

## Implementation Steps

Each step ends with `npm run typecheck`, `npm run lint`, the unit tests and Prettier; every new module is covered and
mutation tested as in the earlier plans.

### Phase 1: Make the existing locales measurable

1. **Locale check as a unit test** (`tests/unit/locales.test.ts`): read `src/_locales/*/messages.json`; per locale
   assert the placeholders match English, JSON is valid, and the number of missing keys is not above a recorded
   allowance (a file `tests/unit/locale-gaps.json` that may only shrink, like the suppression allow-list). Fix `ko`.
2. **Code check**: every `getMessage('name')` in `src` names a message that exists in English, and every English
   message is used (or listed as used by the manifest).
3. **Move the English out of the code** (list above) into messages, with the substitutions the dialogs need; the
   migration status page and `reset.ts` included or deleted. Translate nothing yet: English first, so the keys exist.
4. **A test for literals**: a lint rule or a test that fails on a string literal assigned to `textContent`, `title`,
   `placeholder`, `alert`, `confirm` or `notify` outside `i18n.getMessage`.

### Phase 2: Plurals and numbers

5. Implement the plural handling from the decision (`Intl.PluralRules`, or the missing numbered rules with a test per
   rule listing the counts 0 to 120 and their forms). Unknown rule: fail a test, not silently.
6. `formatByteSize` and any date or number shown use `Intl.NumberFormat` and the unit names from messages.

### Phase 3: Right-to-left and layout

7. Set `dir` from the locale on every page, move the CSS to logical properties, and mirror the icons that have a
   direction (arrows, the drag handles). Shares work with `options-page-dark-theme.md` (layout).
8. A pseudo-locale (`en_XA`: accented, 40% longer, wrapped in brackets) and an RTL pseudo-locale, used only by tests,
   to find strings that were not moved, text that overflows and layout that does not mirror.

### Phase 4: Add the languages

9. For each language of the first batch: add `messages.json` (all 50+ keys), run the locale check, view each page
   in it (an E2E case per locale that opens the options page, the popup and the view and takes a screenshot as an
   artifact), have it reviewed.
10. `CONTRIBUTION.md`: how to add a language, the checks it must pass, and the review expected.

### Phase 5: Keep it that way

11. Locale completeness shown in the pull request (a CI summary), and the allowance of missing keys at zero for the
    languages released.

## Risks and Mitigations

- **Plural migration breaks existing translations.** Mitigation: a script converts the numbered form to categories
  and the locale check proves every language still has every form it needs; do it in one commit.
- **Chromium and Firefox may not accept the same locale folder names.** Chromium documents a list of supported codes,
  and names such as `fr_FR` or `el_GR` may not be on it (to be checked, not assumed). Mitigation: in Phase 1 the
  locale check compares the folder names with both stores' lists, and a locale is loaded in each browser in Phase 4.
- **Machine translations reach users unreviewed.** Mitigation: Decision 2, and no merge of a locale without a
  reviewer's name in the pull request.
- **Scope creep into every string of every screen.** Mitigation: Phase 1 first and complete before any new language.

## Success Criteria

- [x] No user-visible English outside `messages.json`; a test enforces it
- [x] A locale check in CI; **every released locale has every message** is _not_ met: the check holds each language to
      a number of missing messages that can only fall (13 languages lack 43 to 58 of 91)
- [x] Plural forms correct for every language shipped, tested (counts 0 to 1000, in every message, in every language)
- [x] Right-to-left pages render mirrored and without overflow (tested in a real Chromium with an Arabic pseudo-locale)
- [ ] At least the first batch of new languages is in, each reviewed and screenshotted: **waits for reviewers**
- [x] `CONTRIBUTION.md` explains how to add a language

## Skills, agents and rules for this work

From everything-claude-code (commit and checksums in `.agents/EXTERNAL-SOURCES.md`):

- `.agents/skills/i18n-sync/SKILL.md`: how to translate and synchronise locale files by what each key does in the
  product, with project glossary and validation of what changed. Its optional `locakit` command is **not** used
  (the skill itself warns that the version it reviewed rewrites the target file and the lock file).

Left out on purpose: the accessibility skills (they went with the dark-theme work, where the form and contrast work is),
and ECC's translation agents for individual languages, which are written for other kinds of text.

## Result

Done on `feature/more-languages`; nothing is committed.

- **Phase 1.** `tests/unit/locales.test.ts` checks every folder: valid file, no message English lacks, the placeholders of
  English (`$1`, and `{link}` where a link goes), no markup, no empty message, forms for every count, a name that looks
  like a language, and the **ratchet**: `tests/unit/locale-gaps.json` says how many messages each language lacks, and the
  test fails for more and for fewer. It also checks the code against the messages: every name the code asks for exists, and
  no message goes unused. The English that was in the code is in the messages (the native-groups explanations and
  feedback, the size units, `Invalid file`, the restoring notification, the whole migration status page, the title and
  the search field of the view, the default title of a native group), and **`tests/unit/literal-texts.test.ts`** parses
  `src/` with the TypeScript compiler and fails on a text with words assigned to `textContent`, `title`, `placeholder`,
  passed to `alert`, `confirm`, `notify`, or given as `content`, `title`, `placeholder`. The tests of the options page,
  the view, the popup and the migration page also show each page with every message marked and fail on any text
  outside a message.
- **Phase 2.** `core/plural.ts` (labelled forms, `Intl.PluralRules`, a message with no fitting form is shown as it
  is, so that the mistake is visible); sizes are written by `Intl.NumberFormat` in the language of the browser with the
  unit from a message.
- **Phase 3.** Every page sets `dir` and `lang` from the browser (`@@bidi_dir`, `@@ui_locale`). The stylesheets use
  logical properties (a test fails on a physical side, with the toolbar side chosen by the user and the handles of the
  freeform canvas as the stated exceptions), and the two arrows and the search fade turn round in right to left. The
  pseudo-locale is **not a folder**: `tests/support/pseudo-locale.ts` wraps `i18n.getMessage` in the page before its scripts
  run (accented, 40% longer, in brackets; and "Arabic", right to left), so `tests/e2e/pseudo-locale.spec.ts` can load the
  real pages in a real Chromium: every text is from a message, there is no sideways scroll, the toolbar and the header of
  a group run from the right, and the arrow in the popup points the other way (shown to fail without the rule).
- **Phase 5.** `npm run report:locales` prints a table of what each language has, and the Node.js workflow puts it on the
  page of the run. `CONTRIBUTION.md` says how to add a language, what the forms are, and what the checks do.
- **Found, not in the plan**
  - **Three folders never loaded.** In a real Chromium started in Greek, French and Turkish, `el_GR`, `fr_FR` and `tr_TR` were not
    used: users of those languages saw English. They were renamed (`tests/e2e/locales.spec.ts` starts Chromium in the language
    of every folder and found it; it fails for a folder that does not load). Firefox was not tested (its pages are served with a
    stand-in in the E2E setup); a folder named for the language alone is found by both. `es_AR` was a byte-for-byte copy of `es`.
  - **`sendTabToGroup` did not exist:** the code asked for it, the translations (including el, fr and pt_BR) had the same text
    as `sendTab`, and a hard-coded English fallback hid it. The key is now `sendTabToGroup` everywhere; `goBackToGroups` was unused.
  - **Korean had a corrupted sentence** (`$1 tab$2 개의`), fixed; **every language had a literal `<br />`** in the import
    text, which the page showed as text. It is a line break now.
  - **The tab title of the view and the placeholder of its search box were English,** though `searchForTab_placeholder` existed.
  - **The "Follow System" theme and the second paragraph of the shortcuts** had no message at all.
  - **The names of a group** with no name were made in English in two places (`Group 3` and `Grp3` in the others);
    they are all `defaultGroupName` and the number now.
- **Checks.** `npm test`: 3,027 tests, 100% on every metric, 0 lint findings; the mutation run 100%; the E2E suite
  100 passed and 44 skipped (the Chromium-only locale and pseudo-locale cases under Firefox, and the 8 that were skipped before).

### Phase 4: what is left, and a proposal

Nothing in the code stops a language from being added: a folder, an entry in `locale-gaps.json`, and the pictures the E2E keeps.
What it waits for is a person who reads the language. A first batch that also exercises the code would be **Arabic** and
**Hebrew** (right to left; Arabic has all six plural forms), **Japanese** (no plural forms, wide characters), **Italian** and
**Dutch** (the common case). Machine drafts of those, with the owner's consent and listed as waiting, are a few hours of work
once the owner says so; the 91 messages are the work, and the locales have 43 to 58 of them missing today.
