# Languages

This is the record of which languages Tab Groups Viewer is to speak, how a browser chooses one, what was added, and what is done to
keep every language whole. The plan that made the code ready for it is [`plans/more-languages.md`](more-languages.md); how to
add or correct a language is in [`CONTRIBUTION.md`](../../CONTRIBUTION.md).

## The aim, and what the owner decided

**The extension is to be translated into every language that [Lazarus Form Recovery](https://github.com/richardnpaul/lazarus-form-recovery)
is** (its `public/_locales`, read at commit `6565085` on 2026-10-28), with the same standing for each: all the messages, the plural
forms of the language, and the way the language runs. The list is `tests/support/target-locales.ts`; the table below is checked
against it, and against the folders in `src/_locales`, by `tests/unit/target-locales.test.ts`.

Decisions of 2026-10-28:

- **Russian (`ru`) is not a language of the extension.** Lazarus has a test that fails if the folder exists, and the folder here was
  deleted by the owner.
- **`tl` (Tagalog) and `nn` (Nynorsk) are added.** They are languages of Firefox that Lazarus has no folder for.
- **The plan's Decision 2 is waived:** a language may be merged without a reader and without the owner's consent for each one. A language
  that no speaker has read is a **draft** (`DRAFT_LOCALES` in `tests/support/target-locales.ts`, the status "draft" below), and leaves
  that list when someone has read it.
- **Browsers:** a language is checked in every browser the extension is built for, Chromium (`dist`) and Firefox (`dist-firefox`).
- **A check for copies of English comes first** (`copiesOfEnglish`, see "What every language is held to").

Two choices of mine, for the owner to change:

- **`pt` is retired** (it was Brazilian Portuguese, and the same text as `pt_BR`). Lazarus has `pt`, `pt_BR` and `pt_PT`; with `pt_PT` here
  no browser would ever take `pt`, so the folder was deleted and `pt_PT` was written, in the Portuguese of Portugal.
- **A regional English has no folder** (`en_AU`, `en_CA`, `en_GB`, `en_US`, status "inherits `en`"). A regional folder holds only what
  differs from `en`, and none of the messages is spelt differently in British and American English, so a folder would be empty and the
  browsers take `en` and say the same. One is made when a message needs it (`REGIONAL_ENGLISH`).

## Where it stands

Of the 111 folders of the aim (`en` and 110 languages): **64 drafts** (added on 2026-10-28), **11 translated earlier** (and filled on 2026-10-29, see below), 4 that inherit `en`,
`en` itself, and **31 planned**. The batches:

| Batch | What                                                               | State               |
| ----- | ------------------------------------------------------------------ | ------------------- |
| A     | Languages of both Chromium and Firefox (36)                        | Done, as drafts     |
| B     | Languages of one of them (28, with `nn` and `tl`)                  | Done, as drafts     |
| C     | Folders that no language of Chromium 156 or Firefox 159 takes (31) | Not done: see below |

**The 11 older languages** (`de el es fr hu ko pl pt_BR tr zh_CN zh_TW`) lacked 44 to 58 of the 91 messages each. On 2026-10-29 the missing ones were written by Claude
in the terms those files already used (`alan` for a group in `tr`, `γκρουπ` in `el`), and they are as unread as the drafts; what was there before was not changed,
except that `closeGroupWarning` of `hu`, `pl` and `tr`, which was plain text, now has the forms of the language. They stay "present" in the table.

**What a draft is.** Every draft was written by Claude (Sonnet 5.5) from the English messages, one language at a time, and then passed
through the checks below; **nobody who speaks the language has read it.** Terms for "group", "tab" and "native" are kept the same within a
language, the add-on's name is not translated, and the plural forms are the language's own. Less certain than the rest, because there is less
written material for the model to draw on, and to be read first: **`ff` (Fula), `gn` (Guarani), `xh` (Xhosa), `my`, `km`, `si`, `am`, `ne`, `pa`,
`ka`, `hy`**. Serbian is in Cyrillic. The Indian-language drafts follow the English-loanword habit of their languages (`ટેબ`, `टैब`).

**Batch C is not done** because no stock browser can be set to those languages (they are in the table with "–" in both columns of browsers),
so the work could not be seen by anyone and could not be checked in a browser. It is for the owner to say whether another browser (Edge, Opera,
Samsung Internet, a fork of Firefox, Firefox for Android) is to be looked at first, and then these are the same work again.

## Which folder a browser takes

A browser is set to one language, and takes the folder of `_locales` named like it (`pt-BR` is `pt_BR`), else the folder named like the
language alone (`pt`), else English. A folder that no language takes is never shown to anyone. Both browsers were asked, in tests:

- **Chromium 156** ([`tests/e2e/chromium-locale-folders.spec.ts`](../../tests/e2e/chromium-locale-folders.spec.ts)): started in each of the 55 languages
  of its own interface, with an extension that has every target folder, it took the folder the rule says, for all 55. With only a folder for
  the language alone, `pt-BR`, `pt-PT`, `es-419` and `zh-CN` take it; **with only `zh_CN`, `zh-TW` takes English**, so Chromium does not
  fall to another region of the language. **Norwegian is `nb` to Chromium: a folder `no` is taken by nobody**, though `--lang=no` forced on
  the command line does find it, so a check that forces the tag passes folders that no user will ever get.
- **Firefox 157** ([`tests/e2e/firefox-locale-folders.spec.ts`](../../tests/e2e/firefox-locale-folders.spec.ts)): Firefox is set to a language by its language
  pack, so the spec downloads the packs it needs (signed by Mozilla, for the installed version, kept in `node_modules/.cache`). **A pack
  that is not signed is refused whatever the preferences say** (tried with a made-up pack and with a real one with its signature removed), so
  the packs cannot be faked. Firefox takes the same two steps as Chromium and **one more: a folder of another region of the language**
  (`es_419` for `es-MX`, `de_CH` for `de`) when there is none for the language alone. The same spec also sets Firefox to the language of
  **every folder in `src/_locales`** (that has one) and checks that it is that folder that is taken: 47 passed.
- **The pages in each language** are looked at in Chromium only (`tests/e2e/locales.spec.ts`: every page of every folder, from the right where the
  language runs from the right, no sideways scroll, a picture of each page for a reviewer). In Firefox the pages are served with a stand-in
  for the browser API in the E2E setup, so what Firefox was asked is **which folder it takes, not how a page looks in it**. The pages are the
  same files and the CSS is the same.
- **The languages Firefox has** are its language packs for the version (`SHA512SUMS` of the release): **103, and `en-US`**. The list of "primary
  builds" that Mozilla publishes has 11 more (`bo`, `bqi`, `brx`, `ckb`, `hye`, `lo`, `ltg`, `meh`, `ml`, `scn`, `wo`) for which there is no pack in Firefox
  159, so those folders cannot be reached today.
- Other browsers (Edge, Opera, Brave, Vivaldi, Tor, Firefox for Android, forks of Firefox) have languages of their own, which were not looked at.

Of the 110 languages of the aim, **Chromium takes 54, Firefox 73, and 78 are taken by one or the other; 32 by neither**: 31 are Batch C and one
is `en_AU`, which inherits `en`.

**Languages of Firefox that have no folder** (so their users see English): `ach`, `an`, `ast`, `be`, `br`, `cak`, `dsb`, `eo`, `fur`, `fy-NL`, `gd`, `hsb`, `ia`,
`kab`, `lij`, `oc`, `rm`, `sat`, `sc`, `scn`, `sco`, `skr`, `son`, `szl`, `tg`, `trs` (and `ru`, on purpose). They are languages of few speakers. Adding
them is the same work again.

## The languages

"Runs" is the way the language is written; the page is turned round by the browser's own answer (`@@bidi_dir`), not by this list. "Plural
forms" are the ones of the language in the CLDR (`Intl.PluralRules`), and a message that depends on a count must have a form for each. The two
columns of browsers are the languages of the browser that take the folder (Firefox with its third step). Status: `default` is English;
`present` was translated before, `draft` has not been read by a speaker; `inherits en` has no folder; `planned` is Batch C.

| Folder   | Language                      | Runs | Plural forms                     | Chromium 156 language | Firefox 159 language       | Status        |
| -------- | ----------------------------- | ---- | -------------------------------- | --------------------- | -------------------------- | ------------- |
| `af`     | Afrikaans                     | ltr  | one, other                       | af                    | af                         | draft         |
| `ak`     | Akan                          | ltr  | one, other                       | –                     | –                          | planned       |
| `am`     | Amharic                       | ltr  | one, other                       | am                    | –                          | draft         |
| `ar`     | Arabic                        | rtl  | zero, one, two, few, many, other | ar                    | ar                         | draft         |
| `az`     | Azerbaijani                   | ltr  | one, other                       | –                     | az                         | draft         |
| `bg`     | Bulgarian                     | ltr  | one, other                       | bg                    | bg                         | draft         |
| `bm`     | Bambara                       | ltr  | other                            | –                     | –                          | planned       |
| `bn`     | Bangla                        | ltr  | one, other                       | bn                    | bn                         | draft         |
| `bs`     | Bosnian                       | ltr  | one, few, other                  | –                     | bs                         | draft         |
| `ca`     | Catalan                       | ltr  | one, many, other                 | ca                    | ca, ca-valencia            | draft         |
| `ckb`    | Central Kurdish               | rtl  | one, other                       | –                     | –                          | planned       |
| `cs`     | Czech                         | ltr  | one, few, many, other            | cs                    | cs                         | draft         |
| `cy`     | Welsh                         | ltr  | zero, one, two, few, many, other | –                     | cy                         | draft         |
| `da`     | Danish                        | ltr  | one, other                       | da                    | da                         | draft         |
| `de`     | German                        | ltr  | one, other                       | de                    | de                         | present       |
| `de_CH`  | Swiss High German             | ltr  | one, other                       | –                     | –                          | planned       |
| `el`     | Greek                         | ltr  | one, other                       | el                    | el                         | present       |
| `en`     | English                       | ltr  | one, other                       | –                     | –                          | default       |
| `en_AU`  | Australian English            | ltr  | one, other                       | –                     | –                          | inherits `en` |
| `en_CA`  | Canadian English              | ltr  | one, other                       | –                     | en-CA                      | inherits `en` |
| `en_GB`  | British English               | ltr  | one, other                       | en-GB                 | en-GB                      | inherits `en` |
| `en_US`  | American English              | ltr  | one, other                       | en-US                 | en-US                      | inherits `en` |
| `es`     | Spanish                       | ltr  | one, many, other                 | es                    | es-AR, es-CL, es-ES, es-MX | present       |
| `es_419` | Latin American Spanish        | ltr  | one, many, other                 | es-419                | –                          | draft         |
| `et`     | Estonian                      | ltr  | one, other                       | et                    | et                         | draft         |
| `eu`     | Basque                        | ltr  | one, other                       | –                     | eu                         | draft         |
| `fa`     | Persian                       | rtl  | one, other                       | fa                    | fa                         | draft         |
| `ff`     | Fula                          | ltr  | one, other                       | –                     | ff                         | draft         |
| `fi`     | Finnish                       | ltr  | one, other                       | fi                    | fi                         | draft         |
| `fil`    | Filipino                      | ltr  | one, other                       | fil                   | –                          | draft         |
| `fr`     | French                        | ltr  | one, many, other                 | fr                    | fr                         | present       |
| `ga`     | Irish                         | ltr  | one, two, few, many, other       | –                     | ga-IE                      | draft         |
| `gl`     | Galician                      | ltr  | one, other                       | –                     | gl                         | draft         |
| `gn`     | Guarani                       | ltr  | one, other                       | –                     | gn                         | draft         |
| `gu`     | Gujarati                      | ltr  | one, other                       | gu                    | gu-IN                      | draft         |
| `ha`     | Hausa                         | ltr  | one, other                       | –                     | –                          | planned       |
| `he`     | Hebrew                        | rtl  | one, two, other                  | he                    | he                         | draft         |
| `hi`     | Hindi                         | ltr  | one, other                       | hi                    | hi-IN                      | draft         |
| `hr`     | Croatian                      | ltr  | one, few, other                  | hr                    | hr                         | draft         |
| `hu`     | Hungarian                     | ltr  | one, other                       | hu                    | hu                         | present       |
| `hy`     | Armenian                      | ltr  | one, other                       | –                     | hy-AM                      | draft         |
| `id`     | Indonesian                    | ltr  | other                            | id                    | id                         | draft         |
| `ig`     | Igbo                          | ltr  | other                            | –                     | –                          | planned       |
| `is`     | Icelandic                     | ltr  | one, other                       | –                     | is                         | draft         |
| `it`     | Italian                       | ltr  | one, many, other                 | it                    | it                         | draft         |
| `ja`     | Japanese                      | ltr  | other                            | ja                    | ja                         | draft         |
| `ka`     | Georgian                      | ltr  | one, other                       | –                     | ka                         | draft         |
| `kk`     | Kazakh                        | ltr  | one, other                       | –                     | kk                         | draft         |
| `km`     | Khmer                         | ltr  | other                            | –                     | km                         | draft         |
| `kn`     | Kannada                       | ltr  | one, other                       | kn                    | kn                         | draft         |
| `ko`     | Korean                        | ltr  | other                            | ko                    | ko                         | present       |
| `lb`     | Luxembourgish                 | ltr  | one, other                       | –                     | –                          | planned       |
| `lg`     | Ganda                         | ltr  | one, other                       | –                     | –                          | planned       |
| `ln`     | Lingala                       | ltr  | one, other                       | –                     | –                          | planned       |
| `lo`     | Lao                           | ltr  | other                            | –                     | –                          | planned       |
| `lt`     | Lithuanian                    | ltr  | one, few, many, other            | lt                    | lt                         | draft         |
| `lv`     | Latvian                       | ltr  | zero, one, other                 | lv                    | lv                         | draft         |
| `mg`     | Malagasy                      | ltr  | one, other                       | –                     | –                          | planned       |
| `mk`     | Macedonian                    | ltr  | one, other                       | –                     | mk                         | draft         |
| `ml`     | Malayalam                     | ltr  | one, other                       | ml                    | –                          | draft         |
| `mn`     | Mongolian                     | ltr  | one, other                       | –                     | –                          | planned       |
| `mr`     | Marathi                       | ltr  | one, other                       | mr                    | mr                         | draft         |
| `ms`     | Malay                         | ltr  | other                            | ms                    | ms                         | draft         |
| `mt`     | Maltese                       | ltr  | one, two, few, many, other       | –                     | –                          | planned       |
| `my`     | Burmese                       | ltr  | other                            | –                     | my                         | draft         |
| `nb`     | Norwegian Bokmål              | ltr  | one, other                       | nb                    | nb-NO                      | draft         |
| `ne`     | Nepali                        | ltr  | one, other                       | –                     | ne-NP                      | draft         |
| `nl`     | Dutch                         | ltr  | one, other                       | nl                    | nl                         | draft         |
| `nn`     | Norwegian Nynorsk             | ltr  | one, other                       | –                     | nn-NO                      | draft         |
| `no`     | Norwegian                     | ltr  | one, other                       | –                     | –                          | planned       |
| `nso`    | Northern Sotho                | ltr  | one, other                       | –                     | –                          | planned       |
| `ny`     | Nyanja                        | ltr  | one, other                       | –                     | –                          | planned       |
| `om`     | Oromo                         | ltr  | one, other                       | –                     | –                          | planned       |
| `pa`     | Punjabi                       | ltr  | one, other                       | –                     | pa-IN                      | draft         |
| `pl`     | Polish                        | ltr  | one, few, many, other            | pl                    | pl                         | present       |
| `ps`     | Pashto                        | rtl  | one, other                       | –                     | –                          | planned       |
| `pt_BR`  | Brazilian Portuguese          | ltr  | one, many, other                 | pt-BR                 | pt-BR                      | present       |
| `pt_PT`  | European Portuguese           | ltr  | one, many, other                 | pt-PT                 | pt-PT                      | draft         |
| `qu`     | Quechua                       | ltr  | one, other                       | –                     | –                          | planned       |
| `rn`     | Rundi                         | ltr  | one, other                       | –                     | –                          | planned       |
| `ro`     | Romanian                      | ltr  | one, few, other                  | ro                    | ro                         | draft         |
| `rw`     | Kinyarwanda                   | ltr  | one, other                       | –                     | –                          | planned       |
| `si`     | Sinhala                       | ltr  | one, other                       | –                     | si                         | draft         |
| `sk`     | Slovak                        | ltr  | one, few, many, other            | sk                    | sk                         | draft         |
| `sl`     | Slovenian                     | ltr  | one, two, few, other             | sl                    | sl                         | draft         |
| `sn`     | Shona                         | ltr  | one, other                       | –                     | –                          | planned       |
| `so`     | Somali                        | ltr  | one, other                       | –                     | –                          | planned       |
| `sq`     | Albanian                      | ltr  | one, other                       | –                     | sq                         | draft         |
| `sr`     | Serbian                       | ltr  | one, few, other                  | sr                    | sr                         | draft         |
| `st`     | Southern Sotho                | ltr  | one, other                       | –                     | –                          | planned       |
| `sv`     | Swedish                       | ltr  | one, other                       | sv                    | sv-SE                      | draft         |
| `sw`     | Swahili                       | ltr  | one, other                       | sw                    | –                          | draft         |
| `ta`     | Tamil                         | ltr  | one, other                       | ta                    | ta                         | draft         |
| `te`     | Telugu                        | ltr  | one, other                       | te                    | te                         | draft         |
| `th`     | Thai                          | ltr  | other                            | th                    | th                         | draft         |
| `ti`     | Tigrinya                      | ltr  | one, other                       | –                     | –                          | planned       |
| `tl`     | Filipino                      | ltr  | one, other                       | –                     | tl                         | draft         |
| `tn`     | Tswana                        | ltr  | one, other                       | –                     | –                          | planned       |
| `tr`     | Turkish                       | ltr  | one, other                       | tr                    | tr                         | present       |
| `uk`     | Ukrainian                     | ltr  | one, few, many, other            | uk                    | uk                         | draft         |
| `ur`     | Urdu                          | rtl  | one, other                       | ur                    | ur                         | draft         |
| `uz`     | Uzbek                         | ltr  | one, other                       | –                     | uz                         | draft         |
| `vi`     | Vietnamese                    | ltr  | other                            | vi                    | vi                         | draft         |
| `wo`     | Wolof                         | ltr  | other                            | –                     | –                          | planned       |
| `xh`     | Xhosa                         | ltr  | one, other                       | –                     | xh                         | draft         |
| `yo`     | Yoruba                        | ltr  | other                            | –                     | –                          | planned       |
| `zgh`    | Standard Moroccan Tamazight   | ltr  | one, other                       | –                     | –                          | planned       |
| `zh_CN`  | Chinese (China)               | ltr  | other                            | zh-CN                 | zh-CN                      | present       |
| `zh_HK`  | Chinese (Hong Kong SAR China) | ltr  | other                            | –                     | –                          | planned       |
| `zh_TW`  | Chinese (Taiwan)              | ltr  | other                            | zh-TW                 | zh-TW                      | present       |
| `zu`     | Zulu                          | ltr  | one, other                       | –                     | –                          | planned       |

## What every language is held to

The same checks for each folder, whoever wrote it (`tests/unit/locales.test.ts`, `tests/unit/literal-texts.test.ts`, `tests/e2e/locales.spec.ts`,
`tests/e2e/pseudo-locale.spec.ts`, `npm run report:locales`):

- valid file; no message that English lacks; the placeholders of English in each message; no markup; no empty message; a name that looks
  like a language;
- a form for every count from 0 to 1000 (for the forms of the language, `Intl.PluralRules`);
- the number of messages the language lacks may only go down (`tests/unit/locale-gaps.json`); **a new language lacks none**;
- **the number of messages that are the same as English may only go down** (`tests/unit/locale-copies.json`), apart from those that rightly are
  (`KEPT_AS_IS`: the add-on's name, the link to an English page, the units of size). A copy is a message that was not translated, or a word
  that is the same in the language (`Position`, `Import`, `Backup`, `Status`; a short `Grp`); the numbers are 0 to 5 for the new languages, and each was
  looked at;
- a real Chromium started in the language loads the folder, shows every page in it with no sideways scroll, and keeps a picture of each page for a
  reviewer who does not read the language; a real Firefox set to the language takes the folder;
- no text of the user interface is written in the code;
- a right-to-left language (`ar`, `fa`, `he`, `ur` here) is turned round by the browser's answer, the CSS uses logical properties, and the
  pseudo-locales (accented and 40% longer, and "Arabic") find text that does not fit or turn.

## What Lazarus Form Recovery does, and what each repository can take from the other

Read from Lazarus at `6565085` (its `tests/unit/l10n-catalog.test.ts`, `src/common/utils/i18n.ts`, `.agents/rules/localisation-rules.md`,
`docs/plans/l10n_implementation_plan.md`); nothing of it was run.

|                                           | Lazarus Form Recovery                                                                                                                                 | Tab Groups Viewer                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folders                                   | 110 (109 translations and `en`)                                                                                                                       | 76 (75 translations and `en`); 4 more regional Englishes inherit `en`                                                                                |
| Messages in English                       | 184 (a plural message is one message for each form)                                                                                                   | 91                                                                                                                                                   |
| Every message in every language           | Checked for 104 of the 110 folders (the others hold only what differs); a missing message is a failure                                                | All 75 translations lack none (the 11 older were filled on 2026-10-29, with machine drafts of the missing messages), and the number may only go down |
| Plural forms                              | One message for each form, `name_one`, `name_two`, `name_other`; code picks with `Intl.PluralRules`; a test that Hebrew has `_two` and Arabic all six | One message with labelled forms, `one=…\|other=…`; a test of the forms for every count 0 to 1000 for every language                                  |
| Regional English                          | `en` is British; `en_US`, `en_CA` hold only what differs; `en_AU` and `en_GB` hold under ten messages; `de_CH` holds only what differs                | `en` only; the regional ones inherit it                                                                                                              |
| Folders no browser takes                  | Present (33 of the 109 translations, `pt` among them), never looked for                                                                               | Looked for: tests start both browsers in the language; the 31 are not written                                                                        |
| Does the browser take it                  | Not tested in a browser                                                                                                                               | Chromium and Firefox: a test per folder; Chromium also shows each page                                                                               |
| Text in the code                          | A rule (`localisation-rules.md`) and a test that every key the code uses exists                                                                       | The same, and a test that parses the code and fails on a text with words in it                                                                       |
| Right to left                             | A list of ten languages in the code; logical CSS; a Shadow DOM direction rule                                                                         | The browser's own answer (`@@bidi_dir`); logical CSS with a test that fails on a physical side; pseudo-locale in Arabic, in a real browser           |
| Words counted                             | `Intl.Segmenter` for Chinese and Japanese                                                                                                             | Nothing counts words                                                                                                                                 |
| A copy of English passed as a translation | A test for six keys (that the vault strings differ from English in every language)                                                                    | **All messages, in every language, with a number that may only go down**                                                                             |
| Placeholders                              | Checked in every catalog, inheriting from English for the differential ones                                                                           | Checked in every language                                                                                                                            |
| Who read it                               | Not recorded in the repository                                                                                                                        | Recorded: `DRAFT_LOCALES` lists those that no speaker has read                                                                                       |

### Learnings for this repository

1. **A language that no browser takes is wasted work.** This was acted on: batches A and B are the 64 that a browser can be set to, and batch C is not
   written. This is also why `nb` is wanted and `no` is not.
2. **Regional English is worth having only where a browser has it, and only when a message differs.** `en_GB` and `en_US` are languages of both browsers,
   `en_CA` of Firefox; `en_AU` and `de_CH` are of neither. Lazarus' way (the regional folder holds only what differs, and the fallback does the rest)
   is the right one; here it has nothing to hold yet.
3. **A check for a copy of English.** Done before any language was added (`copiesOfEnglish`). Lazarus tests six keys.
4. **The demand that every language has every message** is met for all 75 languages (the 11 older ones were filled on 2026-10-29), and held there by the gap numbers, which are 0.
5. **Localised confirmation words** (Lazarus has a confirmation word for each language, `optionsWipeConfirmKeyword`, for its delete-everything action)
   are a thing for the "reset" this repository does not have yet.
6. **Asking the browser needs the browser's own list of languages,** not a forced tag. A first version of the Chromium check forced `--lang` and found every
   folder "loaded", including ones no user will ever get.

### Suggestions for Lazarus Form Recovery

These come from what was found here; they were not sent to that repository.

1. **33 of its 109 translation folders are taken by no language of Chromium 156 or Firefox 159:** `ak bm ckb de_CH en_AU ha ig lb lg ln lo mg mn mt no nso ny om ps pt
qu rn rw sn so st ti tn wo yo zgh zh_HK zu`. For `no` the reason is that Chromium calls Norwegian `nb`; for `pt` that `pt_BR` and `pt_PT` take the
   Portuguese; for `ckb`, `lo` and `wo` that Firefox 159 has no language pack for them. Their users see English. They are not wrong to carry (another
   browser may take them), but the test that "all 110 exist" does not say whether anyone gets them. The two specs here (`chromium-locale-folders`,
   `firefox-locale-folders`) can be taken as they are; they need a list of folders.
2. **Firefox's Tagalog (`tl`) and Nynorsk (`nn-NO`) have no folder.** `fil` is Chromium's name for Filipino, and Firefox's is `tl`.
3. **The test of six vault keys, made general:** for every language, count the messages equal to English, with an allow-list, and a number that may
   only go down (`tests/unit/locale-copies.json` here).
4. **Plural forms:** its test names Hebrew and Arabic by hand. A test that asks `Intl.PluralRules` for the forms of each language and checks a message
   exists for each would cover all of them, and a new language adds nothing to the test.
5. **Look at it in a browser:** start Chromium in the language of each folder, load the page, check `html[lang]` and `html[dir]` and that nothing runs
   sideways, and keep a picture. It found three folders here that had never loaded.
6. **Say who read each language,** in `docs/` or in the pull request that added it. The repository does not.

## To keep this true

- `tests/unit/target-locales.test.ts` fails when the table above disagrees with `src/_locales`, `tests/support/target-locales.ts` or the language lists
  of the browsers (`tests/support/ui-languages.ts`). To regenerate the table after a change, the rows are built from those three files.
- `npx playwright test chromium-locale-folders locales --project=chromium` and `npx playwright test firefox-locale-folders --project=firefox` ask the
  browsers (after `npm run dist` and `npm run dist:firefox`; Firefox downloads language packs on first use).
- When a speaker has read a language, take it out of `DRAFT_LOCALES` and change its status in the table to `present`.
