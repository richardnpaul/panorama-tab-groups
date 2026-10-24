# CI: GitHub Actions

> **When to use**: Running Playwright tests automatically on pull requests, merges to main, or on a schedule with GitHub Actions.

The complete workflows are separate files in [examples/github-actions/](examples/github-actions/). Open **only the one that matches the scenario** (see the Decision Guide); this page holds the rules every workflow follows, so none of them needs to be read to apply those rules.

## Quick Reference

```bash
npx playwright install --with-deps            # browsers + OS packages
npx playwright test --shard=1/4               # one of four shards
npx playwright test --reporter=github         # annotate the pull request with failures
npx playwright merge-reports ./blob-report    # merge the reports of the shards
```

## Rules Every Workflow Follows

| Rule                                                                                                                                                         | Why                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `permissions: contents: read` at the top of the workflow; widen it per job only when a job needs more                                                        | The token of a workflow gets broad rights by default                                                                            |
| Every `uses:` is a full commit SHA with the version as a comment: `uses: actions/checkout@<40 hex> # v7.0.1`                                                 | A tag can be moved to other code without notice (supply-chain risk); Dependabot's `github-actions` ecosystem keeps SHAs current |
| `actions/checkout` with `persist-credentials: false`                                                                                                         | The token is not left in `.git/config` for later steps to read                                                                  |
| `timeout-minutes` on every job                                                                                                                               | A stuck job otherwise runs for six hours                                                                                        |
| `concurrency` with `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`                                                                          | A new push replaces the run of a pull request; a run on `main` always finishes                                                  |
| Upload reports with `if: ${{ !cancelled() }}`, traces with `if: failure()`                                                                                   | `!cancelled()` uploads when tests fail but stops when the run is cancelled; `always()` keeps going after a cancel               |
| Never write `${{ inputs.x }}`, `${{ github.head_ref }}` or any other text someone else controls inside `run:`; pass it through `env:` and quote the variable | Otherwise that text becomes part of the shell script (injection)                                                                |
| Secrets go in `env:` of the one step that needs them, not of the whole job                                                                                   | Fewer steps can read them                                                                                                       |
| A supported Node line (the active LTS, currently 24, or `node-version-file: .nvmrc`), not an end-of-life one                                                 | Old Node versions stop getting fixes and tools drop them                                                                        |
| `retention-days` on artifacts (7 to 14 for reports)                                                                                                          | The default is 90 days                                                                                                          |
| Do not set `CI: true`                                                                                                                                        | GitHub sets it on every runner                                                                                                  |

## Patterns

| Scenario                                     | File                                                                                                                                                | Use when                                                        | Avoid when                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| Any project, first workflow                  | [playwright.yml](examples/github-actions/playwright.yml)                                                                                            | The default; install, test, upload report and traces            | The suite takes over ~10 minutes                               |
| Long suite                                   | [playwright-sharded.yml](examples/github-actions/playwright-sharded.yml)                                                                            | Over ~10 minutes: split over runners and merge the blob reports | Under 5 minutes (the setup per shard costs more than it saves) |
| Same setup in many workflows or repositories | [playwright-reusable.yml](examples/github-actions/playwright-reusable.yml) and [its caller](examples/github-actions/playwright-reusable-caller.yml) | Several workflows need the same job                             | One workflow                                                   |
| Same environment as local Docker             | [playwright-container.yml](examples/github-actions/playwright-container.yml)                                                                        | The runner's packages cause trouble                             | `ubuntu-latest` with `--with-deps` works (the usual case)      |
| Tests against a deployed environment         | [playwright-staging.yml](examples/github-actions/playwright-staging.yml)                                                                            | Credentials, approvals, scoped secrets                          | Only a local dev server is tested                              |
| Nightly full regression                      | [playwright-nightly.yml](examples/github-actions/playwright-nightly.yml)                                                                            | The full suite is too slow for every pull request               | It runs in under ~15 minutes                                   |

For the config the sharded pattern needs (`reporter: process.env.CI ? [['blob'], ['github']] : [['html']]`), see [parallel-and-sharding.md](parallel-and-sharding.md).

## Decision Guide

| Scenario                          | Approach                                           | Why                                             |
| --------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Small suite (< 5 min)             | One job, no sharding                               | The overhead of sharding exceeds the time saved |
| Medium suite (5-20 min)           | 2-4 shards                                         | Cuts wall-clock time by 60-75%                  |
| Large suite (20+ min)             | 4-8 shards and merged blob reports                 | Keeps pull-request feedback under 10 minutes    |
| Cross-browser on pull requests    | Chromium on pull requests; every browser on `main` | Three times fewer minutes on pull requests      |
| Staging or production smoke tests | A separate workflow with `environment:`            | Isolates secrets, allows approval gates         |
| Nightly full regression           | `schedule` and `workflow_dispatch`                 | Full coverage without blocking pull requests    |

## Pinning Actions to Commit SHAs

Find the SHA of a release, preferring a release that is at least two weeks old:

```bash
# A lightweight tag gives the commit; an annotated tag lists the commit on the line ending in ^{}
git ls-remote https://github.com/actions/checkout 'refs/tags/v7.0.1*'
```

Write it as `uses: actions/checkout@<SHA> # v7.0.1`. Let Dependabot move them:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    groups:
      github-actions:
        patterns: ['*']
```

Pin a container image the same way, by digest next to the tag (`image: name:tag@sha256:...`); `docker buildx imagetools inspect <image:tag>` prints the digest.

## Anti-Patterns

| Anti-pattern                          | Problem                                                   | Do this instead                                       |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| Version tags (`@v4`) for actions      | Mutable; supply-chain risk                                | Full commit SHA with the version in a comment         |
| No `permissions` block                | Broad default token rights                                | `permissions: contents: read`                         |
| `if: always()` on uploads             | Keeps running after the run is cancelled                  | `if: ${{ !cancelled() }}`                             |
| Untrusted text inside `run:`          | Script injection                                          | Pass through `env:`, quote the variable               |
| No `concurrency` group                | Duplicate runs on every push                              | Cancel in-progress runs of pull requests only         |
| `fail-fast: true` with shards         | One failure cancels the others and their results are lost | `fail-fast: false`                                    |
| Installing browsers without caching   | 60-90 seconds on every run                                | Cache `~/.cache/ms-playwright`, keyed on the lockfile |
| No `timeout-minutes`                  | A stuck job runs six hours                                | An explicit limit                                     |
| Uploading reports only on failure     | Nothing to look at when tests pass                        | `!cancelled()` for the report, `failure()` for traces |
| All browsers on every pull request    | Three times the cost for little gain                      | Chromium on pull requests, the rest on `main`         |
| Browser install without `--with-deps` | Missing OS libraries; the browser will not start          | `npx playwright install --with-deps`                  |
| Secrets in workflow files             | Leaks                                                     | GitHub Secrets and Environments                       |

## Troubleshooting

### Browser launch fails: "Missing dependencies"

**Cause**: The browsers came from the cache, but the OS packages live in system folders and were not cached.

**Fix**: Run `npx playwright install-deps` when the cache hit (the examples do).

### Tests pass locally but time out in CI

**Cause**: Runners have fewer cores and less memory than a development machine.

**Fix**: Fewer workers and longer timeouts in CI:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  workers: process.env.CI ? '50%' : undefined,
  use: {
    actionTimeout: process.env.CI ? 15_000 : 10_000,
    navigationTimeout: process.env.CI ? 30_000 : 15_000,
  },
});
```

If one setup step is flaky rather than everything being slow, look for a missing readiness wait: a test that counts or clicks before the page has finished starting is a race that only shows on slow runners.

### Sharded reports are incomplete: some shards missing from the merged report

**Cause**: The artifact names collide between shards, or the download step lacks `merge-multiple: true`.

**Fix**: A unique name per shard (`blob-report-${{ strategy.job-index }}`) and `pattern: blob-report-*` with `merge-multiple: true` in the download step, as in [playwright-sharded.yml](examples/github-actions/playwright-sharded.yml).

### `webServer` fails: "port 3000 already in use"

**Cause**: A process from an earlier step still holds the port.

**Fix**: `reuseExistingServer: false` in CI, and free the port first: `lsof -ti:3000 | xargs kill -9 2>/dev/null || true`.

### GitHub annotations do not appear on the pull request

**Cause**: The `github` reporter is not configured.

**Fix**:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'on-failure' }]],
});
```

## Related

- [ci/parallel-and-sharding.md](parallel-and-sharding.md) -- sharding strategies and blob report merging
- [ci/reporting-and-artifacts.md](reporting-and-artifacts.md) -- reporter configuration and artifact management
- [ci/docker-and-containers.md](docker-and-containers.md) -- container images for CI
- [ci/ci-gitlab.md](ci-gitlab.md) -- GitLab CI equivalent
- [ci/ci-other.md](ci-other.md) -- CircleCI, Azure DevOps, Jenkins
- [core/configuration.md](../core/configuration.md) -- CI-aware config settings
