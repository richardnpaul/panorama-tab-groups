# Testing Plan for Panorama Tab Groups

Based on the extension specification, this is the plan for building comprehensive tests to verify this behavior using the existing Playwright configuration.

## Phase 1: Unit Tests for Core Logic

Create unit tests (using Playwright or a basic test runner) for independent modules without requiring full browser contexts.

- **StateManager**: Mock `browser.sessions` and `browser.storage` to test caching logic, state persistence, and initialization of system groups (e.g., ensuring group `-2` is always created).
- **Utils**: Test functions like `getLowestPositiveGroupId`, `mod`, and color generation.

## Phase 2: Feature / Integration Tests

Tests that verify the interaction of multiple components within the extension context.

- **Background Listeners**: Verify that `tabCreated` correctly assigns tabs to the active group.
- **Visibility Toggle Logic**: Create mock scenarios to ensure `toggleVisibleTabs` calculates the correct arrays of tabs to show vs. hide.

## Phase 3: Playwright End-to-End (E2E) Tests

Add comprehensive E2E tests in the `tests/` directory using the provided Chromium/Firefox configurations.

- **E2E - State Persistence**:
  - Open multiple tabs, group them, close the browser context, and restore to verify state persistence across restarts.
- **E2E - Panorama View Interactions**:
  - Load `view.html`.
  - Assert that Layout modes (Tiling vs Freeform) correctly arrange group DOM nodes.
  - Verify tab Search functionality filters tabs correctly.
- **E2E - Keyboard Shortcuts & Navigation**:
  - Send shortcut keystrokes (`Alt+W`, `Alt+Shift+W`) and assert that the active group switches and visible tabs update accordingly.
- **E2E - Cross-Window Isolation**:
  - Open two distinct windows. Create a group in Window 1, and ensure it does not appear in Window 2's state.

<!-- PLAN_COMPLETE: docs/plans/spec-and-testing-plan.md -->
