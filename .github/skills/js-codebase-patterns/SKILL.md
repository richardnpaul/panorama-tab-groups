---
name: js-codebase-patterns
description: JavaScript ES2022 codebase conventions for panorama-tab-groups. Covers module system (named exports, .js extensions), JSDoc requirements, StateManager usage (correct method names), View model pattern, reserved group IDs, Prettier/ESLint config, and anti-patterns. Always load before writing any code.
---

## When to Use

Always load before writing any JavaScript code in this project.

## Module System

```javascript
// ✅ CORRECT — named export with explicit .js extension
export function myFunction() {}
import { myFunction } from './myFunction.js';

// ❌ WRONG — no default exports
export default function () {}

// ❌ WRONG — missing .js extension (ESLint error: import/extensions)
import { myFunction } from './myFunction';
```

## JSDoc Requirements

Required on **every exported function and class**:

```javascript
/**
 * Brief description of the function.
 * @param {number} windowId - The browser window ID
 * @param {Array<Object>} groups - Array of group objects to store
 * @returns {Promise<void>}
 */
export async function setGroups(windowId, groups) {
  // ...
}
```

JSDoc is not required on private/unexported helpers.

## StateManager Usage

**CRITICAL**: Never call `browser.storage` or `browser.sessions` directly. Always use the `StateManager` instance.

```javascript
// ❌ WRONG — direct storage call
await browser.sessions.setWindowValue(windowId, 'groups', groups);
await browser.storage.local.set({ groups });

// ✅ CORRECT — through StateManager
const groups = await stateManager.getGroups(windowId);
await stateManager.setGroups(windowId, groups);
```

### StateManager Methods (complete list)

| Method           | Signature                           | Notes                                         |
| ---------------- | ----------------------------------- | --------------------------------------------- |
| `getGroups`      | `getGroups(windowId)`               | Returns array of group objects for the window |
| `setGroups`      | `setGroups(windowId, groups)`       | Persists group array for the window           |
| `getActiveGroup` | `getActiveGroup(windowId)`          | Returns the active group ID for the window    |
| `setActiveGroup` | `setActiveGroup(windowId, groupId)` | Sets the active group for the window          |
| `getGroupId`     | `getGroupId(tabId)`                 | Returns the group ID assigned to a tab        |
| `setGroupId`     | `setGroupId(tabId, groupId)`        | Assigns a tab to a group                      |
| `getGroupIndex`  | `getGroupIndex(windowId)`           | Returns the next available group index        |
| `setGroupIndex`  | `setGroupIndex(windowId, index)`    | Sets the group index counter                  |

## Reserved Group IDs

From `src/js/background/constants.js`. **Never use as real group IDs:**

```javascript
const PANORAMA_VIEW_GROUP_ID = -1;
const UNGROUPED_GROUP_ID = -2;

// Use the helper to check:
import { isReservedGroupId } from './constants.js';
if (!isReservedGroupId(groupId)) {
  // safe to use as a real group
}
```

## View Model Pattern

UI views extend the `View` base class:

```javascript
import { View } from '../_share/js/models/View.js';

export class MyView extends View {
  constructor(container) {
    super(container);
    // ...
  }
}
```

Base class location: `src/js/_share/js/models/View.js`

## File & Naming Conventions

| Type               | Convention                             | Example              |
| ------------------ | -------------------------------------- | -------------------- |
| Background scripts | `PascalCase.js`                        | `StateManager.js`    |
| View classes       | `PascalCase.js`                        | `GroupView.js`       |
| Shared models      | `PascalCase.js` in `_share/js/models/` | `Tab.js`, `Group.js` |
| Constants          | `SCREAMING_SNAKE_CASE`                 | `UNGROUPED_GROUP_ID` |
| Functions          | `camelCase`                            | `getActiveGroup`     |

## Prettier Configuration

```json
{
  "singleQuote": true,
  "printWidth": 80,
  "trailingComma": "all",
  "arrowParens": "always",
  "semi": true
}
```

Run `npm run format` to auto-apply. Always run before `npm run lint`.

## ESLint Rules (airbnb-base)

Key rules that commonly trip up:

- `import/extensions` — must include `.js` extension on all imports
- `no-restricted-syntax` — prefer `for...of` with iterables, avoid `for...in`
- `no-param-reassign` — do not reassign function parameters directly
- `prefer-const` — use `const` unless the variable is reassigned
- `no-shadow` — do not shadow outer scope variables

## Anti-Patterns

```javascript
// ❌ NO default exports
export default class MyClass {}

// ❌ NO missing .js extensions
import { foo } from './foo';

// ❌ NO direct storage calls
await browser.storage.local.set({ key: value });

// ❌ NO TypeScript syntax
const x: number = 5;

// ❌ NO module-level mutable state in background scripts
let cachedWindowData = {}; // lost when service worker terminates

// ❌ NO magic numbers — use constants.js
if (groupId === -1) {} // use PANORAMA_VIEW_GROUP_ID
```
