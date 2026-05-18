# Baseline Pre-Fail Test Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire C1 honestly. Re-run the three baseline tests (`cli/offline`, `config/scope`, `plugin/loader`) on the current Linux Node 22 baseline, land the one empirically warranted fix (`plugin/loader` macOS-realpath symmetry), and document the audit outcome — without inventing fixes for tests that already pass.

**Architecture:** Each task block re-runs the target test FIRST to capture empirical behaviour, then either roots-causes the failure or records "no fix needed". The `plugin/loader` fix wraps the test's `home` through `realpath` once in `beforeEach` so every `join(home, ...)` expectation matches the canonical `rootDir` the loader returns (which is already symlink-resolved via `realpath(dir)` at `src/core/plugin/loader.ts:41`). No `os.platform()` branching is required: on Linux `realpath('/tmp/nuka-plugins-xxx')` is the identity transform; on macOS it canonicalises `/var/folders/...` → `/private/var/folders/...`. The asymmetry only exists on macOS, but the fix is platform-symmetric and a no-op on Linux. The `cli/offline` and `config/scope` failures cited in `2026-05-17-remaining-tasks.md` are stale — both pass on the 2026-05-18 Linux Node 22 baseline (captured below); no source change is shipped for them.

**Tech Stack:** TypeScript (strict), Vitest, GitHub Actions

---

## File Structure

```
test/core/plugin/loader.test.ts       # MODIFY — symmetric realpath in beforeEach
docs/plans/2026-05-17-remaining-tasks.md  # MODIFY — retire C1 row
docs/plans/2026-05-18-baseline-test-fixes.md  # this plan
```

No production source changes. The fix lives in the test file because `src/core/plugin/loader.ts:41` already returns a `realpath`-resolved `rootDir`; the expected side of the comparison in `loader.test.ts:56` was constructed without applying the same resolution, so both sides need to be canonical to make the equality platform-symmetric.

---

## Task 1.0 — Capture empirical baseline (REQUIRED FIRST STEP)

- [ ] Files
  - Modify: none (capture-only step)
  - Test: `test/cli/offline.test.ts`, `test/core/config/scope.test.ts`, `test/core/plugin/loader.test.ts`

- [ ] Steps
  1. Re-run each baseline test in isolation and capture exit code + pass/fail counts:
     ```bash
     npx vitest run test/cli/offline.test.ts --reporter=verbose 2>&1 | tail -20
     npx vitest run test/core/config/scope.test.ts --reporter=verbose 2>&1 | tail -25
     npx vitest run test/core/plugin/loader.test.ts --reporter=verbose 2>&1 | tail -25
     ```
  2. Record `node --version`, `npm --version`, `uname -srm` to a scratch note (`/tmp/baseline-2026-05-18.txt`; do not commit).
  3. Recorded **2026-05-18 Linux Node 22, Nuka commit 8d2a358** baseline:
     - `test/cli/offline.test.ts`: PASS 1/1 in 2.38s. The single test `does not exit immediately when config has zero providers (waits for input)` completes in 2034ms.
     - `test/core/config/scope.test.ts`: PASS 17/17 in 403ms (all `SCOPE_ORDER`, `extractLocked`, `deepMergeWithLock`, `loadScopedConfig`, `loadConfig backward compat` cases).
     - `test/core/plugin/loader.test.ts`: PASS 10/10 in 539ms (the YAML portability warning emits to stderr as expected and is not a failure).
  4. Decision gate:
     - If `plugin/loader.test.ts` PASSES on this platform → still execute Task 1.2 (the fix is platform-symmetric; landing it on Linux costs nothing and unblocks macOS CI later).
     - If `cli/offline.test.ts` or `config/scope.test.ts` FAILS → escalate: append a new Task 1.3a / 1.4a block with the captured failure output before writing any fix. Do not paper over an actual failure.
     - If everything passes (current state) → proceed to Task 1.1.

---

## Task 1.1 — Root-cause the `plugin/loader` macOS divergence

- [ ] Files
  - Read: `src/core/plugin/loader.ts` (look for `realpath(dir)` call — confirmed at line 41)
  - Read: `test/core/plugin/loader.test.ts` (look for `expect(result[0].rootDir).toBe(join(home, '.nuka', 'plugins', 'good'))` — confirmed at line 56)

- [ ] Steps
  1. Confirm the asymmetry in the source:
     - `src/core/plugin/loader.ts:34-46` runs `await realpath(dir)` to follow symlinks (needed because `activateVersion` creates symlinks pointing to versioned cache dirs). The returned `LoadedPlugin.rootDir` is therefore always a canonical, symlink-resolved path.
     - `test/core/plugin/loader.test.ts:56` constructs the expected path with `join(home, '.nuka', 'plugins', 'good')` where `home` comes from `mkdtemp(join(os.tmpdir(), 'nuka-plugins-'))`. On Linux `os.tmpdir()` returns `/tmp` (already canonical). On macOS `os.tmpdir()` returns `/var/folders/...` and `realpath('/var/folders/...')` resolves to `/private/var/folders/...` because `/var` is a symlink to `/private/var`. The two sides of the equality diverge by the `/private` prefix on macOS only.
  2. Confirm no other equality site shares the trap:
     ```bash
     grep -n "toBe(join(home" test/core/plugin/loader.test.ts
     ```
     Expected: exactly one hit (line 56). The other assertions in the file compare `manifest.name` / counts / booleans, not paths.
  3. Record the chosen fix: resolve `home` through `realpath` once in `beforeEach` so every expected-path construction lives on the canonical side. Platform-symmetric: on Linux `realpath('/tmp/nuka-plugins-xxx')` is a no-op.

---

## Task 1.2 — Apply the symmetric-realpath fix

- [ ] Files
  - Modify: `test/core/plugin/loader.test.ts`
  - Test: `test/core/plugin/loader.test.ts` (re-run to confirm green)

- [ ] Steps
  1. Update the `node:fs/promises` import at the top of `test/core/plugin/loader.test.ts` to include `realpath`. Replace the existing import line with:
     ```ts
     import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
     ```
  2. Replace the `beforeEach` block so `home` is resolved through `realpath` once. The new body:
     ```ts
     beforeEach(async () => {
       const raw = await mkdtemp(join(os.tmpdir(), 'nuka-plugins-'))
       // On macOS `os.tmpdir()` returns `/var/folders/...` while
       // `realpath` resolves it to `/private/var/folders/...` (because
       // `/var` is a symlink to `/private/var`). `loadPlugins` calls
       // `realpath` on every directory it scans, so the returned
       // `rootDir` is always canonical. Resolving `home` once here keeps
       // every `join(home, ...)` assertion on the same canonical side
       // without sprinkling platform branches through individual tests.
       home = await realpath(raw)
     })
     ```
  3. Do not touch `afterEach`. `rm(home, { recursive: true, force: true })` works on the canonical path on every platform; the directory still exists under its canonical name.
  4. Re-run the file in isolation:
     ```bash
     npx vitest run test/core/plugin/loader.test.ts --reporter=verbose
     ```
     Expected: 10/10 pass on Linux (no regression — `realpath('/tmp/...')` is the identity). On macOS, the previously-failing `good plugin rootDir is absolute and points to the directory` test now passes because both sides of the equality are canonical.
  5. Run the adjacent plugin tests to confirm no regressions in the suite that shares the same `mkdtemp` pattern:
     ```bash
     npx vitest run test/core/plugin/ --reporter=verbose 2>&1 | tail -25
     ```
     Expected: every test under `test/core/plugin/` passes — the change is local to one `beforeEach`; sibling tests build their fixtures from the same `home` so the canonical-path treatment propagates without further edits.

---

## Task 1.3 — Verify `cli/offline` empirically (no source change unless reproduced)

- [ ] Files
  - Modify: none unless a real failure is captured this iteration
  - Test: `test/cli/offline.test.ts`

- [ ] Steps
  1. Re-run the test in isolation, capturing exit code and stderr noise:
     ```bash
     npx vitest run test/cli/offline.test.ts --reporter=verbose 2>&1 | tail -40
     ```
  2. Inspect: the test spawns `npx tsx src/cli.tsx` under a clean `HOME=<tmp>`, kills the process at +1.5s, and asserts the combined stderr+stdout matches `/offline mode/i` AND the exit code is not 2. The acceptance is "the CLI should print the offline banner and wait for input rather than hard-exit when no providers are configured".
  3. **2026-05-18 Linux Node 22 baseline (commit 8d2a358):** test passes 1/1 in 2.38s (banner printed; exit code matches the killed-by-SIGTERM path). No source change is warranted; record "no fix needed" in the implementation log.
  4. If the test FAILS on the executing platform → root-cause before fixing. Common modes to check:
     - Banner emitted to `stdout` vs `stderr` on the current platform (the test reads the merged stream, so this should not break it — verify by looking at which stream the captured text lives on).
     - The test timeout (1.5s before SIGTERM) too tight under CI load → bump to 3000ms and re-test. Bumping a test budget that already works on a dev box is acceptable only after the failure is captured; do not bump pre-emptively.
     - `process.env.HOME = home` not picked up by an upstream `homedir()` cache → investigate the offline-banner emit site:
       ```bash
       grep -rn "offline mode" src/
       ```
     Only write the fix once the failure mode is empirically captured.

---

## Task 1.4 — Verify `config/scope` empirically (no source change unless reproduced)

- [ ] Files
  - Modify: none unless a real failure is captured this iteration
  - Test: `test/core/config/scope.test.ts`

- [ ] Steps
  1. Re-run the test in isolation:
     ```bash
     npx vitest run test/core/config/scope.test.ts --reporter=verbose 2>&1 | tail -40
     ```
  2. The suite covers `SCOPE_ORDER` (1 case), `extractLocked` (3 cases), `deepMergeWithLock` (4 cases including locked-key drops), `loadScopedConfig` (8 cases — user→project override, enterprise lock, ancestor walk, per-scope sources record, `--scope project` filter), and `loadConfig backward compat` (1 case) — 17 assertions in total.
  3. **2026-05-18 Linux Node 22 baseline (commit 8d2a358):** test passes 17/17 in 403ms. The two `mkdtemp` consumers in this file (`home` and `cwd`) do not assert path equality; they only assert config-value equality (`active.providerId`, `lockedKeys.length`, etc.), so the macOS `/private/var` divergence does not surface here. No source change is warranted; record "no fix needed".
  4. If the test FAILS on the executing platform → root-cause. Likely vector: the ancestor-walk case (`project scope walks ancestor directories`) where `projectCwd: sub` is `cwd/sub/sub2`. If `loadScopedConfig` internally calls `realpath` on `projectCwd` while the loop walks ancestors via the un-resolved path, macOS would emit `/private/var/.../sub/sub2` whose ancestor walk diverges from the test's pre-`mkdir` tree. Confirm by:
     ```bash
     grep -n "realpath" src/core/config/load.ts
     ```
     If `realpath` is present in `loadScopedConfig`, apply the same `realpath`-in-beforeEach pattern from Task 1.2 to the `scope.test.ts` `beforeEach` (resolve `cwd` and `home` through `realpath` once). Do not modify the production source.

---

## Task 1.5 — Update remaining-tasks doc to reflect the audit outcome

- [ ] Files
  - Modify: `docs/plans/2026-05-17-remaining-tasks.md`
  - Test: none (documentation-only)

- [ ] Steps
  1. Open `docs/plans/2026-05-17-remaining-tasks.md`. Locate the C1 row (currently line 36):
     ```
     | C1 | 4 个 baseline pre-fail 测试逐个修（cli/offline、config/scope、plugin/loader macOS realpath、bundle-size 已修） | Turn 1 起一直 skip，未根因；bundle-size 已在 Turn 15 修 |
     ```
  2. Replace the C1 row with the audit outcome — exact substitution:
     ```
     | C1 | baseline 测试审计（2026-05-18 完成）：bundle-size 已修（Turn 15）；plugin/loader macOS realpath 已修（symmetric `realpath` in beforeEach，Linux 上 no-op）；cli/offline 与 config/scope 当前 Linux Node 22 均 green（17/17、1/1），无需修复，状态从 "pre-fail" 改为 "baseline-green"。详见 `docs/plans/2026-05-18-baseline-test-fixes.md` | DONE |
     ```
  3. No other changes to the doc.

---

## Task 1.6 — Final cross-suite regression sweep

- [ ] Files
  - Test: full `test/core/plugin/` + `test/cli/` + `test/core/config/`

- [ ] Steps
  1. Run the three affected directories as a group to surface any non-local fallout from the realpath change:
     ```bash
     npx vitest run test/core/plugin/ test/cli/ test/core/config/ --reporter=verbose 2>&1 | tail -40
     ```
  2. Confirm: all baseline tests green; no test outside the three named files broke.
  3. Run a wider smoke pass to catch indirect fallout (e.g. a shared `loader.ts` consumer):
     ```bash
     npx vitest run --reporter=default 2>&1 | tail -20
     ```
     Expected: total pass count unchanged from the pre-Task-1.2 baseline (plus 0 since the loader fix is a test-only change that only affects path equality on macOS).
  4. If everything is green, this plan is complete. The user-facing C1 baseline-status row has been honestly retired.

---

## Verification matrix

| Test file | Linux Node 22 (2026-05-18 baseline) | After fix | macOS expectation |
|---|---|---|---|
| `test/cli/offline.test.ts` | PASS 1/1, 2.38s | unchanged | Re-run on macOS to confirm; if PASS, no action; if FAIL, escalate per Task 1.3 |
| `test/core/config/scope.test.ts` | PASS 17/17, 403ms | unchanged | Re-run on macOS to confirm; if PASS, no action; if FAIL, apply realpath fix per Task 1.4 |
| `test/core/plugin/loader.test.ts` | PASS 10/10, 539ms | PASS 10/10 (symmetric realpath, Linux no-op) | Now PASS — `home` and `rootDir` both canonical |
| `test/build/bundle-size.test.ts` | PASS (already fixed Turn 15) | unchanged | n/a |

Honesty constraint: this plan ships only the one fix that is empirically warranted (`plugin/loader` symmetric realpath). The other two test files are not modified because Linux verification shows them green. If macOS verification later surfaces failures, follow the Task 1.3 / 1.4 escalation paths before adding fixes — never paper over an unreproduced failure.
