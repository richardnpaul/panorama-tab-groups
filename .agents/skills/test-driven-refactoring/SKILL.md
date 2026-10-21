---
name: test-driven-refactoring
description: Strictly codified workflow for test-driven refactoring to achieve 100% unit test coverage. Use this to ensure test isolation, step-by-step verification, and prevent changing tests and code in the same step.
---

# Test-Driven Refactoring (TDR) Workflow

This guideline enforces a strict separation between writing tests and writing implementation code, especially when refactoring or attempting to reach 100% unit test coverage.

## Core Rules

1. **Run ALL Tests**:
   - Run all tests and linting to establish the baseline before making any changes.
     - There should be no failures in the baseline.
     - If there are failures, breakglass and hand back to the user to resolve the situation.

2. **Test Coverage First**:
   - Write tests for the current code behavior _before_ changing any functional code.
   - If functional code must be refactored, first write the test defining the _final/expected_ behavior.

3. **Strict Phase Separation**:
   - **NEVER** edit both tests and implementation code in the same tool invocation or step.
   - Separate test additions and code modifications into distinct steps.

4. **Required Loop Verification**:
   - Run the following validation suite after _every single_ step (either test addition or implementation change):
     ```bash
     npm run test:coverage
     npm run test:unit
     npm run lint:prettier
     npm run lint:eslint
     ```
   - Ensure the suite passes clean before proceeding to the next step.

5. **Verify No Regressions**:
   - Run the E2E suite (`npm run test:e2e`) when changing functional code to prevent regressions.
