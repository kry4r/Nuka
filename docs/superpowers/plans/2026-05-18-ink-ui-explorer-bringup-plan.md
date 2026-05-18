# Plan — ink-ui-explorer bringup

**Date:** 2026-05-18
**Locked spec:** `docs/superpowers/specs/2026-05-02-ink-ui-explorer-design.md`
**Bringup spec:** `docs/superpowers/specs/2026-05-18-ink-ui-explorer-bringup-design.md`
**Test-first:** every implementation task is preceded by its failing test.
**Total estimated tasks:** ~38 across 8 milestones (M0..M7).
**Total estimated LOC:** ~3,400 prod + ~2,500 test = ~5,900.

---

## Conventions

- All file paths are repository-relative (`src/...`, `test/...`, `docs/...`).
- Each task lists **File / Reads / Signature / Test / Acceptance / LOC budget**.
- **LOC budget is a hard ceiling.** If a task exceeds its budget, split before landing.
- **Test-first** = the test file lands in the same PR as its implementation, but is committed *first* in the diff and asserted to fail before the implementation lands. Reviewers should see this as two consecutive commits per task.
- Reference the locked spec (`§4.1 L0 Capture`, `§4.2 L1 Invariants`, etc.) rather than restating its architecture in prose.
- **Bundle isolation is existential, not optional.** Current `dist/cli.js` = 736 KB (cap = 720 KB after M0). All explorer code lives under `src/core/testing/explorer/` and is loaded only via dynamic import from the `nuka explore` argv branch in `cli.tsx`. `scripts/build.mjs` gets a separate entrypoint emitting `dist/explorer.js`, mirroring `dist/test-runner.js` (`cli.tsx:185–202`).
- **Fixture filename normalization.** Bringup §3 G2 mentions `regression-bug-a.tsx`; locked spec §4.3 fixture glob is `**/*.fixtures.tsx`. We follow the glob: fixtures land at `test/ui-auto/fixtures/regression-bug-a.fixtures.tsx` and `regression-bug-b.fixtures.tsx`. Treat bringup G2 names as shorthand.
- **Judge cache form.** Locked spec §4.5 says `.ink-explorer/judge-cache.json` (file). We use `.ink-explorer/judge-cache/` (directory, sharded by component) to scale past 10k entries. Documented as a deliberate divergence in M4.T3.
- **Commit convention** (binding for every task commit):
  ```
  <type>(<scope>): <subject>            # all lowercase
  Author: --author="kry4r <Nidhogxt@outlook.com>"
  NO Co-Authored-By trailer.
  ```
  Allowed scopes: `testing/explorer`, `testing/explorer/capture`, `testing/explorer/sweep`, `testing/explorer/fuzz`, `testing/explorer/judge`, `testing/explorer/repair`, `testing/explorer/skill`, `tui/welcome`, `tui/messages`, `tui/hooks`, `tools/todo`, `agent/systemprompt`, `build`, `cli`, `docs/plan`.
- **CI gate per milestone:** `npm run typecheck` clean; `npm test` test count ≥ baseline + new tests, no regressions; `dist/cli.js ≤ 720 KB`; `dist/explorer.js` exists and is independent. Each milestone closes with a Two-Opus-reviewer gate task (see below).
- **Two-Opus-reviewer gate (process task, LOC 0):**
  - Inputs: phase diff, this plan, both specs.
  - CI subgates run first (typecheck, npm test, bundle ≤ 720 KB, `dist/explorer.js` present); failure blocks reviewer dispatch.
  - Two `opus` reviewer subagents dispatched **in parallel**; each returns `approve` or `changes-requested` with `file:line` citations.
  - Both approvals → next milestone may open.
  - Any `changes-requested` → targeted patch on the same branch → re-review (no new milestone opened).

---

## Milestone map

| Milestone | Maps to bringup §5 | Theme | Tasks |
|---|---|---|---|
| **M0** | (skeleton, new) | bundle isolation, types/stubs, `nuka explore` argv branch | 4 + gate |
| **M1** | P4 | `capture` verb + L0 grid/staticTap + 4 always-on invariants + Bug A/B fixtures (failing) | 5 + gate |
| **M2** | P5 | `sweep` verb + viewport matrix + fixture loader + remaining 2 invariants | 4 + gate |
| **M3** | P6 | `fuzz` verb (stdin + viewport resize + shrinker) | 3 + gate |
| **M4** | P7 | `judge` verb (Haiku quick → Opus precise + grid-hash dedup cache) | 4 + gate |
| **M5** | P8 | `repair` verb (subagent + verify + promote + dump reader) | 4 + gate |
| **M6** | P9 | Dogfood: Bug A repaired via `repair`; Bug B caught by `sweep`; minimal patches land; fixtures green | 4 + gate |
| **M7** | P10 | Skill packaging (`~/.claude/skills/ink-ui-explorer/SKILL.md`, helper CLIs, doc xref) | 3 + gate |

---

## Milestone M0 — Skeleton & bundle isolation (4 tasks + gate, ~620 LOC)

Goal: every dependency the M1 test-first commits need exists as a stub, and the bundle gate is mechanically enforced from the first commit. No verb is functional yet.

### Task M0.T1 — Explorer module skeleton (types + throwing stubs)

**Files (new):**
- `src/core/testing/explorer/types.ts` — `Viewport`, `Cell`, `Box`, `AnsiGrid`, `Violation`, `FailureRecord`, `FixtureDef`, `FixtureCase`, `JudgeVerdict` (from locked spec §4.1, §4.2, §6, §4.5).
- `src/core/testing/explorer/index.ts` — re-export entry; `runExploreCli(argv)` signature only.
- `src/core/testing/explorer/{capture,sweep,fuzz,judge,repair}.ts` — each exports a single async function that throws `Error('not implemented (M{1..5})')`.

**Reads:** locked spec §3.2, §4; `src/core/testing/cli-entry.ts` (template for verb dispatch).

**Signature:**
```ts
export async function runExploreCli(argv: string[]): Promise<number>
export async function capture(opts: CaptureOpts): Promise<CaptureResult>
export async function sweep(opts: SweepOpts):     Promise<SweepResult>
export async function fuzz(opts: FuzzOpts):       Promise<FuzzResult>
export async function judge(opts: JudgeOpts):     Promise<JudgeResult>
export async function repair(opts: RepairOpts):   Promise<RepairResult>
```

**Test:** `test/core/testing/explorer/skeleton.test.ts` — for each of the 5 verbs, assert `await verb({} as any)` rejects with `/not implemented/`. Asserts `runExploreCli([])` returns exit code `2` with a usage message.

**Acceptance:** test passes; `tsc --noEmit` clean over the new types; no production import of explorer/* outside the dynamic-load path.
**LOC:** ≈ 180 prod + 80 test = 260.

### Task M0.T2 — `nuka explore <verb>` argv branch with dynamic import

**File (modified):** `src/cli.tsx` (insert a new branch *after* the `--test-plan` block at line ~202, before `doctor`).

**Reads:** `src/cli.tsx:185–202` (`--test-plan` lazy-load pattern, including the dev-mode `import.meta.url → cli-entry.ts` fallback).

**Signature (cli.tsx behavior):**
```ts
if (argv[0] === 'explore') {
  ;(async () => {
    try {
      let mod: typeof import('./core/testing/explorer/index')
      const distUrl = new URL('./explorer.js', import.meta.url).href
      try { mod = await import(distUrl) }
      catch { mod = await import(new URL('./core/testing/explorer/index.ts', import.meta.url).href) }
      process.exit(await mod.runExploreCli(argv.slice(1)))
    } catch (err) {
      process.stderr.write(`explore failed: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })()
  return
}
```

**Test:** `test/cli/exploreBranch.test.ts` — spawn `node dist/cli.js explore --help` (built) → exits non-zero with usage; spawn `node dist/cli.js help` unaffected. Also: vitest assertion that `grep -E "from ['\"].*explorer" dist/cli.js` returns zero matches (static import surface is clean).

**Acceptance:** built `dist/cli.js` does not contain the string `core/testing/explorer/` (esbuild ignores `new URL(...)` dynamic imports); CLI dispatch works in dev mode.
**LOC:** ≈ 30 prod + 80 test = 110.

### Task M0.T3 — Separate esbuild entry → `dist/explorer.js`

**Files (modified):** `scripts/build.mjs`, `package.json` (if a script wrapper is needed).

**Reads:** `scripts/build.mjs` existing `test-runner.js` entry; existing `dist/test-runner.js` (472 KB) shape.

**Signature:** add a second esbuild invocation with `entryPoints: ['src/core/testing/explorer/index.ts']`, `outfile: 'dist/explorer.js'`, same externals as `test-runner.js`. Mark `react`, `ink`, `ink-testing-library`, `@anthropic-ai/sdk` external; bundle `string-width`, `strip-ansi`, `ansi-regex`.

**Test:** `test/build/explorerBundle.test.ts` — runs `npm run build`, asserts `fs.existsSync('dist/explorer.js')`, asserts `dist/cli.js` file size ≤ `720 * 1024`, asserts `dist/cli.js` does not statically reference `core/testing/explorer`.

**Acceptance:** all assertions hold; `dist/cli.js` size drops back under 720 KB (M0 net effect = skeleton compiles but does not enter cli bundle).
**LOC:** ≈ 40 prod + 80 test = 120.

### Task M0.T4 — `.ink-explorer/` gitignore + dir layout helper

**Files:**
- `.gitignore` (modified) — append `/.ink-explorer/`.
- `src/core/testing/explorer/common/tracingFs.ts` (new) — `ensureExplorerDir(root: string): { failures: string; resolved: string; captures: string; judgeCache: string; runs: string }`; first call creates the tree.

**Reads:** locked spec §3.3.

**Signature:**
```ts
export function ensureExplorerDir(root: string): ExplorerPaths
export function writeFailureDump(paths: ExplorerPaths, rec: FailureRecord): string
```

**Test:** `test/core/testing/explorer/tracingFs.test.ts` — invoke under a `tmpdir`; assert all 5 subdirs created; assert second call is idempotent; assert `writeFailureDump` round-trips a record.

**Acceptance:** tests green; `.gitignore` rule lands.
**LOC:** ≈ 70 prod + 60 test = 130.

### Task M0.G — Two-Opus-reviewer gate (M0)

Process task; LOC 0. CI subgates: typecheck + `npm test` + `dist/cli.js ≤ 720 KB` + `dist/explorer.js` exists. Dispatch two `opus` reviewer subagents in parallel with M0 diff + both specs. Block M1 until both approve.

---

## Milestone M1 — `capture` verb, L0/L1 core, Bug A/B fixtures (5 tasks + gate, ~1,100 LOC)

Goal: a developer can run `nuka explore capture <fixture> --viewport=80x24` and get an ASCII grid + JSON dump. The 4 always-on invariants run. The two regression fixtures exist and fail at HEAD.

### Task M1.T1 — `FakeStdout` + `renderWithViewport`

**Files (new):**
- `src/core/testing/explorer/L0/viewport.ts` — `class FakeStdout` per locked spec §4.1 (cols/rows/isTTY/liveBuffer/staticBuffer/write/clear/resize).
- `src/core/testing/explorer/L0/render.ts` — `renderWithViewport(node, viewport, opts?)` returning `InkRenderHandle` (`frames`, `lastFrame`, `staticWrites`, `grid`, `stdin`, `resize`, `unmount`).

**Reads:** locked spec §4.1; `src/tui/testing/harness.ts:25–43` (setRawMode shim, ink-testing default cols=100 fact); ink 6.8 `render({stdout, stderr, stdin, exitOnCtrlC, debug})` signature.

**Signature:** see locked spec §4.1.

**Test:** `test/core/testing/explorer/L0/render.test.ts` —
- mount `<Text>hi</Text>` at `{cols:40,rows:10}`; `lastFrame()` width respects 40.
- `resize(120, 20)` triggers a re-render with new cols.
- `unmount()` flushes pending writes.

**Acceptance:** 3 tests green; `FakeStdout` is the *only* stdout passed to `ink.render`; default ink-testing 100-col leak does not occur (verified by mounting at 40 cols and asserting no line >40).
**LOC:** ≈ 140 prod + 140 test = 280.

### Task M1.T2 — `AnsiGrid.parse` + `staticTap`

**Files (new):**
- `src/core/testing/explorer/L0/grid.ts` — `AnsiGrid.parse(ansi, viewport)`; cells, boxes, asciiView, sha256 hash.
- `src/core/testing/explorer/L0/staticTap.ts` — classifies Ink Static commits into `staticBuffer`; tap heuristic per locked spec §4.1.
- `src/core/testing/explorer/common/stringWidth.ts` — re-export `string-width` with documented wcwidth caveats.

**Reads:** locked spec §4.1 (Cell/Box/AnsiGrid shapes); `Messages.tsx:168, 184` (Static use site → tap must catch this exact pattern).

**Test:** `test/core/testing/explorer/L0/grid.test.ts` —
- ASCII grid of plain text matches `asciiView` byte-for-byte after stripping ANSI.
- A single box-drawing rectangle is detected with correct `(x,y,w,h)`.
- CJK glyph occupies 2 cells.
- `staticTap` segregates the prologue when `prologueGoesStatic` is true (mount a tiny `<Static>{...}</Static>` fixture).

**Acceptance:** 4 tests green; SHA-256 hash deterministic across runs.
**LOC:** ≈ 220 prod + 180 test = 400.

### Task M1.T3 — Four always-on L1 invariants

**Files (new):** `src/core/testing/explorer/L1/{noContentBeyondColumns,noBorderBleed,noStaticWrites,flexGrowBounded,index}.ts`.

**Reads:** locked spec §4.2 (only the first 4 of 6; `noOverlapBetweenZones` + `noLossyTruncation` are M2 because they need fixture metadata).

**Signature:**
```ts
type InvariantFn = (grid: AnsiGrid, ctx: InvariantCtx) => Violation[]
export const invariants: Record<string, InvariantFn>
export function runAll(grid: AnsiGrid, ctx: InvariantCtx): Violation[]
```

**Test:** `test/core/testing/explorer/L1/invariants.test.ts` — one truth-table case per invariant (passing + failing fixture). The failing case for `flexGrowBounded` reproduces "Welcome hero contentHeight uncapped" minimally (a single `<Box flexGrow={1}>` at `rows=100`).

**Acceptance:** 8 tests green (4 pass + 4 fail cases).
**LOC:** ≈ 180 prod + 160 test = 340.

### Task M1.T4 — `capture` verb wiring + CLI

**Files:**
- `src/core/testing/explorer/capture.ts` (replace stub) — load fixture, call `renderWithViewport`, parse grid, run L1, write to `.ink-explorer/captures/<id>.txt` + sibling `<id>.json`.
- `src/core/testing/explorer/index.ts` (modified) — `runExploreCli` dispatch for `capture` only.

**Reads:** locked spec §4.1, §5.

**Signature:**
```ts
export async function capture(opts: {
  fixturePath: string
  caseName?: string
  viewport?: Viewport
  cwd: string
  out: string
}): Promise<CaptureResult>
```

**Test:** `test/core/testing/explorer/capture.test.ts` — mount a trivial inline fixture, run `capture()`, assert `.ink-explorer/captures/<id>.txt` exists, asciiView matches; assert `runExploreCli(['capture', tmpFixturePath, '--viewport=40x10'])` exits 0.

**Acceptance:** 3 tests green; running `tsx src/cli.tsx explore capture <fixture>` prints the ASCII grid.
**LOC:** ≈ 130 prod + 110 test = 240.

### Task M1.T5 — Regression fixtures for Bug A and Bug B (failing at HEAD)

**Files (new):**
- `test/ui-auto/fixtures/regression-bug-a.fixtures.tsx` — Bug A is a prompt-surface bug, not a render bug. Fixture exercises **the surfaces named in bringup §2.1**: it imports `makeTodoWriteTool` from `src/core/tools/todoWrite.ts` and `buildSystemPrompt` from `src/core/agent/systemPrompt.ts`, asserts `description` contains the literal `"When NOT to use"` and that the assembled system prompt contains a `TodoWrite` usage section. Wrapped in the `FixtureDef` shape so the explorer can pick it up by glob; render side is a no-op `<Text>todo-tool-prompt-surface</Text>`.
- `test/ui-auto/fixtures/regression-bug-b.fixtures.tsx` — Bug B is a render bug. Fixture mounts a sequence: render Welcome → submit a no-op message (so `total > 0`) → open ModelPicker → call its `onSave` → assert post-close frame at `cols=79` has (B1) Welcome logo not in compact branch (probe `getLayoutMode` via exported helper or by string-contains the wide-branch logo line) AND (B2) Welcome prologue still in live area, i.e. `staticWrites()` does not contain the prologue marker. Anchors verbatim in a header comment: `Messages.tsx:168 prologueGoesStatic`, `useTerminalSize.ts:6,11`, `getLayoutMode(<80)→'compact'`.

**Reads:** bringup §2.1 + §2.2 (root-cause tables); locked spec §4.3 (fixture format); `src/tui/Welcome/layout.ts:17–20`; `src/tui/Messages/Messages.tsx:168`.

**Signature:** both files `export default ... satisfies Fixture`.

**Test:** the fixtures **are** the tests; they will fail today. Drive them via `vitest` in `test/ui-auto/runFixtures.test.ts` (new shim that imports each fixture and runs its `cases` through `renderWithViewport` + L1 + the fixture's own assertions). Mark these two cases with `expect.fail`-style guards (use `it.failing(...)`) so vitest exits green at HEAD while the fixtures stay red — the M6 fix flips them to `it(...)`.

**Acceptance:** both fixtures discoverable by glob `test/ui-auto/fixtures/**/*.fixtures.tsx`; both currently red without M6 patches; `npm test` exit 0 thanks to `it.failing` guard.
**LOC:** ≈ 220 fixture/test, 0 prod.

### Task M1.G — Two-Opus-reviewer gate (M1)

Process task; LOC 0. CI subgates as in M0.G. Reviewer focus: L0 fidelity vs. locked spec §4.1 (especially `staticTap` heuristic) and fixture format vs. §4.3.

---

## Milestone M2 — `sweep` verb + viewport matrix + final 2 invariants (4 tasks + gate, ~750 LOC)

Goal: `nuka explore sweep` runs every fixture × viewport, emits failure dumps under `.ink-explorer/failures/`.

### Task M2.T1 — Fixture loader + viewport matrix

**Files (new):**
- `src/core/testing/explorer/L2/fixtureLoader.ts` — glob discovery (`test/ui-auto/fixtures/**/*.fixtures.tsx`), dynamic import (use `tsx`-compatible URL import).
- `src/core/testing/explorer/L2/viewportMatrix.ts` — bringup §6 7-profile matrix (60×30, 70×30, 79×24, 100×30, 100×50, 120×30, 140×60). Allow per-fixture override.

**Reads:** locked spec §4.3 + bringup §6.

**Signature:**
```ts
export async function loadFixtures(rootGlob?: string): Promise<LoadedFixture[]>
export function resolveViewports(fixture: FixtureDef): Viewport[]
```

**Test:** `test/core/testing/explorer/L2/fixtureLoader.test.ts` —
- discovers both M1 regression fixtures.
- per-fixture viewport override is honored.
- the 7-profile default is returned otherwise.

**Acceptance:** 3 tests green.
**LOC:** ≈ 110 prod + 90 test = 200.

### Task M2.T2 — Remaining L1 invariants (`noOverlapBetweenZones`, `noLossyTruncation`)

**Files (new):** `src/core/testing/explorer/L1/{noOverlapBetweenZones,noLossyTruncation}.ts`; update `L1/index.ts`.

**Reads:** locked spec §4.2 (rows 5–6).

**Test:** `test/core/testing/explorer/L1/invariants.extra.test.ts` — pass + fail case for each. `noLossyTruncation` reproduces the "SlashCard `/fork` last-item drop" pattern minimally (a 3-item list rendered into 2 visible rows).

**Acceptance:** 4 tests green; `runAll` returns merged violations.
**LOC:** ≈ 140 prod + 120 test = 260.

### Task M2.T3 — `sweep` orchestrator

**Files (new):**
- `src/core/testing/explorer/L2/sweep.ts` — cartesian product loop per locked spec §4.3 step 1–6; emits `FailureRecord[]`; writes JSONL log to `.ink-explorer/runs/<ts>.jsonl`.
- `src/core/testing/explorer/common/failureDump.ts` — `writeFailureDump` markdown emitter per locked spec §6.

**Reads:** locked spec §4.3 + §6.

**Signature:**
```ts
export async function sweep(opts: {
  fixturesGlob?: string
  viewportsOverride?: Viewport[]
  cwd: string
  noJudge?: boolean   // judge wiring lands in M4; flag accepted now, ignored.
}): Promise<SweepResult>
```

**Test:** `test/core/testing/explorer/L2/sweep.test.ts` —
- Sweep finds Bug B fixture failing at `cols=60` and `cols=79` (B1) and at `cols=100` (B2); record contains both.
- A clean fixture produces zero failures.
- Failure dump markdown parseable (round-trip via the M5 `dumpReader` stub).

**Acceptance:** 3 tests green; `nuka explore sweep` exits non-zero when any failure recorded.
**LOC:** ≈ 180 prod + 110 test = 290.

### Task M2.T4 — `sweep` CLI plumbing + summary table

**Files (modified):** `src/core/testing/explorer/index.ts` (sweep dispatch); `src/core/testing/explorer/L2/reporter.ts` (new, ~60 LOC) for ASCII summary.

**Reads:** existing pretty-reporter style in `src/core/testing/cli-entry.ts`.

**Signature:** `runExploreCli(['sweep', '--fixtures=...', '--no-judge'])`.

**Test:** `test/cli/exploreSweep.test.ts` — invoke via `runExploreCli`; assert stdout contains `7 viewports`, exits 1 when failures present.

**Acceptance:** test green; summary table mirrors spec §5 example.
**LOC:** ≈ 80 prod + 60 test = 140.

### Task M2.G — Two-Opus-reviewer gate (M2)

Process task; LOC 0. Reviewer focus: viewport matrix matches bringup §6; failure dump format matches locked spec §6.

---

## Milestone M3 — `fuzz` verb (3 tasks + gate, ~620 LOC)

Goal: random keystroke + viewport-resize exploration with deterministic seed and PBT shrinker.

### Task M3.T1 — `stdinFuzzer` (charset-bounded RNG)

**File (new):** `src/core/testing/explorer/L3/stdinFuzzer.ts`.

**Reads:** locked spec §4.4 charset rules (no raw Ctrl-C); `src/core/testing/keystrokes.ts` for shared escape-sequence map.

**Signature:**
```ts
export class StdinFuzzer {
  constructor(seed: number)
  nextKey(): Keystroke
  shouldResize(p: number): boolean
  pickViewport(matrix: Viewport[]): Viewport
}
```

**Test:** `test/core/testing/explorer/L3/stdinFuzzer.test.ts` — same seed → identical 200-key sequence; charset excludes raw Ctrl-C; viewport-resize probability ≈ `p_resize ± 0.02` over 10k draws.

**Acceptance:** 3 tests green.
**LOC:** ≈ 120 prod + 90 test = 210.

### Task M3.T2 — PBT shrinker

**File (new):** `src/core/testing/explorer/L3/shrinker.ts`.

**Reads:** locked spec §4.4 step 3.

**Signature:** `shrink(sequence, repro, opts?) → MinimalSeq`. Strategy: binary-search prefix length, then per-step deletion.

**Test:** `test/core/testing/explorer/L3/shrinker.test.ts` — given a synthetic predicate that fails on any sequence containing the byte `x`, the shrinker reduces a 200-byte sequence to `[x]`.

**Acceptance:** 2 tests green; deterministic.
**LOC:** ≈ 100 prod + 80 test = 180.

### Task M3.T3 — `fuzz` verb orchestrator + CLI

**File (new):** `src/core/testing/explorer/fuzz.ts` (replace stub).

**Reads:** locked spec §4.4.

**Signature:** `fuzz({ target, seed, steps, pResize, cwd }) → FuzzResult`.

**Test:** `test/core/testing/explorer/fuzz.test.ts` —
- Same seed + same fixture → identical failure (or clean) outcome twice in a row.
- A fixture that crashes on the byte `q` is found within ≤ 50 steps; shrunk repro length is 1.

**Acceptance:** 2 tests green; CLI `nuka explore fuzz --target=<fixture> --seed=42 --steps=200` runs.
**LOC:** ≈ 140 prod + 90 test = 230.

### Task M3.G — Two-Opus-reviewer gate (M3)

Process task; LOC 0. Reviewer focus: determinism of seed; charset exclusions; shrinker correctness.

---

## Milestone M4 — `judge` verb (4 tasks + gate, ~720 LOC)

Goal: two-tier judge with grid-hash dedup cache, cost guards, and integration into `sweep`.

### Task M4.T1 — Anthropic client (no SDK dep)

**File (new):** `src/core/testing/explorer/L3_judge/client.ts`.

**Reads:** locked spec §4.5; existing provider HTTP shapes in `src/core/provider/` (do not reuse; explorer must be self-contained per spec §3.2).

**Signature:**
```ts
export async function callMessages(opts: {
  apiKey: string
  model: 'claude-haiku-4-5-20251001' | 'claude-opus-4-7'
  system: string
  user: string
  maxTokens: number
}): Promise<{ text: string; usage: { inTok: number; outTok: number } }>
```

**Test:** `test/core/testing/explorer/L3_judge/client.test.ts` — mock `fetch` (vitest `vi.stubGlobal`); verify URL = `/v1/messages`, headers include `x-api-key` + `anthropic-version`, returns parsed text. Failure modes: 429 → typed error; 500 → typed error.

**Acceptance:** 4 tests green; no `@anthropic-ai/sdk` import.
**LOC:** ≈ 110 prod + 110 test = 220.

### Task M4.T2 — Prompts (Haiku quick / Opus precise)

**File (new):** `src/core/testing/explorer/L3_judge/prompt.ts`.

**Reads:** locked spec §4.5 prompt requirements.

**Signature:** `buildHaikuPrompt(input) → {system,user}` and `buildOpusPrompt(input) → {system,user}`. Inputs: component name, fixture case, viewport, full asciiView, `mustContain`, `expectsHugContent`.

**Test:** `test/core/testing/explorer/L3_judge/prompt.test.ts` — golden-string assertions on key prompt fragments; assert asciiView is fenced; assert structural-only instruction line present.

**Acceptance:** 2 tests green; prompt byte size ≤ 6 KB at 200×50 grids.
**LOC:** ≈ 90 prod + 70 test = 160.

### Task M4.T3 — Grid-hash dedup cache (directory-sharded)

**File (new):** `src/core/testing/explorer/L3_judge/cache.ts`.

**Reads:** locked spec §4.5 cache key; **deliberate divergence:** store under `.ink-explorer/judge-cache/<componentHash[0..2]>/<fullHash>.json` (directory shard) rather than the single JSON file in locked spec §4.5. Document the divergence in the file header.

**Signature:**
```ts
export class JudgeCache {
  constructor(root: string)
  get(key: { gridHash: string; component: string; viewportKey: string }): JudgeVerdict | null
  put(key: ..., verdict: JudgeVerdict): void
}
```

**Test:** `test/core/testing/explorer/L3_judge/cache.test.ts` — put/get round-trip; cache miss on different viewport; survives process restart (reload from disk).

**Acceptance:** 3 tests green.
**LOC:** ≈ 90 prod + 80 test = 170.

### Task M4.T4 — `judge` verb dispatch + sweep integration + cost guards

**Files:**
- `src/core/testing/explorer/judge.ts` (replace stub) — two-tier flow per locked spec §4.5 diagram.
- `src/core/testing/explorer/L2/sweep.ts` (modified) — call `judge()` post-sweep unless `--no-judge`.
- env caps: `INK_EXPLORER_MAX_HAIKU=200`, `INK_EXPLORER_MAX_OPUS=20`.

**Reads:** locked spec §4.5.

**Test:** `test/core/testing/explorer/judge.test.ts` — with mocked client: Haiku "clean" → no Opus call, cache populated; Haiku "issues" → Opus call → FailureRecord emitted; budget cap exceeded → warning, no further calls.

**Acceptance:** 3 tests green; `nuka explore judge --re-judge` reruns ignoring cache.
**LOC:** ≈ 130 prod + 90 test = 220.

### Task M4.G — Two-Opus-reviewer gate (M4)

Process task; LOC 0. Reviewer focus: cost guard correctness; cache-key collision avoidance; documented divergence from locked spec on cache form.

---

## Milestone M5 — `repair` verb (4 tasks + gate, ~830 LOC)

Goal: one-command repair: dump → Opus subagent (read/edit tools) → in-process verify → promote to regression fixture.

### Task M5.T1 — `dumpReader` (FailureRecord round-trip)

**File (new):** `src/core/testing/explorer/L4_repair/dumpReader.ts`.

**Reads:** locked spec §6 dump format.

**Signature:** `readDump(path: string) → FailureRecord`.

**Test:** `test/core/testing/explorer/L4_repair/dumpReader.test.ts` — write via `writeFailureDump`, read back, deep-equal the in-memory record (modulo whitespace).

**Acceptance:** 1 test green; round-trip lossless on all fields enumerated in spec §6.
**LOC:** ≈ 100 prod + 70 test = 170.

### Task M5.T2 — `verify` (in-process re-mount + L0/L1)

**File (new):** `src/core/testing/explorer/L4_repair/verify.ts`.

**Reads:** locked spec §4.6 step 3; node module-cache invalidation pattern.

**Signature:**
```ts
export async function verify(opts: {
  fixturePath: string
  caseName: string
  viewport: Viewport
  cwd: string
}): Promise<{ clean: true } | { clean: false; violations: Violation[] }>
```
Implementation: clear `import.meta.cache`-equivalent entries for project source files modified since the verify session started, then re-`import` the fixture and re-run L0 + L1.

**Test:** `test/core/testing/explorer/L4_repair/verify.test.ts` — patch a fixture source on disk between two verify calls; assert second call reflects the new content.

**Acceptance:** 1 test green; verify never spawns a subprocess.
**LOC:** ≈ 140 prod + 90 test = 230.

### Task M5.T3 — `subagent` (Opus tool-loop with read/edit/verify)

**File (new):** `src/core/testing/explorer/L4_repair/subagent.ts`.

**Reads:** locked spec §4.6 step 2; `M4.T1` client.

**Signature:**
```ts
export async function runRepairSubagent(opts: {
  failure: FailureRecord
  cwd: string
  maxTurns?: number   // default 20
  timeoutMs?: number  // default 300000
}): Promise<{ status: 'verified' | 'exhausted' | 'timeout'; edits: EditLog; summary: string }>
```
Tools exposed to Opus: `read_file`, `grep`, `edit_file`, `verify` (calls M5.T2).

**Test:** `test/core/testing/explorer/L4_repair/subagent.test.ts` (mocked client) — synthetic loop: 3 turns of read → edit → verify → clean → `status: 'verified'`. Exhaustion path: 20 turns without `clean` → `status: 'exhausted'`. Timeout path: stubbed clock.

**Acceptance:** 3 tests green.
**LOC:** ≈ 200 prod + 120 test = 320.

### Task M5.T4 — `promote` + `repair` orchestrator + CLI

**Files:**
- `src/core/testing/explorer/L4_repair/promote.ts` — writes `test/ui-auto/fixtures/<component>/regression-<id>.fixtures.tsx` per locked spec §4.6 step 4.
- `src/core/testing/explorer/repair.ts` (replace stub) — flow: read dump → subagent → on `verified` → promote → move `.ink-explorer/failures/<id>.md` → `.../resolved/<id>.md`.

**Reads:** locked spec §4.6 steps 4–5.

**Test:** `test/core/testing/explorer/L4_repair/repair.test.ts` (mocked client) — end-to-end on a toy failure: produces a regression fixture file at expected path, moves the dump to `resolved/`, emits a one-line root cause.

**Acceptance:** 2 tests green; `nuka explore repair <id>` exits 0 on verified outcome.
**LOC:** ≈ 130 prod + 80 test = 210.

### Task M5.G — Two-Opus-reviewer gate (M5)

Process task; LOC 0. Reviewer focus: subagent turn-bound + timeout, promote path matches `test/ui-auto/fixtures/<component>/regression-<id>.fixtures.tsx` per locked spec, dump-move idempotency.

---

## Milestone M6 — Dogfood (Bug A repair + Bug B sweep + minimal patches) (4 tasks + gate, ~520 LOC)

Goal: prove the verb chain on the two real bugs from bringup §2. Two production patches land. Both regression fixtures flip from `it.failing` to `it`.

### Task M6.T1 — `nuka explore repair` against Bug A (real run, captured trace)

**Files (new/modified):**
- `.ink-explorer/failures/regression-bug-a.md` — seeded by hand from the M1 fixture failure (committed for repeatability; gitignored normally, but we land this one dump under `test/fixtures/explorer-dumps/regression-bug-a.md` to dodge `.gitignore`).
- Run record committed at `docs/superpowers/runs/2026-05-18-bug-a-repair.md` (≤ 60 LOC) — captures the Opus subagent transcript + final edits.

**Reads:** bringup §2.1.

**Test:** `test/core/testing/explorer/dogfood/bugA.test.ts` —
- After running `repair`, the patch must touch `src/core/tools/todoWrite.ts:17` (description gains "When NOT to use" guidance) **and** `src/core/agent/systemPrompt.ts` (a `TodoWrite` usage section appears).
- The M1 Bug A fixture transitions from `it.failing` to `it` and passes.

**Acceptance:** 2 tests green; subagent transcript stored; commits authored as `feat(tools/todo): add 'when not to use' guidance` and `feat(agent/systemprompt): add todowrite usage block`.
**LOC:** ≈ 80 prod patch + 80 test + 60 doc = 220.

### Task M6.T2 — `nuka explore sweep` catches Bug B across the 7 viewports

**File (modified):** `test/ui-auto/fixtures/regression-bug-b.fixtures.tsx` (no production code change in this task).

**Reads:** bringup §6 viewport matrix; §2.2 root causes.

**Test:** `test/core/testing/explorer/dogfood/bugB-sweep.test.ts` — drive `sweep()` against the Bug B fixture; assert failure records appear at **at least** the profiles `narrow-compact` (60×30), `narrow-edge` (70×30), `pre-normal` (79×24), `normal` (100×30); each failure cites one of {B1 LOGO compact, B2 prologue in static}.

**Acceptance:** 1 test green at HEAD before M6.T3 (sweep proves Bug B reproducible without the fix). This is the failing-test side of M6.T3's test-first pair.
**LOC:** ≈ 0 prod + 90 test = 90.

### Task M6.T3 — Minimal patches for Bug B (Welcome remount stability + `prologueGoesStatic` guard)

**Scope is non-negotiable: only `src/tui/Welcome/Welcome.tsx` and `src/tui/Messages/Messages.tsx`. No FullscreenLayout / ModalStack migration. No `useTerminalSize` redesign beyond the minimum needed for the fix.**

**Files (modified):**
- `src/tui/Welcome/Welcome.tsx` — on initial render frame after a remount, defer the `getLayoutMode` decision by one tick (e.g. seed with the previously-known mode held in a module-scope ref, or read `process.stdout.columns` directly for the first paint and reconcile on the next resize event). Whichever the smaller diff, ≤ ~30 LOC.
- `src/tui/Messages/Messages.tsx:168` — modify `prologueGoesStatic` so the prologue does NOT flip into Static during a *transient* `streaming: null → !null → null` flicker within the same animation frame. Concretely: gate the flip on `(total > 0 || streaming !== null)` AND `(streaming !== null || hasEverStreamed)`, tracking `hasEverStreamed` in component state so a momentary stream that immediately resolves does not push the prologue to scrollback. ≤ ~20 LOC.

**Reads:** bringup §2.2; `src/tui/Welcome/layout.ts:17–20`; `src/tui/hooks/useTerminalSize.ts:6,11`; `src/tui/Messages/Messages.tsx:160–205`.

**Test:** the Bug B fixture (M1.T5) flips from `it.failing` to `it` and passes across all 7 viewport profiles after this patch; M6.T2's sweep test continues to assert pre-patch reproduction (use a fixture that pins to the pre-patch behavior via captured grids, or split: M6.T2 stays a *snapshot* of failure dumps generated before T3 lands).

**Acceptance:** Bug B fixture green across all 7 profiles; B1 logo not compact at 79; B2 prologue remains in live area; no `staticWrites()` contains the prologue. Commits: `fix(tui/welcome): stabilize layout mode on remount frame` + `fix(tui/messages): guard prologue static-flip on stream flicker`.
**LOC:** ≈ 50 prod patch + 60 test = 110.

### Task M6.T4 — Auto-promote check (regression fixtures exist where M5.T4 placed them)

**File (assertion-only):** `test/core/testing/explorer/dogfood/promotion.test.ts`.

**Test:** post-M6.T1, assert `test/ui-auto/fixtures/TodoWrite/regression-<id>.fixtures.tsx` exists (or the explorer's chosen component slug for a non-render bug); assert sweep re-runs it cleanly.

**Acceptance:** 1 test green; promoted fixture is in-tree and committed.
**LOC:** ≈ 60 test = 60.

### Task M6.G — Two-Opus-reviewer gate (M6)

Process task; LOC 0. Reviewer focus: the two production patches are minimal (scope honored), both regression fixtures green, sweep clean across all 7 viewports, repair audit trail under `docs/superpowers/runs/`.

---

## Milestone M7 — Skill packaging (3 tasks + gate, ~370 LOC)

Goal: `~/.claude/skills/ink-ui-explorer/SKILL.md` + bundled runner installable; doc cross-reference complete.

### Task M7.T1 — `SKILL.md` + verb table

**Files (new):**
- `~/.claude/skills/ink-ui-explorer/SKILL.md` — verbatim shape from locked spec §5 (frontmatter `name`, `description`, then verb table + decision rules).
- `~/.claude/skills/ink-ui-explorer/package.json` — declares peer deps `react`, `ink`; runtime deps `string-width`, `strip-ansi`, `ansi-regex`.

**Test:** `test/skills/inkUiExplorer.test.ts` — assert SKILL.md frontmatter parses; description contains the 5 verbs; decision-rule mapping table parses to a typed object.

**Acceptance:** 1 test green; skill discoverable by the Nuka skill loader (bundled-skill registration mechanism, but registration itself is **not** in scope here — only the on-disk artifact).
**LOC:** ≈ 120 doc/data + 80 test = 200.

### Task M7.T2 — Helper bin `ink-ui-explorer` (delegates to `nuka explore`)

**File (new):** `~/.claude/skills/ink-ui-explorer/bin/ink-ui-explorer` — shim script: `exec nuka explore "$@"`.

**Test:** `test/skills/inkUiExplorerBin.test.ts` — exec the shim with `capture --help`, assert stdout contains expected usage from the M1 CLI.

**Acceptance:** 1 test green.
**LOC:** ≈ 20 prod + 50 test = 70.

### Task M7.T3 — Doc cross-reference

**Files (modified):** `docs/superpowers/index.md` (or equivalent) — link to bringup spec + this plan; `README.md` Phase status — append "Phase 9.5 ink-ui-explorer shipped". No production code changed.

**Test:** `test/docs/explorerCrossRef.test.ts` — assert link targets resolve.

**Acceptance:** 1 test green; docs build clean.
**LOC:** ≈ 0 prod + 50 doc + 50 test = 100.

### Task M7.G — Two-Opus-reviewer gate (M7)

Process task; LOC 0. Reviewer focus: skill metadata matches locked spec §5; helper bin works without local Node modules; doc xref complete. **Final gate** before the bringup is declared done.

---

## CI guards (binding from M0 onward)

Every milestone-closing commit must pass:

1. `npm run typecheck` — clean (both root tsconfig + `tsconfig.test.json`).
2. `npm test` — vitest run; total test count ≥ previous milestone's baseline + new tests; no existing test regresses.
3. **Bundle gate:** `du -k dist/cli.js | awk '{print $1}'` ≤ `720`. `dist/explorer.js` exists. `grep -E "core/testing/explorer" dist/cli.js` returns no matches (dynamic-import isolation).
4. `npm run lint` — no new errors.
5. Two-Opus-reviewer gate task complete (both approvals on record).

A failure on any of (1)–(4) blocks reviewer dispatch.

---

## Open implementation choices deferred to individual tasks

These are decided by the implementer of each milestone, not locked here:

- Exact `string-width` patch surface for emoji ZWJ edge cases (M1.T2).
- Whether `loadFixtures` uses `tsx` programmatic API or shells out (M2.T1) — preference: `tsx` programmatic to keep the runner single-process.
- Subagent prompt phrasing & one-shot example contents (M5.T3).
- Whether `promote` infers the component slug from the fixture export's `component` field or from the failure record (M5.T4) — preference: failure record (single source of truth).

---

## References

- `docs/superpowers/specs/2026-05-02-ink-ui-explorer-design.md` — locked architecture, verb surface, acceptance.
- `docs/superpowers/specs/2026-05-18-ink-ui-explorer-bringup-design.md` — phasing P4..P10, viewport matrix, two-reviewer gate.
- `src/core/testing/{runner,plan,assertions,mockProvider,keystrokes,vitest,slashRegistry,cli-entry}.ts` — existing Phase 9 harness; explorer extends without modifying.
- `src/tui/testing/harness.ts` — `mountApp` for the existing TUI plans; explorer adds a sibling `renderWithViewport` rather than altering this.
- `src/cli.tsx:185–202` — dynamic-import template for the `nuka explore` argv branch.
- Bugs A and B root-cause anchors: `src/core/tools/todoWrite.ts:17`, `src/core/agent/systemPrompt.ts`, `src/tui/Messages/Messages.tsx:168`, `src/tui/hooks/useTerminalSize.ts:6,11`, `src/tui/Welcome/layout.ts:17–20`, `src/tui/App.tsx:433,1067`.
