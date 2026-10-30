# Implementation Plan: A Themed Options Page (Dark Mode) and a Layout That Fits It

> **Status: Phases 1 to 4 are done** on the branch `feature/options-dark-theme`; see "Result" at the end. Written from
> a review of the options page in a browser in dark mode.

## Overview

The options page is bright white when the browser or the system is in dark mode, and its keyboard-shortcut rows are
indented oddly. Both come from the page not having been brought along when the rest of the extension was:

- **The page does not follow the theme at all.** The view and the popup call `applyAppearance`
  (`src/js/view/theme.ts`), which puts `theme-light` or `theme-dark` on `<body>` from the stored `theme` option (and the
  system setting when it is `auto`). The options page never calls it, and `options.css` has no dark rules. The very
  option that chooses the theme is therefore the one page that ignores it.
- **The dark rules that exist are partial and take no notice of the setting.** `browser-style.css` darkens inputs and
  buttons through `@media (prefers-color-scheme: dark)`, so in a dark system with the page background still white the
  form controls are dark on white, and choosing Light or Dark in the options changes nothing on this page.
- **The shortcut rows have fixed widths** (`.keyboardShortcuts label { width: 220px }`, `input { width: 120px }`, and
  `#optionsView .input-radio-image { width: 76px }`), probably from when the page was shown in a narrower, fixed-width place (the owner's reading; the manifest now opens it in a tab).
  A wider page leaves them stranded at the left with an arbitrary indent, and a narrow one or a longer translation
  overflows them.

## Requirements

- The options page shows in the theme chosen in its own setting: Light, Dark, or Auto (follow the system), and changes
  the moment the setting is changed, with no reload.
- Text and controls meet WCAG AA contrast (4.5:1 for text, 3:1 for controls and focus rings) in both themes.
- The layout adapts to the width of the page and to longer translated text, and mirrors for right-to-left languages
  (see `more-languages.md`).
- One definition of the colours of the extension per theme, not a copy per page.

## Design

1. **Reuse `applyAppearance` on the options page.** It already takes `body`, the system query and a settings reader, so
   `options/start.ts` calls it with `createAppearanceSettings(() => browser)`, the same adapter the view uses. This also
   makes the page follow `storage.onChanged` for the theme without new code.
2. **Colour tokens.** Define CSS custom properties (`--surface`, `--text`, `--border`, `--accent`, `--control`, ...) on
   `body` for the light theme and override them under `body.theme-dark`. `options.css` and `browser-style.css` use only
   tokens; the `@media (prefers-color-scheme: dark)` block in `browser-style.css` goes, because the class now carries
   the system case too (through `effectiveTheme`). Decide whether the view's `dark.css` moves onto the same tokens in
   this change or later; the options page must not wait for it.
3. **Images.** The radio buttons use PNG pictures (`icons/options/*.png`). Check them on a dark surface; if they are
   drawn for white, add dark variants or switch to SVG with `currentColor`.
4. **Layout.** Replace the fixed widths by a grid: the label takes the free width, the input and the buttons their
   natural size, wrapping under the label on a narrow page. Use logical properties (`margin-inline-start`, `padding-inline`)
   so right-to-left works. Remove the leftover `class="browser-style"` duplicates on buttons (an attribute written twice).

## Decisions for the owner

Taken for now, so the work could go on; each is a small change to reverse.

- **The Light/Dark/Auto pictures of the radio buttons:** kept. They are small pictures of the themes (a light window,
  a dark one, half and half) and read well on both surfaces (checked in screenshots). Redraw them only if the owner
  wants a different look.
- **The view's `dark.css` and the popup:** not moved in this change. The options page has its own tokens
  (`src/css/tokens.css`); `dark.css` still holds its own palette. Moving them is the next step toward one palette and
  is the same kind of change (the tokens file is already shared by name).
- **Maximum width:** yes, `64rem`, centred; a wide tab no longer strands the shortcut rows at the left.
- **`light-dark()` and `:has()`** are used for the tokens and for putting the theme on the scroll bars. They need
  Firefox 120 and Chrome 123; the manifest sets no minimum version, and the releases without them are out of support.
  Say so if an older browser is wanted, and the tokens become two blocks.

## Implementation Steps

Each step ends with `npm run typecheck`, `npm run lint`, the unit tests and Prettier.

### Phase 1: Follow the theme

1. `options/start.ts`: call `applyAppearance` with the real adapters; unit test it in `start.test.ts` (the body gets the
   class for the stored theme, and changes when the setting changes, with a fake matchMedia).
2. E2E (`options-theme.spec.ts`, both browsers): choose Dark in the options, expect `body.theme-dark` and a dark
   computed background; choose Light, expect the opposite; with `colorScheme: 'dark'` in the browser context and
   Auto, expect dark.

### Phase 2: Tokens and contrast

3. Introduce the tokens in `options.css`; remove the media query from `browser-style.css`.
4. A contrast check in the E2E suite (read the computed colours of text, controls and focus ring and compute the ratio
   in the test), or `@axe-core/playwright` if the owner accepts the dependency.

### Phase 3: Layout

5. Grid for the shortcut rows, the view and theme pictures, and the backup and statistics blocks; logical properties.
6. E2E at three widths (320, 800, 1600 px) checks there is no horizontal scroll and the shortcut input is visible.

### Phase 4: Close-out

7. Full `npm test`, the E2E suite on both browsers, a manual look in light, dark and auto on Firefox and Chromium, a
   "Result" section here.

## Risks and Mitigations

- **A flash of the wrong theme** while the page starts. Mitigation: apply the class before the first paint (a small
  inline-free script is not possible under the extension CSP, so apply it from the module as early as possible and keep
  the unthemed background neutral), and test with a throttled start.
- **The page is a tab of its own** (`options_ui.open_in_tab` is `true`), so the browser chrome around it keeps its own
  theme; only the page's background and controls are ours to match, and the tab's `color-scheme` should be declared
  (`color-scheme: light dark`) so the scroll bars and native controls follow the theme.
- **The two stylesheets drift again.** Mitigation: tokens only, and a unit test that fails on a hard-coded colour
  outside the token definitions (a regular expression over the CSS).

## Success Criteria

- [x] The options page is dark in Dark, light in Light, and follows the system in Auto, live
- [x] Contrast meets AA in both themes, checked by a test
- [x] No fixed width remains on the shortcut rows; the layout holds at 320, 800 and 1600 px and mirrors for RTL
- [x] One set of colour tokens; no colour literal outside it
- [x] `npm test` and the E2E suite on both browsers pass

## Skills, agents and rules for this work

Taken from everything-claude-code (commit and checksums in `.agents/EXTERNAL-SOURCES.md`), chosen because the work is
an accessibility and form-layout change:

- `.agents/skills/accessibility/SKILL.md` (WCAG 2.2: contrast, target size, focus appearance) and
  `.agents/skills/frontend-a11y/SKILL.md` (labels, keyboard, focus, reduced motion on forms; the options page is a form).
- `.agents/agents/a11y-architect.md`: an accessibility review of a page, with a compliance mapping.
- `.agents/rules/web-testing.md`: test both themes, check contrast and keyboard, check widths for overflow. Its width
  list is longer than this plan's three; 320, 800 and 1600 were kept.

Left out on purpose: `rules/web/design-quality.md` (an "anti-template" policy for marketing sites; this page is a
settings form) and the `design-system` skill (it researches competitor sites and generates a token file with a preview;
the token file here is written by hand and tested).

## Result

Done on `feature/options-dark-theme`; nothing is committed.

- **Phase 1.** `options/start.ts` applies the stored theme (`applyAppearance`, the view's own code and the same adapter)
  before the page is built, so it also follows `storage.onChanged` with no reload. Unit tests: the stored theme, Auto
  following a change of the system, and the form restyling the page. The test for the media query string came from the
  mutation run (a fake that answered every query had hidden an unchecked literal).
- **Phase 2.** `src/css/tokens.css` holds each colour once as `light-dark(light, dark)`. `color-scheme` follows the theme
  class (and the system until the class is there, which removes the flash of the wrong theme); on the root element it
  also themes the scroll bars. `browser-style.css` lost its system-only media query. Two unit tests: every pair of tokens
  meets AA in both themes (4.5:1 text, 3:1 control edges and the focus ring), and no colour literal appears in the
  options page's sheets or inline styles. Both were run against a deliberately wrong input and failed as they should.
  An E2E case reads the computed colours in the real browser and applies the same thresholds.
- **Phase 3.** The shortcut rows are a grid with the same columns in every row (wrapping to a row of their own below
  `40rem`); logical properties replace left and right; the radio pictures size to their content. E2E at 320, 800 and
  1600 px: no sideways scroll, every field in view, and an RTL case.
- **Found by looking at the page, not in the plan**
  - **Text overlapped on `main` as well:** the picture radios had a fixed height, so "(classic)" ran into the
    "Toolbar" heading and "Follow System" into "Native Browser Groups". Fixed, and an E2E check fails on any heading and
    picture whose contents overlap; it was shown to fail on the old CSS (its first version measured the box instead of
    the text and passed on the old CSS, which is why it measures what the contents occupy now).
  - **Two buttons were never styled:** "Save backup" and "Reset" had `class="browser-style"` themselves while the rule
    was `.browser-style button` (a descendant). The shortcut buttons wrote the `class` attribute twice, and the second
    is ignored. Both fixed.
  - **The keyboard was invisible on the pictures:** the radio is hidden, so there was no focus indicator. The
    picture gets the ring now.
  - **A literal `<br />` shows in the Import paragraph** ("...overwrite anything.<br />You can also import..."): the
    message holds markup that the page sets as text. This is a translation-handling problem and belongs to
    `more-languages.md` (messages with markup); not fixed here.
  - **The E2E stand-in for Firefox** (`tests/e2e/fixtures.ts`) had a `storage.onChanged` that did nothing, so a live
    change could not be seen there. It now tells its listeners as the real API does.
- **Checks.** `npm test`: 2,825 tests, 100% on every metric, 0 lint findings; mutation score of `options/start.ts` 100%;
  the whole E2E suite on Chromium and Firefox, 82 passed and 8 skipped (the skips are the ones that were skipped before).
- **Not done:** the view and popup on the same tokens (Decision above); a screenshot per theme is kept as a test
  attachment but is not compared against a stored image.
