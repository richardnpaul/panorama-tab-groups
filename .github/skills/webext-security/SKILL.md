---
name: webext-security
description: WebExtension security checklist for code review of Firefox/Chromium MV3 extensions. Covers CRITICAL risks (sender validation, DOM XSS, externally_connectable), HIGH risks (host_permissions, content script isolation), MEDIUM risks (CSP, hardcoded secrets, dynamic executeScript), with code examples, OWASP mapping, and bash quick-scan commands.
---

## When to Use

Load this skill before starting any code review, security audit, or when implementing message handlers, content scripts, or manifest permission changes.

## CRITICAL Severity

### C1: `browser.runtime.onMessage` Sender Validation

Every message listener MUST validate `sender.id`. Without this, any web page or rogue extension can send commands to your background script.

```javascript
// ❌ CRITICAL — no sender validation
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'deleteAllGroups') deleteAllGroups(); // any page can trigger this!
});

// ✅ SECURE
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id) return; // reject unknown senders
  if (message.type === 'deleteAllGroups') deleteAllGroups();
});
```

OWASP: A01 Broken Access Control

### C2: DOM XSS in Extension Pages

Extension pages run in a privileged context. `innerHTML` with user-controlled data creates XSS vulnerabilities that can exfiltrate browsing data.

```javascript
// ❌ CRITICAL — DOM XSS
tabEl.innerHTML = `<span>${tabTitle}</span>`; // tab titles are user-controlled

// ✅ SECURE — use textContent or DOM construction
const span = document.createElement('span');
span.textContent = tabTitle;
tabEl.appendChild(span);
```

OWASP: A03 Injection

### C3: `externally_connectable` Misconfiguration

Broad `externally_connectable` in `manifest.json` lets arbitrary websites send messages to the extension background:

```json
// ❌ CRITICAL — wildcard allows any HTTPS site
"externally_connectable": { "matches": ["https://*/*"] }

// ✅ SECURE — restrict to specific, known origins
"externally_connectable": { "matches": ["https://specific-partner.example.com/*"] }
```

OWASP: A01 Broken Access Control

---

## HIGH Severity

### H1: `host_permissions` Over-Reach

```json
// ❌ HIGH — grants access to all websites
"host_permissions": ["<all_urls>"]

// ✅ BETTER — minimum required scope
"host_permissions": ["https://api.example.com/*"]
```

OWASP: A05 Security Misconfiguration

### H2: Content Script Isolation Leaks

Never attach extension internals to the page's global scope:

```javascript
// ❌ HIGH — leaks StateManager reference to the web page
window.stateManager = stateManager;

// ✅ SECURE — use message passing instead
browser.runtime.sendMessage({ type: 'getGroups', windowId });
```

OWASP: A02 Cryptographic / Data Exposure

### H3: Insecure URL Handling in `tabs.update`

```javascript
// ❌ HIGH — navigates to attacker-controlled URL
await browser.tabs.update(tabId, { url: userInput });

// ✅ SECURE — validate scheme before navigating
const ALLOWED_SCHEMES = [
  'https:',
  'http:',
  'moz-extension:',
  'chrome-extension:',
];
const parsed = new URL(userInput);
if (!ALLOWED_SCHEMES.includes(parsed.protocol))
  throw new Error('Blocked URL scheme');
await browser.tabs.update(tabId, { url: userInput });
```

OWASP: A01 Broken Access Control

---

## MEDIUM Severity

### M1: Content Security Policy

`manifest.json` should define a strict CSP:

```json
// ✅ GOOD — blocks inline scripts and eval
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'none';"
}
```

### M2: Hardcoded Sensitive Values

No API keys, tokens, or credentials in source files. Use `browser.storage.local` for any runtime-configured secrets (and never log them).

### M3: Dynamic `scripting.executeScript`

If code constructs a script string dynamically, audit for injection:

```javascript
// ❌ MEDIUM — string interpolation in executeScript
browser.scripting.executeScript({ func: new Function(userCode) });

// ✅ BETTER — only execute fixed, static function references
browser.scripting.executeScript({ func: myStaticFunction });
```

---

## OWASP Top 10 Mapping

| OWASP Category                | WebExtension Risk                          | Severity |
| ----------------------------- | ------------------------------------------ | -------- |
| A01 Broken Access Control     | No sender validation in `onMessage`        | CRITICAL |
| A01 Broken Access Control     | Over-broad `externally_connectable`        | CRITICAL |
| A01 Broken Access Control     | Insecure URL navigation                    | HIGH     |
| A02 Data Exposure             | Content script leaking to page scope       | HIGH     |
| A03 Injection                 | DOM XSS via `innerHTML` with tab/page data | CRITICAL |
| A05 Security Misconfiguration | Over-broad `host_permissions`              | HIGH     |
| A05 Security Misconfiguration | Missing or weak CSP                        | MEDIUM   |
| A08 Software Integrity        | Dynamic `executeScript` with user input    | MEDIUM   |

## Quick Scan Commands

Run these grep patterns to find common vulnerabilities:

```bash
# C1: Unsanitized onMessage listeners (no sender.id check nearby)
grep -n 'onMessage.addListener' src/js/**/*.js

# C2: innerHTML assignments (review each one)
grep -n 'innerHTML\s*=' src/js/**/*.js src/popup-view/**/*.js

# H1: Host permission scope
grep -n 'host_permissions' src/manifest.json

# H3: tabs.update with dynamic URL
grep -n 'tabs.update' src/js/**/*.js

# M2: Hardcoded secrets pattern
grep -rn 'api[_-]key\|secret\|token\|password' src/ --include='*.js'

# M3: Dynamic eval/executeScript
grep -n 'eval\|executeScript\|new Function' src/js/**/*.js
```

## Emergency Response

If a CRITICAL vulnerability is found during review:

1. Emit `<!-- REVIEW_RESULT: FAIL severity=CRITICAL -->` immediately
2. Include the exact file path and line number in the report
3. Provide a specific, concrete fix recommendation
4. Do NOT merge until the finding is resolved and re-reviewed
