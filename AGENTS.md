# Agent Lifecycle & Signaling Protocol

This repository is configured with specialized GitHub Copilot Agents for structured feature development. Agents communicate through a structured HTML comment signaling protocol and are orchestrated by the `@coordinator`.

## Core Principles

1. **Coordinator Orchestrates** — `@coordinator` is the entry point for end-to-end features; it never writes code.
2. **Planner Plans Only** — `@planner` writes to `docs/plans/` only; a system hook prevents all other file edits.
3. **Implementer Implements** — `@implementer` follows the plan, runs lint/format, and only hands off on `LINT_PASS`.
4. **Reviewer is the Gate** — `@reviewer` audits security, quality, and E2E tests; returns `PASS` or `FAIL` with severity.
5. **Plans as ADRs** — every feature gets a plan file in `docs/plans/` that serves as an Architectural Decision Record.

## Available Agents

| Agent          | File                                                                       | Purpose                                                       |
| -------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `@coordinator` | [.github/agents/coordinator.agent.md](.github/agents/coordinator.agent.md) | Orchestrates full lifecycle: planner → implementer → reviewer |
| `@planner`     | [.github/agents/planner.agent.md](.github/agents/planner.agent.md)         | Creates implementation plans in `docs/plans/`                 |
| `@implementer` | [.github/agents/implementer.agent.md](.github/agents/implementer.agent.md) | Implements code following plans                               |
| `@reviewer`    | [.github/agents/reviewer.agent.md](.github/agents/reviewer.agent.md)       | Reviews code quality, security, and runs E2E tests            |

## Agent Modes

### 1. Lifecycle Mode (End-to-End Features)

**Invoke `@coordinator`** for end-to-end feature development.
The coordinator orchestrates the entire process automatically:

```
User → @coordinator
           ↳ @planner   → docs/plans/<feature>.md
           ↳ user approval
           ↳ @implementer → LINT_PASS
           ↳ @reviewer   → PASS / FAIL
           ↳ [if FAIL] @implementer (with full review report)
           ↳ [loop until PASS]
```

You do **not** need to prompt sub-agents during a coordinator run.

### 2. Surgical Mode (Targeted Tasks)

Invoke `@planner`, `@implementer`, or `@reviewer` directly for single-turn targeted tasks:

```
@reviewer check this function for DOM XSS
@implementer add JSDoc to exported functions in src/js/background/StateManager.js
@planner design a plan for keyboard shortcut support
```

## Agent Signaling Protocol

Agents use HTML comment tokens to communicate completion status. The coordinator parses these to drive the next step.

| Agent       | Signal Token                                       | Meaning                                          |
| ----------- | -------------------------------------------------- | ------------------------------------------------ |
| Planner     | `<!-- PLAN_COMPLETE: docs/plans/<filename>.md -->` | Plan written; awaiting coordinator/user approval |
| Implementer | `<!-- IMPL_COMPLETE: LINT_PASS -->`                | All code written; lint passes; ready for review  |
| Reviewer    | `<!-- REVIEW_RESULT: PASS -->`                     | No CRITICAL/HIGH issues; tests pass              |
| Reviewer    | `<!-- REVIEW_RESULT: FAIL severity=CRITICAL -->`   | Issues found; implementer must fix before merge  |

## Security Guidelines

- Every agent includes a **Prompt Defense Baseline** to resist injection attacks from untrusted content
- The planner's `edit` tool is blocked by a PreToolUse hook to `docs/plans/` only
- The reviewer has `execute` only for running tests — it cannot modify files
- The coordinator has `agent` and `todo` only — it cannot read, write, or execute directly

## Coding Workflow

1. Always use StateManager — never call `browser.storage` or `browser.sessions` directly
2. Always run `npm run format` then `npm run lint` before finishing any implementation pass
3. Every new feature must have at least one new Playwright E2E test case
4. Plans in `docs/plans/` serve as the authoritative record of design decisions

## Plans as ADRs

Plan files in `docs/plans/` are permanent Architectural Decision Records. Once implemented, they should **not** be deleted — they document why decisions were made, not just what was done.
