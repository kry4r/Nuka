# E2E CI Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a minimal, deterministic GitHub Actions workflow (`.github/workflows/ci.yml`) that runs typecheck + vitest (full suite — no skip patterns, since the Plan-1 audit confirmed all baseline tests pass on Linux Node 22) + the bundle-size guard on every push and pull-request to `main`. Workflow runs only on `ubuntu-latest` initially; macOS is opt-in after Plan 1's `plugin/loader` symmetric-realpath fix is independently verified on a darwin runner.

**Architecture:** Single job, sequential steps. Steps cache `~/.npm` keyed by `package-lock.json`, install with `npm ci`, run `npm run typecheck` (which already runs both root + test tsconfig), then `npm test` (which runs `vitest run`), then explicitly assert the `dist/cli.js` bundle ceiling via the existing `test/build/bundle-size.test.ts` (already included in the `npm test` sweep, but we double-tap via a dedicated `node` check so the failure surface is unambiguous in CI logs). No new npm dependencies are introduced; the workflow uses only `actions/checkout@v4` and `actions/setup-node@v4`, both of which ship with GitHub Actions and do not affect `package.json`.

**Tech Stack:** TypeScript (strict), Vitest, GitHub Actions

---

## File Structure

```
.github/                            # CREATE (does not exist)
.github/workflows/                  # CREATE
.github/workflows/ci.yml            # CREATE — workflow definition
```

No source / test changes. Plan 1's `plugin/loader` test fix is a separate commit; this plan assumes Plan 1 has landed (so the full vitest suite is green on Linux at HEAD).

---

## Task 3.0 — Confirm the prerequisites match the workflow's assumptions

- [ ] Files
  - Read: `package.json`, `vitest.config.ts`, `test/build/bundle-size.test.ts`

- [ ] Steps
  1. Confirm `package.json` declares the scripts the workflow will call:
     ```bash
     grep -E '"(typecheck|test|build)":' package.json
     ```
     Expected hits:
     - `"build": "node scripts/build.mjs"`
     - `"typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.test.json"`
     - `"test": "vitest run"`
  2. Confirm `engines.node` is `>=18.0.0` and the dev dep `@types/node` is `^22.0.0`. The workflow pins Node `22.x` to match the local development baseline (Plan 1's empirical baseline ran on Node 22).
  3. Confirm `test/build/bundle-size.test.ts` runs `npm run build` itself inside `beforeAll`, so the workflow does NOT need a separate `npm run build` step before `npm test` — the bundle-size test forks the build. Validate with:
     ```bash
     grep -n "npm.*run.*build" test/build/bundle-size.test.ts
     ```
     Expected: `spawnSync('npm', ['run', 'build'], ...)` at the top of `beforeAll`.
  4. Note: `vitest.config.ts` uses `pool: 'forks'` with `maxForks: 4`. GitHub Actions `ubuntu-latest` runners have 2 vCPUs / 4 cores, so the cap is safe — no override needed.

---

## Task 3.1 — Create `.github/workflows/` directory

- [ ] Files
  - Create: `.github/workflows/` (directory)

- [ ] Steps
  1. Confirm the directory does not exist:
     ```bash
     test ! -d .github && echo "missing" || echo "exists"
     ```
     Expected: `missing`.
  2. Create the directory:
     ```bash
     mkdir -p .github/workflows
     ```
  3. Verify creation:
     ```bash
     test -d .github/workflows && echo OK
     ```

---

## Task 3.2 — Write the CI workflow YAML

- [ ] Files
  - Create: `.github/workflows/ci.yml`

- [ ] Steps
  1. Write the file with this exact content:
     ```yaml
     # GitHub Actions CI for Nuka.
     #
     # Single job, ubuntu-latest, Node 22. Steps:
     #   1. checkout
     #   2. setup-node + npm cache (keyed on package-lock.json)
     #   3. npm ci
     #   4. npx tsc --noEmit (root + test tsconfig, via the `typecheck` script)
     #   5. npx vitest run --reporter=verbose (full suite — Plan 1 confirmed the
     #      three former "baseline pre-fail" tests pass on Linux Node 22, so
     #      no `--exclude` patterns are necessary)
     #   6. dedicated bundle-size assertion — the test/build/bundle-size.test.ts
     #      already runs `npm run build` and asserts dist/cli.js <= 720 KB,
     #      but we re-check with a tiny inline node snippet so CI logs
     #      surface a clean "BUNDLE OK <bytes>" line and the ceiling
     #      breach is easy to grep.
     #
     # macOS / Windows are intentionally NOT in the matrix yet. Plan 1's
     # plugin/loader realpath fix is platform-symmetric on Linux but the
     # darwin verification is independent — add `macos-latest` to the matrix
     # only after a manual macOS run confirms 0 regressions.

     name: ci

     on:
       push:
         branches: [main]
       pull_request:
         branches: [main]

     concurrency:
       group: ci-${{ github.workflow }}-${{ github.ref }}
       cancel-in-progress: true

     permissions:
       contents: read

     jobs:
       check:
         name: typecheck + test + bundle-size
         runs-on: ubuntu-latest
         timeout-minutes: 15

         steps:
           - name: Checkout
             uses: actions/checkout@v4

           - name: Setup Node 22
             uses: actions/setup-node@v4
             with:
               node-version: '22'
               cache: 'npm'
               cache-dependency-path: package-lock.json

           - name: Install dependencies
             run: npm ci

           - name: Typecheck (root + test tsconfig)
             run: npm run typecheck

           - name: Vitest (full suite, verbose)
             run: npx vitest run --reporter=verbose
             env:
               # Skip the persistent recent-files write so the runner's
               # ephemeral $HOME stays clean (and recent-files-related tests
               # exercise the in-memory tracker path).
               NUKA_RECENT_FILES_NO_PERSIST: '1'

           - name: Bundle-size guard (explicit assertion in CI log)
             run: |
               node --input-type=module -e "
               import { statSync } from 'node:fs';
               import { join } from 'node:path';
               const CEILING = 720 * 1024;
               const cliJs = join(process.cwd(), 'dist', 'cli.js');
               const size = statSync(cliJs).size;
               if (size > CEILING) {
                 console.error('BUNDLE FAIL ' + size + ' > ' + CEILING + ' bytes');
                 process.exit(1);
               }
               console.log('BUNDLE OK ' + size + ' / ' + CEILING + ' bytes');
               "
     ```
  2. Save the file. Confirm with:
     ```bash
     test -f .github/workflows/ci.yml && wc -l .github/workflows/ci.yml
     ```
     Expected: file exists; ~75 lines.

---

## Task 3.3 — Lint the YAML structure

- [ ] Files
  - Read: `.github/workflows/ci.yml`

- [ ] Steps
  1. Validate YAML syntax with the `yaml` package (already a dependency of the repo):
     ```bash
     node --input-type=module -e "
     import { readFileSync } from 'node:fs';
     import yaml from 'yaml';
     const doc = yaml.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
     if (typeof doc !== 'object' || doc === null) throw new Error('not an object');
     if (doc.name !== 'ci') throw new Error('name mismatch');
     if (!doc.jobs || !doc.jobs.check) throw new Error('missing jobs.check');
     if (doc.jobs.check['runs-on'] !== 'ubuntu-latest') throw new Error('runs-on mismatch');
     const steps = doc.jobs.check.steps;
     if (!Array.isArray(steps) || steps.length !== 6) throw new Error('expected 6 steps, got ' + (steps && steps.length));
     console.log('YAML OK — ' + steps.length + ' steps, runs-on=' + doc.jobs.check['runs-on']);
     "
     ```
     Expected: `YAML OK — 6 steps, runs-on=ubuntu-latest`.
  2. Confirm step names are stable (used in branch-protection rules):
     ```bash
     node --input-type=module -e "
     import { readFileSync } from 'node:fs';
     import yaml from 'yaml';
     const doc = yaml.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
     const names = doc.jobs.check.steps.map(s => s.name);
     const expected = ['Checkout', 'Setup Node 22', 'Install dependencies', 'Typecheck (root + test tsconfig)', 'Vitest (full suite, verbose)', 'Bundle-size guard (explicit assertion in CI log)'];
     for (let i = 0; i < expected.length; i++) {
       if (names[i] !== expected[i]) throw new Error('step ' + i + ': expected ' + expected[i] + ', got ' + names[i]);
     }
     console.log('STEP NAMES OK');
     "
     ```
     Expected: `STEP NAMES OK`.

---

## Task 3.4 — Local dry-run of the same commands the workflow runs

- [ ] Files
  - Test: `package.json` scripts + `npx vitest run`

- [ ] Steps
  1. Replicate the workflow steps locally (skip `npm ci` if `node_modules` is already populated and `package-lock.json` is current — the CI's `npm ci` is a clean-install variant, but locally `npm install --no-save --no-audit --no-fund` is sufficient for verification):
     ```bash
     npm run typecheck 2>&1 | tail -5
     ```
     Expected: exit 0, no output (tsc emits nothing on success).
  2. Run the full vitest suite:
     ```bash
     NUKA_RECENT_FILES_NO_PERSIST=1 npx vitest run --reporter=verbose 2>&1 | tail -10
     ```
     Expected: all test files PASS, `Test Files X passed (X)`.
  3. Re-check the bundle-size guard explicitly:
     ```bash
     test -f dist/cli.js && \
       node --input-type=module -e "
       import { statSync } from 'node:fs';
       const size = statSync('dist/cli.js').size;
       const CEILING = 720 * 1024;
       console.log((size <= CEILING ? 'OK' : 'FAIL') + ' ' + size + ' / ' + CEILING);
       "
     ```
     Expected: `OK <bytes> / 737280`. (The vitest run above produced `dist/cli.js` via `test/build/bundle-size.test.ts`'s `beforeAll`.)
  4. If any of the three steps fail locally, the workflow will fail in CI for the same reason — fix locally first, then iterate.

---

## Task 3.5 — Commit the workflow

- [ ] Files
  - Add: `.github/workflows/ci.yml`

- [ ] Steps
  1. Stage the file:
     ```bash
     git add .github/workflows/ci.yml
     ```
  2. Commit (no `Co-Authored-By:` line, per repo convention):
     ```bash
     git commit -m "ci: add minimal Node 22 / ubuntu-latest GitHub Actions workflow"
     ```
  3. Push to a feature branch and open a PR. The PR itself becomes the first run of `ci.yml` — verify the run goes green before merging.

---

## Task 3.6 — Post-merge: enable required-status checks

- [ ] Files
  - Read: GitHub repo settings (Branch protection)

- [ ] Steps
  1. After the workflow has run successfully on `main` at least once, go to **Settings → Branches → Branch protection rules → main → Require status checks to pass before merging**.
  2. Add `typecheck + test + bundle-size` (the job name from the workflow) as a required status check. Step names are intentionally stable so this binding does not break if step content evolves.
  3. Confirm `Require branches to be up to date before merging` is checked so the lock-step against `main` HEAD is enforced.

---

## Task 3.7 — Future-work placeholders (do NOT land in this iter)

- [ ] Files
  - none (documentation-only — this section records intentional non-goals)

- [ ] Steps
  1. macOS runner — defer. Add `macos-latest` to a matrix only after Plan 1's plugin/loader symmetric-realpath fix is independently verified on a darwin runner. Concrete next step: open a feature branch that adds `strategy.matrix.os: [ubuntu-latest, macos-latest]` to the existing job and runs the workflow once; merge only if 0 regressions.
  2. Windows runner — defer indefinitely. Several tests assume POSIX paths and `sh -c` (shell-hooks runner). Adding Windows is a separate, larger effort.
  3. Bun support — defer. The repo runs under Node only; adding `setup-bun` is unnecessary until a Bun-specific feature lands.
  4. Coverage upload — defer. `vitest --coverage` doubles wall-time; add only when a downstream consumer (Codecov etc.) is wired.
  5. Lint step — defer. `npm run lint` (eslint) is not in the workflow because the repo's strict-TS posture catches most defects at typecheck; add only if a recurring lint-only regression is observed.

---

## Verification matrix

| Step | Local check | CI check |
|---|---|---|
| YAML parses + structure | Task 3.3 `node ... yaml.parse` snippet | Action runner validates YAML before executing |
| Node version | `node -v` shows `v22.x` | `actions/setup-node@v4` with `node-version: '22'` |
| `npm ci` succeeds | `package-lock.json` resolves cleanly | Step `Install dependencies` |
| Typecheck passes | Task 3.4 step 1 | Step `Typecheck (root + test tsconfig)` |
| Vitest passes (full suite) | Task 3.4 step 2 | Step `Vitest (full suite, verbose)` |
| Bundle ≤ 720 KB | Task 3.4 step 3 | Step `Bundle-size guard (explicit assertion in CI log)` |
| Job name stability | n/a | `typecheck + test + bundle-size` — required status check |

Honesty constraint: every command in this plan is the exact command the workflow runs. If a command fails locally, do not paper it over with `continue-on-error`; fix the underlying issue or capture the failure as a separate Plan 1 / Plan 2 follow-up before merging the workflow.
