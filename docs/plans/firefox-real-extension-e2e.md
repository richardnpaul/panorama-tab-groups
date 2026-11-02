# Implementation Plan: Real-Browser Verification of the Stand-ins, and Honest E2E Reporting

## Overview

Much of what is called "tested in Firefox" runs against a stand-in for the browser, not the browser:

- **The Firefox page tests.** The `page` fixture serves `dist/` over HTTP on `127.0.0.1` and replaces
  `window.browser` with a hand-written fake (`createFirefoxPageProxy` in `tests/e2e/fixtures.ts`),
  because Playwright cannot navigate to `moz-extension://` addresses.
- **The browser-adapter unit tests.** They run the shared contract suites
  (`tests/support/*-contract.ts`) against fakes of `browser` (`tests/support/fake-sessions.ts`,
  `fake-storage.ts`), which describe themselves as stand-ins.

Only Chromium (real extension) and the lab (`tests/e2e/lab/`, a real Firefox with a probe extension)
touch a real browser API, and the lab is used by two specs. Nothing in a report or a rule says which
tests ran against what, and nothing checks that the stand-ins behave like the browser.

This plan does the work that is certain first: label what each run proved, type and test the page
stand-in, and run the contract suites that already exist against a real Firefox, which checks all three
stand-ins at once. Only then does it investigate whether real extension pages can be driven in real
Firefox, which may not be achievable; the plan is complete without it.

It builds on `firefox-playwright-e2e-stabilization.md`, which kept the proxy workaround and predates
the stand-in (its file names, `playwright.config.js` and `tests/extension.spec.js`, are historical).
Where the two differ, this plan is the current decision.

## Requirements

- A green E2E result says what it proved: the real extension, or a stand-in browser.
- The stand-ins cannot drift silently from the real WebExtension API.
- The behaviour of the browser adapters is checked against a real Firefox, not only against fakes.
- Real extension pages are driven in real Firefox only if an investigation shows it can be done.
- No test hooks in shipped code. No new script, dependency or tool without the user's approval
  (`.agents/rules/verification-validation-rules.md`, section 6).

## Decisions Needed

1. **Policy text (Phase 1, step 3): decided.** The user chose to adopt the requirement in its narrower
   wording: the line keeps "at least one new Playwright E2E test case", asks the report to say whether
   each test ran against the real extension or the Firefox stand-in, and requires a lab test for
   behaviour that exists only in Firefox. Applied to `AGENTS.md`, the planner agent, the
   `playwright-webext` skill and the verification rule. Reason: the project already skips stand-in
   tests by hand (four specs say so in their skip reasons), and this writes that practice down.
2. **Tooling, only if Phase 4 needs it.** If the investigation finds that only a WebDriver-based tool can
   drive `moz-extension://` pages, adding that dependency is the user's decision. The plan stops there.

## Affected Files

- `tests/e2e/fixtures.ts` — annotate every test with what it ran against; move the page stand-in out
- `tests/e2e/fake-browser.ts` (new) — the page stand-in, typed against the real API
- `tests/unit/e2e-support/fake-browser.test.ts` (new) — unit tests of the page stand-in's behaviour
- `tests/e2e/fake-browser-contract.spec.ts` (new) — the page stand-in against the real Firefox
- `tests/e2e/adapter-contract.spec.ts` (new) — the existing contract suites on the real browser adapters
- `tests/support/*-contract.ts` — reused; a contract for `Tabs` and `NativeGroups` added if absent
- `tests/e2e/lab/lab.ts` — a way to forward `browser.<api>` calls to the probe; the spike's helper
- `.agents/rules/verification-validation-rules.md` — Gate 5 and the sign-off wording
- `.github/skills/playwright-webext/SKILL.md` — annotation names, the contract specs
- `AGENTS.md`, `.github/agents/planner.agent.md` — the E2E policy line (done, see Decisions)
- No changes under `src/`, in `src/manifest.json`, or in `docs/spec.md`

## Implementation Steps

### Phase 1: Say what a run proved (certain, cheap)

1. **Annotate every test with its browser source** (`tests/e2e/fixtures.ts`)
   - Action: an automatic fixture adds an `annotations` entry `browser-api` with the value `real`
     (Chromium; any test using the lab) or `stand-in` (Firefox through the page proxy). Lab tests get it
     from `startLab`.
   - Why: the HTML report then shows which tests touched a real browser API, without a new reporter.
   - Dependencies: None
   - Risk: Low

2. **A test that fails if a Firefox page test goes unannotated** (`tests/unit/e2e-support/`)
   - Action: a unit test over the fixture module's annotation helper: both values exist, and the Firefox
     page path uses `stand-in`.
   - Why: the label is only worth anything if it cannot be forgotten.
   - Dependencies: Requires step 1
   - Risk: Low

3. **Change the wording of the gates and the policy line** (`AGENTS.md`,
   `.github/agents/planner.agent.md`, `.github/skills/playwright-webext/SKILL.md`,
   `.agents/rules/verification-validation-rules.md`) — **done**
   - Action: `AGENTS.md` keeps "at least one new Playwright E2E test case" and adds: say in the report
     whether each ran against the real extension (Chromium, or the Firefox lab) or only the Firefox
     stand-in; behaviour that exists only in Firefox (tab hiding, native groups, the real `sessions` API)
     needs a lab test. The planner, the skill and the rule say the same. Gate 5 gains a "what a green E2E
     run proved" paragraph, and the sign-off reports E2E as three lines: Chromium (real extension),
     Firefox page tests (stand-in), Firefox lab tests (real).
   - Why: the behaviour being corrected is a Firefox pass being reported as more than it is.
   - Dependencies: None. The three-line report can be written by hand until step 1 labels the tests.
   - Risk: Low

### Phase 2: Stop the page stand-in drifting (certain, medium)

4. **Write the page stand-in as typed TypeScript** (`tests/e2e/fake-browser.ts`, `tests/e2e/fixtures.ts`)
   - Action: replace the template string in `createFirefoxPageProxy` with an exported function passed to
     `page.addInitScript(fn, config)`. Type what it builds with `satisfies` against the parts of
     `typeof browser` it implements, so `npm run typecheck` fails when `@types/firefox-webext-browser`
     changes a signature it fakes. The messages and commands are passed as the argument instead of being
     spliced into source text.
   - Why: today the stand-in is an untyped string; nothing checks it against anything.
   - Dependencies: None
   - Risk: Medium (Playwright serialises the function, so it must not close over anything)

5. **Unit-test the page stand-in** (`tests/unit/e2e-support/fake-browser.test.ts`)
   - Action: Vitest (jsdom) tests of storage round trips, `onChanged` delivery, tab creation and the
     session values.
   - Why: it is code that decides whether tests pass; it should be tested like code.
   - Dependencies: Requires step 4
   - Risk: Low

### Phase 3: Check the stand-ins against a real Firefox (certain, medium)

6. **Forward `browser.<api>` calls to the probe** (`tests/e2e/lab/lab.ts`)
   - Action: a helper that returns an object shaped like `browser` whose methods call
     `probe.call('<namespace>.<method>', ...args)` and return the answer (a recursive `Proxy`, request and
     response only; events cannot be forwarded one call at a time).
   - Why: it lets the real browser adapters in `src/js/adapters/browser/` run in Node against the real
     Firefox API with no change to them.
   - Dependencies: None
   - Risk: Medium (the answer arrives structured-cloned, as it would for any extension)

7. **Run the existing contract suites on the real browser adapters**
   (`tests/e2e/adapter-contract.spec.ts`)
   - Action: `tests/support/group-state-contract.ts`, `options-contract.ts` and `shortcuts-contract.ts`
     already describe what every implementation of a port must do. They run today on the memory adapter
     and on the browser adapter over `createFakeSessions()` / `fake-storage.ts`. Add a run of each on the
     browser adapter over the forwarding helper from step 6. Where a port has no contract (`Tabs`,
     `NativeGroups`), write one first, and run it on the memory adapter too.
   - Why: if the real run passes, the fakes behave like the browser for everything the suites check; if it
     fails, either a fake or the adapter was wrong, and that is the finding. This is how the
     `fake-sessions.ts` and `fake-storage.ts` stand-ins are verified without touching them.
   - Dependencies: Requires step 6
   - Risk: Medium

8. **Contract-test the page stand-in against the real Firefox** (`tests/e2e/fake-browser-contract.spec.ts`)
   - Action: in the lab, make the same list of calls against the probe (real) and against the page
     stand-in in a lab page, and compare the results in shape. Start with the calls the pages make. One
     suspected mismatch to settle first: the page stand-in's `sessions.getWindowValue` returns `null` for
     a missing value while its `getTabValue` returns `undefined`, and the `GroupState` port promises
     `undefined`.
   - Why: turns "the stand-in is probably right" into a test.
   - Dependencies: Requires steps 4 and 6
   - Risk: Medium

### Phase 4: Investigate real extension pages in real Firefox (last, may not be achievable)

9. **Spike: can Playwright drive a page the extension opened itself?** (`tests/e2e/lab/lab.ts`, a
   temporary spec)
   - Action: time-boxed (half a day), after Phases 1 to 3. Load a copy of `dist-firefox` into the lab as
     `installLogged` already does, with a test-only background snippet **in the copy only** that opens
     `view.html` with `tabs.create` when the probe asks. See whether Playwright sees the page, can read
     its DOM, click and take a screenshot, and whether a click reaches the real background. The hypothesis
     is that only Playwright-initiated navigation to `moz-extension://` fails; this is not verified and
     may be wrong.
   - Success: all four. Anything less is a failure, with the reason recorded below.
   - Why: decides whether any real-page Firefox E2E is possible before anything is built on a guess.
   - Dependencies: Requires Phases 1 to 3 to be done (so the plan delivers without it)
   - Risk: High (unknown Playwright and Firefox behaviour)

10. **Record the result, and act on it only if it succeeded** (this plan, `tests/e2e/`)
    - Action (success): a `realFirefoxPage` helper in `tests/e2e/lab/`, and a few journeys (view opens,
      switching groups, options persistence) run on it, annotated `real`. Action (failure): write the
      result under "Spike result" below, name the next option (a WebDriver-based tool, which needs the
      user's approval) and stop. Chromium remains the real-UI E2E; the lab and the contract suites cover
      real Firefox behaviour.
    - Why: the plan ends in a recorded decision, not an open question.
    - Dependencies: Requires step 9
    - Risk: Medium

### Spike result

_Not run yet._

## WebExtension API Notes

- No manifest or permission changes, and no production code changes.
- `moz-extension://` navigation by Playwright is the limit being worked around; the plan does not try to
  fix Playwright.
- The probe is a separate extension, so its `sessions` values are its own; contract tests compare
  behaviour, not the real extension's stored data.
- Chromium is already end to end against the real extension; this plan is about Firefox.

## Testing Strategy

- E2E tests: the contract specs in Phase 3, each carrying the `browser-api` annotation, and, if the
  spike succeeds, the ported journeys.
- Unit tests: the page stand-in's behaviour, the annotation guard, and the contract suites on the memory
  adapters (existing). Test code is outside the coverage and mutation scope; the gates still apply to
  anything under `src/`.
- Manual verification: open the HTML report and confirm the annotations separate real from stand-in.

## Risks & Mitigations

- **Risk**: the spike fails and Phase 4 delivers nothing. — Mitigation: it comes last, and Phases 1 to 3
  stand on their own.
- **Risk**: the real run of a contract suite fails because the lab's probe differs from the extension
  (its own sessions, no `tabHide` permission). — Mitigation: the probe's permissions are the lab's to
  set; any difference found is written into the contract as a documented exception, not hidden.
- **Risk**: the typed page stand-in cannot be serialised by Playwright. — Mitigation: keep it one
  self-contained function taking its configuration as an argument; fall back to a string built from a
  tested template only if that fails, and say so here.
- **Risk**: the contract specs make E2E slower (lab start-up). — Mitigation: one lab per spec file, as
  `native-groups-first-run.spec.ts` does.

## Success Criteria

- [ ] Every E2E test carries a `browser-api` annotation, and a test guards that it cannot be omitted.
- [x] The rule, the skill, the planner and `AGENTS.md` carry the E2E wording (step 3).
- [ ] The page stand-in is typed against `@types/firefox-webext-browser`, unit-tested, and
      contract-tested against a real Firefox.
- [ ] The `getWindowValue` null-versus-undefined question is answered by a test.
- [ ] The `GroupState`, `OptionsStore` and `Shortcuts` contract suites pass on the real Firefox through the
      browser adapters, and any difference from the fakes is fixed or documented.
- [ ] The spike's result is written in this plan, with the next option if it failed.
- [ ] `npm run lint`, `npm run test:coverage` and `npm run test:e2e` pass.
