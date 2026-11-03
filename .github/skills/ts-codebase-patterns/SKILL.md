---
name: ts-codebase-patterns
description: TypeScript codebase conventions for tab-groups-viewer. Covers the layers and which may import which, module and type rules the linter and compiler enforce, how persisted state is reached, naming and anti-patterns. Always load before writing any code.
---

## When to Use

Always load before writing or changing code in `src/`, `tests/`, `scripts/` or `tools/`.

This skill holds the conventions, not a copy of the code. When it names a file, read that file for the
current detail (method lists, signatures, option values) instead of trusting a copy here.

Each rule says how it is held: **lint** (`npm run lint` fails), **compiler** (`npm run typecheck`
fails) or **convention** (reviewers check it; nothing fails automatically).

## Layers

The code is ports and adapters. Keep the dependency direction; it is what makes the 100% coverage and
mutation gates practical.

| Layer             | Path                                       | Role                                                         | May import                      |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------ | ------------------------------- |
| core              | `src/js/core/`                             | Pure logic and constants                                     | `ports`, `share`                |
| ports             | `src/js/ports/`                            | Interfaces the rest depends on                               | `core` (types only)             |
| app               | `src/js/app/`                              | Use cases and services, given their ports as arguments       | `ports`, `core`, `share`        |
| adapters          | `src/js/adapters/{browser,memory,system}/` | The real browser, in-memory fakes, and the system clock etc. | `ports`, `share`, `core`, `app` |
| share             | `src/js/share/`                            | Small helpers: type guards, DOM lookups, utils               | `ports`, `core`                 |
| composition roots | `background/`, and each page's `start.ts`  | Build the real objects and wire them together                | anything                        |

- **`core` and `app` never import an adapter and never name `browser`.** They receive what they need as
  arguments (**convention**).
- **Only adapters and composition roots name the browser's storage or sessions.** The `tgv/no-browser-storage`
  rule flags `.storage` and `.sessions` member access in `src/**/*.ts`, and `no-restricted-globals` bans
  window globals such as `event`, `close` and `history`. The exempt files are listed in `.oxlintrc.json`
  (**lint**).
- **Tests use the `memory/` adapters** as ready-made fakes of the ports, and Vitest mocks for the other
  external interfaces.

## Modules

```typescript
// ✅ Named export; the import specifier ends in .js although the file is .ts
export function doThing() {}
import { doThing } from './thing.js';

// ✅ A type-only import says so
import type { Thing } from '../ports/thing.js';

// ❌ Missing extension (lint: import/extensions)
import { doThing } from './thing';
```

- **Named exports only** (**convention**). Lint does not forbid `export default`, and a couple of older
  entry modules still use it; do not add more.
- **`import type` for imports used only as types** (**compiler**, `verbatimModuleSyntax`).
- **No classes.** `no-extraneous-class` rejects static-only ones and the code has none (**lint**). Use
  functions, object literals and `createXxx(dependencies)` factories.
- **Erasable syntax only** (**compiler**, `erasableSyntaxOnly`): no `enum`, no `namespace`, no
  constructor parameter properties. Use union types and `as const` objects.

## Types

- **Strict compiler flags** (**compiler**; see `tsconfig.json`). Two change how code is written:
  `noUncheckedIndexedAccess` (indexing gives `T | undefined`) and `exactOptionalPropertyTypes` (an
  optional property cannot be set to `undefined` explicitly).
- **No `any`, no `!` non-null assertion, and no `as` assertions at all** (`consistent-type-assertions`
  is set to `never`). **No `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`** (**lint**, plus
  `npm run lint:suppressions`).
- **Narrow with guards, not casts.** Take `unknown` at a boundary and narrow it with the type guards in
  `src/js/share/guards.ts`; add a guard there rather than a cast.
- **`interface` for object shapes and `T[]` for arrays** (**lint**).
- **Every promise is awaited, returned or handled** (`no-floating-promises`, `no-misused-promises`)
  (**lint**).

## Doc comments

Every exported function and interface has a `/** ... */` comment saying what it is for and why
(**convention**, not linted). The types come from the signature, so do not repeat them with
`@param {Type}`:

```typescript
/**
 * The groups with the system group guaranteed to be there: added if missing.
 * The given list is not changed.
 */
export function withSystemGroup(groups: readonly Group[]): Group[] {
  // ...
}
```

Private helpers need a comment only where the reason is not obvious from the code.

## Persisted state

Anything the extension persists is reached through a port, never through `browser.storage` or
`browser.sessions` directly (**lint**, see Layers).

- Group state (which groups exist, which is active, which group each tab is in) is the `GroupState`
  port, `src/js/ports/group-state.ts`. Read it for the methods and their signatures.
- The real instance is `stateManager` in `src/js/background/StateManager.ts`. `app` code takes a
  `GroupState` as an argument rather than importing `stateManager`.
- Reads give `undefined` for anything never stored. Handle that; do not assume a value.
- A new kind of persisted state gets its own port and adapters (browser and memory), not a new use of
  the browser API in `app` or `core`.

```typescript
// ❌ Reaching for the browser (lint: tgv/no-browser-storage)
await browser.sessions.setWindowValue(windowId, 'groups', groups);

// ✅ Through the port
await groupState.setGroups(windowId, groups);
```

## Reserved group ids

The viewer tab and the "ungrouped tabs" group have reserved ids. They are constants in
`src/js/core/constants.ts`, next to the other shared constants (timeouts, names). Never use a literal for
one of them or for any other magic number: add or reuse a constant there. To check an id, use
`isReservedGroupId` or `isValidUserGroupId` from the same file; both take `unknown`, so they work on
values read from storage.

## Naming

| Thing                   | Convention                                                       |
| ----------------------- | ---------------------------------------------------------------- |
| Files                   | `kebab-case.ts`                                                  |
| Constants               | `SCREAMING_SNAKE_CASE`                                           |
| Functions and variables | `camelCase`; no leading or trailing `_` (`no-underscore-dangle`) |
| Types and interfaces    | `PascalCase`                                                     |
| Factories               | `createXxx(dependencies)`                                        |

## Formatting and lint

Prettier decides formatting (`.prettierrc`); run `npm run format` before `npm run lint`. oxlint rules are
in `.oxlintrc.json` and its messages say what to change. The ones that surprise people:

- `no-plusplus` (write `i += 1`), `no-continue`, `no-nested-ternary`, `no-bitwise`
- `no-await-in-loop` (collect the promises and `await Promise.all(...)`, or restructure)
- `no-shadow`, `no-use-before-define`, `prefer-destructuring`, `prefer-template`

## Anti-patterns

```typescript
// ❌ A cast instead of narrowing
const group = value as Group;

// ❌ Silencing the compiler or the linter
// @ts-ignore

// ❌ Naming the browser in app or core code
await browser.storage.local.set({ groups });

// ❌ A magic number: use the named constant
const isViewer = groupId === -1;

// ❌ State in a module variable: the background can be unloaded
// (a Chromium service worker stops when idle) and the value is lost
let cachedWindowData: Record<number, Group[]> = {};
```
