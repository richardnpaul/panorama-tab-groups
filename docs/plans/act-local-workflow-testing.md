# Implementation Plan: Running and Fixing the GitHub Workflows Locally with `act`

## Overview

Phase 6 of `hexagonal-core-and-mutation-testing.md` added a mutation workflow and made `npm test` the gate, but none of
the workflows can be run before a push: the first pull request is the first test. [`nektos/act`](https://github.com/nektos/act)
runs a workflow's jobs in Docker containers on the developer's machine, which catches broken syntax, wrong paths, missing
tools and slow steps before they cost a round trip to GitHub.

This plan has two parts, to be done in order and reviewed separately:

- **Part A, introduce `act`**: make it runnable inside the devcontainer, with the configuration, pinned versions and
  documentation that make a run repeatable. It changes tooling only; no workflow is changed.
- **Part B, test the workflows and fix their shortcomings**: run each workflow under `act`, record what it shows, fix
  what is wrong in the workflows, and finish with the one check `act` cannot make (a real run on GitHub).

## What `act` can and cannot tell us

| It can check                                                                          | It cannot check                                                            |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Workflow syntax, job graph, `needs`, `if` conditions                                  | Whether a cache saved by one run is found by the next (its cache is local) |
| That every step's command works in a runner-like container                            | Branch protection and required status checks (repository settings)         |
| Matrix expansion, environment, working directories                                    | `schedule` timing, permissions of the real `GITHUB_TOKEN`, rate limits     |
| Behaviour per event (`push`, `pull_request`, `workflow_dispatch`) given an event file | Exactly what `ubuntu-latest` contains (the act image is an approximation)  |
| Step durations, as a rough guide to `timeout-minutes`                                 | Marketplace actions that need GitHub's service (some artifact/cache calls) |

So `act` removes most of the risk, not all. Part B ends with a throwaway pull request for the rest.

## Requirements

- `act` runs inside the devcontainer, started by a documented command, with no change to how `npm`, Playwright or the
  VNC desktop already work there.
- Versions are pinned (the `act` binary with its checksum, the runner image by digest, any devcontainer feature by the
  digest in `devcontainer-lock.json`), the same way the rest of the toolchain is.
- A run of any workflow is one command, and the commands are listed in `TESTING.md`.
- Nothing from the host or the repository's secrets is needed; the workflows use none.
- The workflow files stay the source of truth: no copy of a workflow exists only for `act`.

## Decisions (made by the owner)

- **Docker: option A, Docker-in-Docker.** `actionlint` is added as well. Runs of `act` stay user-started.
- **Workflow fixes confirmed for Phase B2:** the Node matrix moves to Node 26 (see the note on it below); `node.js.yml` gets a
  `permissions` block; action versions are made consistent; a `concurrency` group is added; `pre-commit.yml` runs once per
  pull request (push only on `main`); `node.js.yml` builds `dist` once. The claude-config mount change in
  `devcontainer.json` is the owner's and is kept as it is; Part A edits that file around it.
- **Node 26 note:** the matrix item read as "run on Node 26", so the matrix has one entry and `engines` becomes `>=26`.
  The devcontainer's Dockerfile installs Node 24 (`setup_24.x`), so local runs, `audit.yml`, `e2e.yml` and
  `pre-commit.yml` (all `node-version: '24'`) would differ from the gate. Step B2-N decides whether they all move to 26
  and the Dockerfile with them; the recommendation is yes, so the version tested is the version developed on.

## The decision as it was put

1. **How does the devcontainer get a Docker daemon?** `act` needs one, and the container has neither Docker nor
   `/var/run/docker.sock` now. This is the one real design choice, and it has a security side because this
   container is also where an AI agent runs shell commands.

   | Option                                                                                        | For                                                                                                                                    | Against                                                                                                                                                                                                             |
   | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **A. Docker-in-Docker** (`ghcr.io/devcontainers/features/docker-in-docker:2`)                 | Works the same on a laptop, a remote host and Codespaces; the daemon and its images live in the devcontainer, and no host path matters | The container must run `--privileged`; the runner images (about 1.5 GB) live in a volume and are pulled again on a new one; the existing `seccomp=unconfined` run argument already loosens it, so this adds to that |
   | **B. Docker-outside-of-Docker** (`ghcr.io/devcontainers/features/docker-outside-of-docker:1`) | No privileged mode; shares the host's image cache; fast                                                                                | Gives everything in the container control of the host's Docker (it can start any container, mount any host path): the widest option; needs a host Docker, so it fails on hosts without one                          |
   | **C. Do nothing**: keep `actionlint` only (static checks, see step 6)                         | No privilege change at all                                                                                                             | Finds syntax and typing mistakes only; nothing about whether the steps work                                                                                                                                         |

   **Chosen: A**, with `actionlint` (option C) added in any case since it costs nothing. Because A widens what
   code in the container can do, the plan keeps `act` runs user-started (an `npm` script, never a hook or an agent
   default), and says so in `TESTING.md`. If the host is known to have no Docker and the privilege is not wanted, C
   alone is a valid outcome and Part B shrinks to reading the workflows against the checklist in Phase B2.

2. **Which runner image?** `catthehacker/ubuntu:act-24.04` (the medium image, close to `ubuntu-latest`, which is Ubuntu
   24.04) is the default recommendation. The full image is about ten times larger and only needed if a step lacks a
   tool the medium one omits. The tag and its availability are checked in step 3, and the image is then pinned by
   digest.

## Affected Files

- `.devcontainer/devcontainer.json` — the Docker feature, a named volume for its storage, `privileged` if A is chosen.
- `.devcontainer/Dockerfile` — install of the pinned `act` binary, checksum-verified.
- `.devcontainer/devcontainer-lock.json` — the digest of the Docker feature (the file is empty now).
- `.actrc` (new) — runner image mapping, container architecture, artifact server path.
- `.github/act/events/` (new) — event payloads (`pull_request.json`, `push-main.json`, `schedule.json`) so jobs that
  test `github.event_name` behave as on GitHub.
- `package.json` — scripts that wrap the commands (`act:list`, `act:run`), nothing more.
- `.gitignore` — the artifact directory `act` writes.
- `.pre-commit-config.yaml` — the `actionlint` hook (step 6).
- `TESTING.md`, `.github/copilot-instructions.md`, `CONTRIBUTION.md` — how to run the workflows locally and what the
  results do and do not mean.
- Part B only: the four files in `.github/workflows/`.

## Part A: Introduce `act`

### Phase A1: Make Docker available and `act` installable

1. **Add the Docker daemon to the devcontainer** (`.devcontainer/devcontainer.json`, `devcontainer-lock.json`)
   - Action: for option A add the `docker-in-docker:2` feature with `"moby": false` unless the base image needs it,
     `"privileged": true` at the top level, and a named volume `dind-var-lib-docker-${devcontainerId}` at
     `/var/lib/docker` so pulled images survive a rebuild. Run the "rebuild container" flow once to produce
     `devcontainer-lock.json` with the feature digest, and commit it.
   - Why: the lock file is what makes the feature version reproducible; leaving it empty (as now) leaves features
     floating.
   - Verify: `docker version` and `docker run --rm hello-world` work as `vscode` without `sudo`.
   - Risk: Low once the choice is made; the volume is the part to get right, or each rebuild re-pulls the image.

2. **Install `act`** (`.devcontainer/Dockerfile`)
   - Action: download a pinned release tarball of `act` for linux/amd64 with `curl`, verify its published SHA-256
     (stored in the Dockerfile as an `ARG`), and place the binary in `/usr/local/bin`. Do not pipe the project's
     install script into a shell.
   - Why: a binary that can start containers is worth the same supply-chain care as the other tools; the Dockerfile
     already pins Playwright's version.
   - Verify: `act --version` prints the pinned version.

### Phase A2: Configure `act` for this repository

3. **Choose and pin the runner image** (`.actrc`)
   - Action: `docker pull catthehacker/ubuntu:act-24.04`, record its digest, and write
     `-P ubuntu-latest=catthehacker/ubuntu:act-24.04@sha256:<digest>`. Add
     `--container-architecture linux/amd64` (the dev host here is `x86_64`; this keeps an Apple-silicon host honest) and
     `--artifact-server-path /tmp/act-artifacts` (required for `actions/upload-artifact@v4`).
   - Verify: `act -l` lists the jobs of all four workflows without error.

4. **Write the event payloads** (`.github/act/events/*.json`)
   - Action: one file per event the workflows use: a `pull_request` (base `main`), a `push` to `main`, and a
     `schedule`. Keep them minimal; only the fields the workflows read are needed (`github.event_name` and `ref` for
     `mutation.yml`).
   - Why: `mutation.yml` chooses between the incremental and the full run by event name; without a payload `act`
     would run the wrong branch of it and the test would prove nothing.

5. **Wrap the commands** (`package.json`, `TESTING.md`)
   - Action: add only `act:list` (`act -l`) and `act:run` (`act`), and document the real invocations, for example
     `act pull_request -W .github/workflows/mutation.yml -e .github/act/events/pull_request.json`,
     `act push -W .github/workflows/node.js.yml`, and `act workflow_dispatch -W
.github/workflows/audit.yml`. The Node matrix is a single version, so there is nothing to narrow.
   - Why: short scripts for the two commands people forget, and the full commands in the doc so nothing is hidden.
   - Add `act`'s artifact directory to `.gitignore`.

### Phase A3: A cheap static check as well

6. **Add `actionlint`** (`.pre-commit-config.yaml`)
   - Action: add the `rhysd/actionlint` hook at a pinned `rev`, so every commit that touches a workflow is checked for
     syntax errors, unknown inputs, bad expressions and unquoted shell variables, with no Docker. Consider
     `zizmor` (static security audit of workflows: unpinned actions, over-broad permissions, template injection) as a
     second hook once the first findings are cleared.
   - Why: this is the cheapest and fastest of all the checks, and it protects the repository for people who never
     run `act`.
   - Verify: introduce a deliberate mistake into a copy of a workflow; the hook fails.

### Phase A4: Prove the setup

7. **Run the smallest workflow end to end** (`audit.yml` via `workflow_dispatch`)
   - Action: `act workflow_dispatch -W .github/workflows/audit.yml`. It needs only checkout, Node, `npm ci` and
     `npm audit`, so it shows whether Docker, the image, the network and the cache work before the large workflows.
   - Done when it passes, and a rebuild of the devcontainer followed by the same command works without re-pulling the
     image.

## Part B: Test the Workflows and Fix Their Shortcomings

Part B starts from the working setup of Part A and produces a results table in this file (one row per workflow: command,
result, time, what `act` could not check) and a list of fixes made.

### Phase B1: Run each workflow and record what happens

R1. **`node.js.yml`** — `act push -W .github/workflows/node.js.yml`. It runs `npm ci`, the
audit, the build and `npm test` (lint, `web-ext lint`, typecheck, suppression guard, unit tests with the coverage gate).
Expect it to take a few minutes; note the time per step.

R2. **`pre-commit.yml`** — `act push -W .github/workflows/pre-commit.yml`. It uses `actions/setup-python` and
`pre-commit/action`, which depend on a tool cache that the `act` image may lack; if it fails for that reason, record it
as an `act` limitation rather than a workflow fault and rely on the local `pre-commit run --all-files`, which passes.

R3. **`e2e.yml`** — `act push -W .github/workflows/e2e.yml`. It installs Chromium and Firefox with their system
packages, then runs the Playwright suite. It needs the container to allow what Chromium needs (the devcontainer already
passes `--shm-size=1g`; `act` needs the equivalent through `--container-options "--shm-size=1g"` or an `.actrc` line).
Compare the pass counts with the local run (59 passed, 9 skipped at the time of writing).

R4. **`mutation.yml`** — three runs: a `pull_request` event (restore step, incremental run), a `push` event (full run,
save step) and a second `pull_request` event after the push, to see the cache step find what the push saved. `act` has a
local cache server, so this shows the workflow's keys and paths are consistent even though it cannot show GitHub's
cache rules (the default-branch rule for pull requests).

R5. **`audit.yml`** — already proven in step 7.

### Phase B2: Check each workflow against this list, whatever `act` says

`act` shows what fails; this list is for what passes but is wrong. Each item is a suspected shortcoming found by reading
the workflows now, to be confirmed or dropped:

- **B2-N, Node version (decided: 26).** The matrix has one entry, Node 26, and `package.json` `engines` becomes `>=26`
  (it says `>=16.0.0` now, which the toolchain does not support). Also decide, with the owner, whether the other workflows
  and the devcontainer Dockerfile (Node 24) move to 26; recommended yes. Check that Node 26 is released and that every
  dependency, `setup-node` and `npm ci` work on it before changing anything, since `act` will show this directly.
- **No `permissions:` block in `node.js.yml`** (the other three have `contents: read`); add it (decided).
- **Action versions are inconsistent** (`checkout` at `@v4`, `@v6` and `@v6.0.2`; `setup-node` at `@v4` and `@v6`).
  Settle on one version of each (decided), and consider pinning by commit SHA (Dependabot's `github-actions` ecosystem, already
  configured, will keep SHAs current).
- **No `concurrency` group**, so a second push to a pull request does not cancel the first run; the mutation and E2E
  runs are the long ones. Add (decided) `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`
  to the pull-request-triggered workflows (not to the `main` and scheduled mutation run, whose cache save must finish).
- **`pre-commit.yml` runs on every push and every pull request**, so a branch with an open pull request is checked twice.
  Limit `push` to `main`, as the others do (decided).
- **`node.js.yml` builds twice**: `npm run build --if-present` runs `dist` and `web-ext build`, then `npm test` runs
  `dist` again inside `lint:webext`. Drop the separate `npm run build` step (decided): `npm test` already builds `dist` through `lint:webext`, and with one matrix entry there is no leg to choose.
- **`e2e.yml` has `timeout-minutes: 10`** against 2.8 minutes locally. Use the time `act` reports (CI machines are
  usually slower) to set it with margin, and keep the report upload running when the tests fail (`if: !cancelled()`, so it also stops when the run is cancelled).
- **`mutation.yml` caches under `reports/`**, which is ignored by git; check that `actions/cache/save` finds the file
  when the full run did not change it, and that a pull request with no source change does not fail for lack of one.
- **Required checks** (a repository setting) must be named after the final job names, so settle the names here first.

### Phase B3: Fix, re-run, and then verify on GitHub

8. **Fix** each confirmed shortcoming in the workflow files, one commit per theme, and re-run the affected workflow
   under `act` after each.
9. **Run `actionlint` over the result** (the hook from step 6) and clear its findings.
10. **Open a throwaway draft pull request** from a branch of this repository that touches one source file. This is the
    only check of GitHub-side behaviour: the cache restore on a pull request, the permissions, and the real timings.
    Record the results next to the `act` ones, and close the pull request.
11. **Set the required status checks** on `main` (a repository setting, done by the owner) to the job names settled in
    Phase B2, and record that this was done.

## Risks and Mitigations

- **Privilege**: option A runs the devcontainer privileged. Mitigation: it is the recommendation only after the
  decision above; `act` runs stay user-started; the alternative C needs none.
- **Image drift**: `catthehacker/ubuntu` is a community image and moves. Mitigation: pinned by digest, and Dependabot
  does not update it, so the digest is refreshed by hand with the other pins (noted in `CONTRIBUTION.md`).
- **False confidence**: a green `act` run is not a green GitHub run. Mitigation: the table at the top of this plan is
  repeated in `TESTING.md`, and Part B ends with the real pull request.
- **Slow first run**: pulling the image and the browsers takes some minutes. Mitigation: the Docker volume in step 1, and
  the Playwright browsers already live in a named volume.
- **Playwright in a nested container**: Chromium and Firefox may need more of the kernel's features than a nested
  container gives. Mitigation: R3 is allowed to end as "cannot run under `act`", in which case the E2E workflow is
  checked by `actionlint` and the draft pull request only, and that is recorded rather than worked around.

## Result

Written in two sittings. The first, from the devcontainer as it was (no Docker daemon, no `act`), put every file of
Part A in place. After the owner rebuilt the devcontainer (Docker 29.9.2, act 0.2.89), all five workflows were run
under `act`; the results are below.

### Part A

- **Docker (option A).** `.devcontainer/devcontainer.json` adds `ghcr.io/devcontainers/features/docker-in-docker:4`
  with `"moby": false` (Docker CE) and states `"privileged": true`. The plan named major version 2; the feature is at
  4 now (4.1.3), and it declares `privileged` and the `dind-var-lib-docker-${devcontainerId}` volume (plus one for
  containerd) itself, so the devcontainer does not repeat the mount; `privileged` is written out anyway so the change
  of privilege is visible in the file. The owner's claude-config mount change is untouched.
  `.devcontainer/devcontainer-lock.json` was written by `@devcontainers/cli upgrade` (0.89.0) and pins the feature by
  digest (`sha256:fae40f3c…`).
- **`act`.** `.devcontainer/Dockerfile` downloads act 0.2.89 for linux/amd64, checks its SHA-256 from the release's
  `checksums.txt` (`0191d6f1…`) and puts it in `/usr/local/bin`. The same download and check were run here, and that
  binary's `act -l` lists the jobs of all five workflows (it warns that there is no Docker connection, and needs none
  to list).
- **`.actrc`.** `catthehacker/ubuntu:act-24.04` pinned by the digest the registry reports today (`sha256:c58e2b36…`),
  `--container-architecture linux/amd64`, `--container-options --shm-size=1g` (Chromium in R3) and
  `--artifact-server-path /tmp/act-artifacts`. The artifact path is outside the repository, so it needs no
  `.gitignore` entry (and no ignore-file entry, which the suppression guard would refuse).
- **Events.** `.github/act/events/{pull_request,push-main,schedule}.json`.
- **Commands.** `npm run act:list` and `npm run act:run`; `TESTING.md` has the full commands, the event files, the
  table of what `act` can and cannot check, and the note that `act` is only ever started by hand because the container
  is privileged. `CONTRIBUTION.md` lists how each hand-pinned tool is refreshed.
- **`actionlint`** (`rhysd/actionlint` v1.7.12) is a pre-commit hook. `pre-commit run --all-files` (pre-commit
  4.6.2, which fetched Go for the hook itself) passes, and a broken copy of `audit.yml` (an unknown input, a
  duplicated key, an unknown context property) failed the hook. `zizmor` was not added.
- **Phase A4: done.** `act workflow_dispatch -W .github/workflows/audit.yml` passed in 57 s on a cold start (it pulled
  the pinned image, 2.3 GB, once). Node 26.12.1 was installed by `setup-node`, `npm ci` added 812 packages and the
  audit found 0 vulnerabilities. The image sits in the Docker volume of the feature and the toolcache in the
  `act-toolcache` volume. After a second rebuild, from the Node 26 Dockerfile (`node --version` gives v26.12.1), the same command took 7 s and pulled nothing: the pinned image survived in the Docker volume.

### Part B

| Workflow         | Command (see `TESTING.md`)                                                          | Result under `act`                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit.yml`      | `act workflow_dispatch -W .github/workflows/audit.yml`                              | Passed, 57 s (cold, including the image pull)                                                                                                                                     |
| `node.js.yml`    | `act push -W .github/workflows/node.js.yml -e .github/act/events/push-main.json`    | Passed, 33 s: `npm ci` 3 s, audit 1 s, `npm test` 26 s (109 files, 2,723 tests, 100% coverage) on Node 26.12.1                                                                    |
| `pre-commit.yml` | `act push -W .github/workflows/pre-commit.yml -e .github/act/events/push-main.json` | Passed, 93 s: Python setup 7 s, `pip install pre-commit` 9 s, hooks 29 s (including `actionlint`). The tool-cache worry of R2 did not materialise                                 |
| `e2e.yml`        | `act push -W .github/workflows/e2e.yml -e .github/act/events/push-main.json`        | Passed, 253 s: browsers installed in 30 s, 64 passed and 8 skipped (same as local), 3 m 25 s of tests. Chromium and Firefox both ran in the nested container with `--shm-size=1g` |
| `mutation.yml`   | `act pull_request …/pull_request.json`                                              | Passed, 416 s: the cache restore found nothing, all 6,128 mutants ran (5 m 54 s), score 100%                                                                                      |
| `mutation.yml`   | `act push …/push-main.json`                                                         | Passed, 356 s: the full run (5 m 47 s), then "Keep the incremental report" saved the file                                                                                         |
| `mutation.yml`   | `act pull_request …/pull_request.json` again                                        | Passed, 43 s: `cache-hit=true`, "using incremental report with 6128 mutant(s)", the run itself 34 s. So the keys and the path are consistent                                      |

What `act` did not show: the GitHub-side rules for a cache (a pull request reads caches of its base branch and its own),
the permissions of the real token, and real timings. The Dockerfile's `setup_26.x` install was built in the second rebuild and works.

B2, each item:

- **B2-N, Node 26: done.** All five workflows use Node 26 (`audit`, `e2e`, `mutation` and `pre-commit` moved from 24
  on the owner's decision, `node.js.yml` is a single-entry matrix), `engines` is `>=26`, and the Dockerfile installs
  `setup_26.x` (NodeSource publishes 26.12.1 there). `npm ci`, the audit, `npm test`, the E2E suite and the mutation
  runs all passed on 26.12.1 under `act`. Node 26 is released but was not yet an LTS line on 2026-10-23 (the Node
  index lists it with no LTS name), which matches the intent of testing the line that will become the next LTS.
- **`permissions`** `contents: read` in `node.js.yml`: done.
- **Action versions: updated and pinned by commit SHA** (a second pass, at the owner's request). Each action is at
  the newest release at least 14 days old, with the commit SHA in `uses:` and the version as a trailing comment, which
  Dependabot reads and keeps current: `checkout` v7.0.1, `setup-node` v7.1.0, `setup-python` v7.0.0, `cache/*` v6.1.0,
  `upload-artifact` v7.0.2 and `pre-commit/action` v3.0.1 (the latest; the action is in maintenance only). The
  `rev` of both hook repositories in `.pre-commit-config.yaml` is a commit too (`# frozen: v6.0.0` and
  `# frozen: v1.7.12`, the convention of `pre-commit autoupdate --freeze`), and so is the base image of the
  devcontainer (`@sha256:…`). Dependabot gained the `pre-commit` and `docker` (for `.devcontainer`) ecosystems, and
  groups the action updates into one pull request. Every workflow was run again under `act` with the new majors
  (see "Second pass" below).
- **`concurrency`:** `node.js.yml`, `e2e.yml`, `pre-commit.yml` and `mutation.yml` group by workflow and ref and
  cancel only on `pull_request`, so a run on `main` (and the full mutation run whose report the cache keeps) always
  finishes.
- **`pre-commit.yml`** runs on pushes to `main` and on pull requests: done.
- **`node.js.yml` builds once:** the separate `npm run build --if-present` step is gone (`npm test` builds `dist` for
  `web-ext lint`).
- **`e2e.yml` `timeout-minutes`:** 20. `act` took 4 m 13 s in all (3 m 25 s of tests, 30 s for the browsers), so there
  is room for a slower machine and the two retries CI allows. Provisional until a real run on GitHub.
- **`mutation.yml` cache: confirmed under `act`.** A pull request with no cache runs everything (about 6 minutes) and
  does not fail; the full run saves `reports/stryker-incremental.json`; the next pull request run restores it and takes
  34 s. The reports folder is ignored by git, and the save still found the file. A save under a key that already
  exists (a re-run of the same commit) is reported by `actions/cache/save` as a warning, not a failure (from the
  documentation, not tried). Whether GitHub lets a pull request read the cache of a push to `main` is its own rule
  and still needs the draft pull request.
- **Required checks:** the job names are `build (26.x)` (Node.js CI), `pre-commit`, `mutation` and `e2e`.

### Second pass: pinned actions and the new majors

All five workflows were run again under `act` with the pinned actions at their new majors (checkout 7, setup-node 7,
setup-python 7, cache 6, upload-artifact 7). Audit (25 s), Node.js CI (30 s) and pre-commit (64 s) passed at once.
E2E and mutation passed on every step except the artifact upload, which has two findings:

- **`act` cannot run `upload-artifact` v7.** Its artifact server rejects a field the new version sends (`unknown
field "mime_type"`) and the step fails after five retries (about 90 s). It is a limit of `act` 0.2.89, the latest
  release, not a fault of the workflow. The two upload steps now skip under `act` (`if: ${{ !cancelled() && !env.ACT }}`,
  with a comment); `act` sets `ACT`, and on GitHub the condition is the same as before.
- **A flaky E2E test, seen once.** In the first of those runs `group-switching` ("activating a tab of another group
  …") failed once with "The second group got no native group" and passed on the retry that CI allows (`retries: 2`).
  It waits at most 5 s for the background to give a group a native group, and the run overlapped with other work in
  the same container. It had not failed in about a dozen earlier runs. Left as it is; if it shows up on GitHub, the
  wait should be longer or the step should wait for the event itself.
- **A second flaky test, seen on GitHub: `tab-groups-view`, "Tab Search filters tabs correctly"** (Chromium; it passed
  on the retry). Cause: its setup waited for `#newGroup`, which is in the static HTML, then counted `.group` and clicked
  the button, but the view attaches the button's handler and reads the groups during start-up and only then sets
  `body.view-ready`. On a slow runner the click came first and did nothing, so no group appeared. It failed 2 of 36 runs
  locally with retries off. The setup now waits for `body.view-ready` first, as the other specs do: 90 of 90 passes with
  retries off, and the Firefox runs pass. The other specs that count groups were checked and already wait.

After the change: E2E 64 passed and 8 skipped, job green (4 m 8 s); mutation pull request with a restored cache 43 s,
score 100%, job green. The full mutation run (push) also saved its report with `actions/cache/save` v6.

### Not done, and needs the owner

1. Step 10, the throwaway draft pull request, which is what shows the cache restore on GitHub, the permissions and
   real timings.
2. Step 11, the required status checks on `main` (a repository setting), with the names above.

## Success Criteria

- [x] `act -l` works in a freshly rebuilt devcontainer; the Docker feature, the `act` binary and the runner image are
      each pinned, and the choice of Docker option is recorded here
- [x] `TESTING.md` documents the commands, the event files and the table of what `act` can and cannot check
- [x] `actionlint` runs as a hook and passes on all four workflows (five now, with `mutation.yml`)
- [x] Each workflow has a row in the results table, with the command, the outcome and the time
- [x] Every confirmed shortcoming from Phase B2 is fixed or has a recorded reason for being left
- [ ] A draft pull request has run the mutation, Node, pre-commit and E2E workflows on GitHub, and the cache restored
- [ ] The required status checks on `main` match the final job names
