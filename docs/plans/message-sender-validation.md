# Implementation Plan: Message Sender Validation and an Opt-in for Other Add-ons

## Overview

The background's two message listeners never look at who sent the message. `runtime.onMessage` in
`src/js/adapters/browser/events.ts` ignores its `_sender` argument, and the `runtime.onMessageExternal`
listener does not even declare one (its event type carries only the message). The project skill
`webext-api`, the `webext-security` checklist and the verification rule all say a handler validates the
sender, so this is a standing finding for the security reviewer. This plan adds sender validation to both
listeners and makes other add-ons' access an **opt-in** setting, off by default, with a sender policy
that is one replaceable function.

## What is exposed today

- **`runtime.onMessage`** (internal). The manifest has no `content_scripts`, no
  `web_accessible_resources` and no `externally_connectable`, so only the extension's own pages can
  reach it today. Behind it are destructive actions: `deleteGroup` (closes the group's tabs),
  `cleanupNativeGroups`, `migrateToHybridGroups`, `resetMigration`. A check here is defence in depth: it
  protects against a content script or a manifest change added later by someone who does not know this
  listener trusts every caller.
- **`runtime.onMessageExternal`**. Other installed extensions can send to it in both browsers (per MDN
  and the Chrome documentation; not re-verified here). The handler (`app/external-messages.ts`) accepts
  only the strings `activate-next-group` and `activate-previous-group`, returns nothing to the caller,
  and logs anything else together with the whole unvalidated message. A hostile extension can therefore
  switch the user's active group repeatedly, hiding tabs, and can write arbitrary data into the log. It
  cannot read data or close tabs. Severity: LOW to MEDIUM.
- **History.** In 2018 (`9f66b1f3`, "added support for gesturefy/addon messaging") the external listener
  was wired to the same handler as internal messages, which exposed every action. The refactor to ports
  and adapters (#21) narrowed it to the two commands. Sender checking never followed. The feature is
  deliberate: it exists for add-ons such as Gesturefy.

## Decisions (recorded)

- **External messages are opt-in.** A new option, `allowExternalCommands`, is **off by default**. When it
  is off, every external message is refused. When it is on, a message is accepted only from a
  well-formed sender and only if it is one of the two known commands. Every acceptance and every refusal
  is logged with who sent it. The check is one function (the sender policy), so a list of allowed add-on
  ids can replace it later as its own plan.
- **Strings in every locale.** The option's text is written in all 75 translations and English, as the
  project's locale process requires.
- **No rate limit** on external commands. Decided against; not planned.
- **The internal check is `sender.id` only.** It does not also require an extension-page URL; that would
  reject a content script, which does not exist, and whoever adds one decides then.

## Decisions Needed

1. **How existing users find out.** Off by default means a user who relies on Gesturefy-style gestures
   loses them on update, with only a log line as explanation. Options:

   | Option                                                                               | Cost                                                                  |
   | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
   | A. Release notes and the option's own text only                                      | None. Users learn when the gesture stops working                      |
   | B. One notification the first time a well-formed sender is refused (**recommended**) | One more message in 75 locales, one stored "already told" flag, tests |
   | C. Turn it on for existing installs                                                  | Defeats the opt-in for exactly the people it is meant to protect      |

   Recommendation: B, as Phase 5 (optional, so it can be dropped without touching the rest). The plan
   works without it.

## Requirements

- Internal messages are handled only when they come from this extension (`sender.id` equals
  `runtime.id`); anything else is refused without running a handler and without an answer.
- External messages are handled only when `allowExternalCommands` is on, the sender is well formed, and
  the message is a known command.
- A refusal or an acceptance is logged once, with a bounded description of the sender, never the whole
  message.
- No change for the extension's own pages.
- The check has no browser API in `core/` or `app/` (`#skill:ts-codebase-patterns`).
- The new option follows the options conventions: defaults and parsing in `core/options.ts`, storage
  through the `OptionsStore` port, text through locale messages.

## Affected Files

- `src/js/core/sender.ts` (new) — pure: is this sender ours, is it well formed, bounded descriptions of a
  sender and of a message
- `src/js/core/options.ts` — the `allowExternalCommands` option, default `false`, parsed with `isBoolean`
- `src/js/adapters/browser/events.ts` — read the sender, check the internal one, pass the external one on
- `src/js/app/external-sender-policy.ts` (new) — the policy: a decision from the sender and the option
- `src/js/app/external-messages.ts` — ask the policy first, then check the message, log safely
- `src/js/background/compose.ts` — wire the policy (it knows the extension's own id)
- `src/options.html`, `src/js/options/external-commands.ts` (new), `src/js/options/translations.ts`,
  `src/js/options/page.ts` — the checkbox and its text
- `src/_locales/*/messages.json` (76 files) — three new messages each
- `tests/unit/locale-copies.json` — re-measured, only ever downward
- `tests/unit/core/sender.test.ts`, `tests/unit/properties/sender.property.test.ts` (new)
- `tests/unit/core/options.test.ts`, `tests/support/options-contract.ts`,
  `tests/unit/adapters/browser/options.test.ts` — the new default
- `tests/unit/app/external-sender-policy.test.ts` (new), `tests/unit/app/external-messages.test.ts`,
  `tests/unit/adapters/browser/events.test.ts`, `tests/unit/background/compose.test.ts`,
  `tests/unit/options/` (new test for the checkbox) — updated or new
- `tests/e2e/options-persistence.spec.ts` — the choice is kept
- `tests/e2e/message-senders.spec.ts` (new) — a foreign add-on in a real Firefox, using the lab
- `docs/spec.md` — the stored option and a "Messages" section
- `src/manifest.json` — no change

The new message names (in English, then all 75 translations): `optionsExternalCommands` (the section
heading, "Other add-ons"), `optionsExternalCommandsUse` (the checkbox label, "Let other add-ons switch
between groups"), `optionsExternalCommandsText` (what they can and cannot do: switch to the next or
previous group, as the shortcuts do, and nothing else). The names are provisional.

## Implementation Steps

### Phase 1: Internal messages (`runtime.onMessage`)

1. **Pure sender functions, tests first** (`src/js/core/sender.ts`, `tests/unit/core/sender.test.ts`,
   `tests/unit/properties/sender.property.test.ts`)
   - Action: `isOwnSender(sender: unknown, ownId: string)` is true only for an object whose `id` is the
     string `ownId`. `isWellFormedSender(sender: unknown)` is true for an object whose `id` is a
     non-empty string of bounded length. `describeSender(sender)` and `describeMessage(message)` give
     bounded, printable strings (the id cut to a fixed length; for a message its type and length, never
     its content). They use the guards in `src/js/share/guards.ts` and never throw. Property tests
     (fast-check, as in `tests/unit/properties/`) feed arbitrary values: `null`, arrays, an `id` that is
     not a string, very long ids.
   - Why: the rule is the whole security decision; it should be testable without a browser and satisfy
     the 100% coverage and mutation gates.
   - Dependencies: None
   - Risk: Low

2. **Check the sender before running a handler** (`src/js/adapters/browser/events.ts`,
   `tests/unit/adapters/browser/events.test.ts`)
   - Action: add `id: string` to the `runtime` part of `EventsApi`. In the `onMessage` listener, if
     `isOwnSender(sender, api.runtime.id)` is false, log one line (`describeSender`), do not call
     `handlers.handleMessage`, and return `false` (not handled, no response). Otherwise behave as now.
   - Why: identity is something the browser tells us, so it belongs in the adapter; `app/` stays free of
     browser facts.
   - Dependencies: Requires step 1
   - Risk: Medium (a wrong check would refuse the extension's own pages; the Chromium E2E tests that send
     real messages guard this)

### Phase 2: The option

3. **The option, its default and its parsing** (`src/js/core/options.ts`, `tests/unit/core/options.test.ts`,
   `tests/support/options-contract.ts`, `tests/unit/adapters/browser/options.test.ts`)
   - Action: add `allowExternalCommands: boolean` to `Options`, default `false` in
     `createDefaultOptions`, and parse it with `pick(..., isBoolean)` in `parseOptions`. Tests: the
     default is `false`, a stored non-boolean falls back to `false`, a stored `true` is kept, and the
     contract suite (memory and browser adapter) round-trips it.
   - Why: a stored value that is not a boolean must never switch the feature on.
   - Dependencies: None
   - Risk: Low

4. **The checkbox on the options page** (`src/options.html`, `src/js/options/external-commands.ts`,
   `src/js/options/translations.ts`, `src/js/options/page.ts`, `tests/unit/options/`)
   - Action: a section after "Native Browser Groups" with a heading, a checkbox and a paragraph, in the
     structure the other sections use. A handler in the style of `options/native-groups.ts`, without the
     browser-mode logic: it shows the stored option, saves on change through the `OptionsStore` port, and
     takes its ports as arguments. Add the three selectors to `TEXTS` in `translations.ts`.
   - Why: the user must be able to turn it on, and see what they are turning on.
   - Dependencies: Requires step 3 and the English messages from step 5
   - Risk: Low

### Phase 3: The strings (these land with Phase 2; the locale tests fail without them)

5. **English** (`src/_locales/en/messages.json`)
   - Action: the three messages. The text of `optionsExternalCommandsText` says plainly that it is off by
     default, that other add-ons can then switch to the next or previous group, and that they can do
     nothing else.
   - Why: English is the source and the default locale.
   - Dependencies: None
   - Risk: Low

6. **The 75 translations** (`src/_locales/<folder>/messages.json`, `tests/unit/locale-copies.json`)
   - Action: written the way the earlier languages were (`docs/plans/languages.md`): one language at a
     time, from the English messages, with the language's own terms for "group" and "tab" kept the same
     as in its existing messages, the add-on's name untranslated, and the result a draft that no speaker
     has read. Pass `tests/unit/locales.test.ts`, `literal-texts.test.ts` and the locale E2E and
     pseudo-locale checks. The gap allowances (`locale-gaps.json`) stay at 0, so a folder missing any of
     the three fails. `locale-copies.json` is re-measured; a copy of English that is not rightly kept as
     is must be translated instead of allowed.
   - Why: every language is held to the same checks, and a new message in English alone fails them.
   - Dependencies: Requires step 5
   - Risk: Medium (225 new messages; the languages the plan marks as less certain, `ff`, `gn`, `xh`, `my`,
     `km`, `si`, `am`, `ne`, `pa`, `ka`, `hy`, need the most care and should be read first by anyone who
     can)

### Phase 4: External messages (`runtime.onMessageExternal`)

7. **Give the external listener its sender** (`src/js/adapters/browser/events.ts`)
   - Action: change the event type to `[unknown, unknown]` (message, sender) and pass both to
     `handlers.handleExternalMessage(message, sender)`.
   - Why: the sender was being dropped before it reached any code that could judge it.
   - Dependencies: None
   - Risk: Low

8. **The sender policy** (`src/js/app/external-sender-policy.ts`, `tests/unit/app/external-sender-policy.test.ts`)
   - Action: `createExternalSenderPolicy({ options, ownId })` returns
     `(sender: unknown) => Promise<SenderDecision>`, where a decision is `{ allowed: true }` or
     `{ allowed: false, reason: 'malformed' | 'not-enabled' }`. It is `malformed` if the sender is not
     well formed or is this extension itself, `not-enabled` if the option is off, otherwise allowed. It
     reads the option on each call, through the `OptionsStore` port, because the background can be
     unloaded between messages and nothing may be cached in a module variable.
   - Why: one named function is where an allow-list of add-on ids would later replace the option.
   - Dependencies: Requires steps 1 and 3
   - Risk: Low

9. **Apply the policy, then check the message, and log safely** (`src/js/app/external-messages.ts`,
   `src/js/background/compose.ts`, their tests)
   - Action: `createExternalMessageHandler` takes the policy. It asks the policy first, so a refused
     sender learns nothing from the message check, and logs a refusal with `describeSender` and the
     reason (for `not-enabled`, a line that says external commands are off and where to turn them on).
     Only an allowed sender's message is compared with the two commands; an unknown one is logged with
     `describeMessage`. An accepted command is logged at debug level with the sender's id. `compose.ts`
     passes the policy, with the extension's own id from the browser it is allowed to name.
   - Why: replaces the unbounded `logger.error('Unknown external message:', message)`.
   - Dependencies: Requires steps 7 and 8
   - Risk: Low

### Phase 5: Prove it in real browsers, and record it

10. **E2E: a foreign add-on in a real Firefox** (`tests/e2e/message-senders.spec.ts`)
    - Action: use the lab (`tests/e2e/lab/`). Install the extension with `installLogged`, whose
      `storedOptions` argument sets the option before start. Have a probe (a separate extension with
      another id) call `runtime.sendMessage` to the extension's id with (a) a destructive internal action
      such as `deleteGroup`, (b) `activate-next-group`, (c) a malformed message. With the option **off**:
      none has any effect, and each is logged as refused. With the option **on**: (a) still changes
      nothing, (b) is accepted and logged with the probe's id, (c) is refused.
    - Why: this is the regression test for the finding, and it needs a second extension, which only the
      lab can provide. Its first run also settles two assumptions: that a foreign `sendMessage` reaches
      `onMessageExternal` and not `onMessage`, and that the probe's id is what the extension sees.
    - Dependencies: Requires steps 2 and 9
    - Risk: Medium

11. **E2E: the option and the internal path** (`tests/e2e/options-persistence.spec.ts`,
    `tests/e2e/extension.spec.ts`)
    - Action: the choice is kept across a reload; the existing Chromium test that sends a real message
      from an extension page still passes; add the delete-a-group-from-the-view case if it is not
      covered.
    - Why: the Firefox page tests use a stand-in `sendMessage`, so they would not notice a wrong internal
      check (see `firefox-real-extension-e2e.md`); Chromium is the real guard.
    - Dependencies: Requires steps 2 and 4
    - Risk: Low

12. **Document it** (`docs/spec.md`)
    - Action: the option in the stored-data section, and a "Messages" section: internal messages are
      accepted only from the extension; external messages are off by default, accept two commands from
      any well-formed sender when turned on, and are logged with the sender; why it is opt-in.
    - Why: the behaviour is a contract with other add-ons' users.
    - Dependencies: Requires step 9
    - Risk: Low

### Phase 6: Telling existing users (optional; Decision 1, option B)

13. **One notification when a well-formed sender is refused because the option is off**
    (`src/js/app/external-messages.ts`, `src/_locales/*/messages.json`, a stored flag)
    - Action: the first time this happens, show one notification ("Another add-on asked to switch
      groups. You can allow this in the options.") through the existing notifications port, and keep a
      flag so it is shown once. One more message in all 75 translations. Not repeated, and not shown for
      a malformed sender.
    - Why: without it a user whose gestures stopped has no way to learn why.
    - Dependencies: Requires step 9; needs the user's decision
    - Risk: Medium (state to keep; a message to translate)

## WebExtension API Notes

- `runtime.id` is the extension's own id; `sender.id` is set by the browser and cannot be forged by the
  sender.
- `onMessage` gets messages from the extension's own contexts (and its content scripts, if it had any);
  `onMessageExternal` gets messages from other extensions. A message from another extension never
  reaches `onMessage`. This is the assumption step 10 verifies.
- Returning `false` (or nothing) from an `onMessage` listener leaves the message unanswered; returning
  `true` keeps the channel open for `sendResponse`, as the listener does today for handled messages.
- `storage.sync` already holds the options; the new key needs no permission. No manifest change:
  `externally_connectable` is not added and `data_collection_permissions` stays `none`.
- The option is read from storage on every external message; the background may be unloaded, and the
  policy must not hold the value in memory.

## Testing Strategy

- Unit and property tests for `core/sender.ts`, the option, the policy and both listeners; the checkbox
  handler; the locale checks for all 76 folders. All under the 100% coverage and mutation gates
  (`npm run test:coverage`, `npm run test:mutation`).
- E2E: `message-senders.spec.ts` in the Firefox lab, the Chromium message test (real extension), and the
  options persistence test.
- Manual verification: with a second add-on installed, send each of the three messages with the option
  off and on and read the log; read the new section of the options page in a few languages, including a
  right-to-left one.

## Risks & Mitigations

- **Risk**: the check refuses the extension's own pages. — Mitigation: Chromium E2E sends real messages
  from real extension pages; step 2 is tested against the real `runtime.id` shape.
- **Risk**: users of gesture add-ons lose the feature on update. — Mitigation: the option's text and the
  release notes say so; Decision 1 (option B) tells them at the moment it happens.
- **Risk**: the 75 translations are unread drafts. — Mitigation: same status as the rest of those
  languages; the checks catch placeholders, markup and fit, not quality, and the least certain languages
  are listed above.
- **Risk**: a log flood from a hostile add-on. — Mitigation: each line is bounded (`describeSender`,
  `describeMessage`); there is no rate limit, by decision.
- **Risk**: the lab test depends on cross-extension messaging behaving as documented. — Mitigation: the
  first run is the check; if it differs, this plan is amended before anything else is built on it.

## Success Criteria

- [ ] An internal message from any sender other than this extension is not handled and not answered.
- [ ] With the option off (the default), every external message is refused and logged.
- [ ] With the option on, only a well-formed sender's two known commands are accepted, logged with the
      sender's id.
- [ ] No log line contains an unbounded, caller-controlled string.
- [ ] A foreign extension's destructive action has no effect, proved in a real Firefox, with the option on
      and off.
- [ ] The option is on the options page, kept across reloads, and its text exists in all 76 locales with
      the gap allowances still at 0.
- [ ] The extension's own pages still work in both browsers.
- [ ] `npm run lint`, `npm run test:coverage`, `npm run test:mutation` and `npm run test:e2e` pass.
