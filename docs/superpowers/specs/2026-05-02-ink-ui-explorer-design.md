# `ink-ui-explorer` — Autonomous UI-Error Explorer for Ink TUIs

**Status:** Design (locked)
**Date:** 2026-05-02
**Author:** Claude Opus 4.7 (1M ctx) / Nidhog
**Skill ID:** `ink-ui-explorer`
**First consumer:** Nuka (Ink 6.8 + React 19, vitest 2.1)

---

## 1. Problem statement

The two most recent commits on `main` (`6107a64`, `0743b22`) fix **twelve** UI bugs.
Of those twelve, **nine** are layout/render regressions that the existing
`mountApp` harness in `src/tui/testing/harness.ts` was structurally unable to
catch:

| Bug | Class | Why current harness misses it |
|---|---|---|
| Welcome `flexGrow=1` inflates hero | viewport-dependent layout overflow | harness has no terminal-size sweep; default fake stdout is 100 cols |
| Welcome hero contentHeight uncapped | same | same |
| Logo only 3 rows | visual proportion | string-contains assertions can't see "looks short" |
| SlashCard `/fork` short-list pagination drops last item | pagination logic surfacing as missing render | no fixture matrix per filtered list size |
| PromptInput text overruns bottom border | content overflow | no `visualWidth(line) ≤ cols` invariant |
| StatusPanel 50% column bleeds | flex layout overflow | same |
| Settings 18-col rail too wide | ergonomics / visual | snapshot-as-string doesn't surface it |
| Messages `<Static>` pushes content to scrollback | hidden render | `frames()` does **not** see Static commits |
| `/harness` submenu missing | missing component | no exhaustive slash → submenu round-trip sweep |

Three (`contextUsed` number, custom-model dup-id, websearch fallback) are pure
state/data bugs and are out of scope.

The existing harness can drive `stdin`, read `frames()` strings, and assert
`contains/notContains/regex/equals/frameCount`. It cannot:

- Simulate a terminal viewport (cols × rows) other than the ink-testing-library default.
- Parse a frame into a positional grid of cells, so spatial assertions are impossible.
- Detect Ink `<Static>` commits (which write directly to stdout, bypassing `frames`).
- Sweep state × viewport combinations automatically.
- Form a model of "what the user sees" usable by an LLM judge.

**Goal:** ship a Claude Code skill `ink-ui-explorer` that *autonomously* explores
the UI state space of any Ink-based project, finds layout/render bugs without a
human writing per-bug assertions, lets Claude *see* what was rendered, and
closes the loop by spawning a repair subagent that produces a patch and proves
it fixes the failure.

---

## 2. Locked design constraints (from brainstorming)

| # | Decision | Implication |
|---|---|---|
| 1 | **Heavy proactive exploration** (B) | Sweep + fuzz + Vision Judge are first-class, not opt-in. |
| 2 | **Claude Code Skill** (A) | Distributable as `~/.claude/skills/ink-ui-explorer/`. Zero project-local config beyond fixtures. |
| 3 | **Single skill + verbs** (C) | One CLI, subcommands `capture | sweep | fuzz | judge | repair`. Claude picks the verb. |
| 4 | **Tiered Judge** (C) | Haiku quick-pass → Opus precise-pass; grid-hash cache + dedup; Judge participates in sweep/fuzz by default. |
| 5 | **Failure → regression fixture** (C) | Transient dumps in `.ink-explorer/failures/`; on repair-verified, auto-promote to `test/ui-auto/fixtures/<component>/regression-<id>.tsx`. |

---

## 3. Architecture

### 3.1 Layered model

```
┌──────────────────────────────────────────────────────────────────────┐
│ L4  Repair      Spawn Opus subagent on failure dump → patch → verify │
│                 → promote to regression fixture                       │
├──────────────────────────────────────────────────────────────────────┤
│ L3' Judge       Haiku quick-pass → Opus precise-pass                 │
│                 grid-hash cache, cross-fixture dedup                  │
├──────────────────────────────────────────────────────────────────────┤
│ L3  Explorers   Fuzz (random stdin + viewport resize),               │
│                 PBT shrink to minimal repro                           │
├──────────────────────────────────────────────────────────────────────┤
│ L2  Sweep       fixtures × viewports cartesian → run L1 invariants    │
├──────────────────────────────────────────────────────────────────────┤
│ L1  Invariants  6 generic structural checks (no manual assertions)   │
├──────────────────────────────────────────────────────────────────────┤
│ L0  Capture     renderWithViewport(node, {cols,rows})                 │
│                 AnsiGrid parser, Static-stream interceptor            │
└──────────────────────────────────────────────────────────────────────┘
```

Higher layers consume only the lower layer's typed output. L0 is the only
layer that touches Ink internals.

### 3.2 Repository / skill layout

```
~/.claude/skills/ink-ui-explorer/
├── SKILL.md                       Claude calling convention & verb table
├── package.json                   bundles runner; deps below
├── runner/
│   ├── bin/ink-ui-explorer.ts     CLI dispatch (capture|sweep|fuzz|judge|repair)
│   ├── L0_capture/
│   │   ├── viewport.ts            FakeStdout class (cols/rows/write/clear)
│   │   ├── render.ts              renderWithViewport(node, {cols,rows})
│   │   ├── grid.ts                AnsiGrid: parse ANSI → {rows, cols, cells, asciiView, boxes}
│   │   └── staticTap.ts           detect & buffer Static stdout commits
│   ├── L1_invariants/
│   │   ├── noContentBeyondColumns.ts
│   │   ├── noBorderBleed.ts
│   │   ├── noStaticWrites.ts
│   │   ├── flexGrowBounded.ts
│   │   ├── noOverlapBetweenZones.ts
│   │   ├── noLossyTruncation.ts
│   │   └── index.ts               registry + run-all
│   ├── L2_sweep/
│   │   ├── fixtureLoader.ts       discover test/ui-auto/fixtures/**
│   │   ├── viewportMatrix.ts      8 default viewports + custom override
│   │   └── sweep.ts               product runner; emits FailureRecord[]
│   ├── L3_fuzz/
│   │   ├── stdinFuzzer.ts         random keystroke generator (charset-bounded)
│   │   ├── shrinker.ts            PBT-style minimization of failing sequence
│   │   └── fuzz.ts                top-level fuzz verb
│   ├── L3_judge/
│   │   ├── prompt.ts              system + user prompts for Haiku/Opus
│   │   ├── client.ts              minimal Anthropic HTTP client (no SDK dep)
│   │   ├── cache.ts               grid-hash → verdict cache (.ink-explorer/judge-cache.json)
│   │   └── judge.ts               two-tier dispatch
│   ├── L4_repair/
│   │   ├── dumpReader.ts
│   │   ├── subagent.ts            spawn Opus via Anthropic API; tool-loop with read/edit
│   │   ├── verify.ts              re-run sweep on the failing fixture
│   │   └── promote.ts             write regression fixture file
│   └── common/
│       ├── failureDump.ts         FailureRecord type + writer
│       ├── ansiGridDiff.ts        cell-by-cell diff with coords
│       ├── stringWidth.ts         re-export wcwidth-correct width
│       └── tracingFs.ts           safe writes under .ink-explorer/
└── templates/
    └── fixture.example.tsx        copy-paste skeleton for project authors
```

Runtime deps: `react`, `ink` (peer, taken from target project), `string-width`,
`strip-ansi`, `ansi-regex`. Dev deps: `tsx`, `vitest`, `typescript`.

The runner is shipped pre-built (esbuild, single file) so the skill works in any
project that has Ink installed; it does **not** need its own `node_modules`
co-located with target sources.

### 3.3 Per-project footprint

A project that wants to be explored adds:

```
<project>/
├── test/ui-auto/
│   └── fixtures/
│       ├── Welcome.fixtures.tsx     ← author-written
│       ├── PromptInput.fixtures.tsx ← author-written
│       ├── …
│       └── regression/              ← auto-generated by L4 (committed to git)
│           └── 2026-05-02-welcome-flexgrow.tsx
├── .ink-explorer/                    ← project root, gitignored
│   ├── failures/<id>.md
│   ├── resolved/<id>.md              ← repair-cleared, kept for audit
│   ├── captures/<id>.txt             ← from `capture` verb
│   ├── judge-cache.json
│   └── runs/<timestamp>.jsonl        ← raw run log
└── .gitignore                        ← runner appends `/.ink-explorer/` on first run
```

The single `.ink-explorer/` directory lives at project root (not under
`test/ui-auto/`) so all transient runner state shares one root and one
gitignore line.

**Default fixture glob** is `test/ui-auto/fixtures/**/*.fixtures.tsx`, which
matches both author-written fixtures and the auto-generated
`regression/*.tsx` files (regression fixtures use the same `.fixtures.tsx`
suffix). Sweep therefore re-runs every previously-promoted regression on
every invocation.

No vitest, ink, or tsconfig changes required. The runner discovers fixtures by
glob, registers them, and runs in its own Node process — independent of the
project's own vitest run.

---

## 4. Layer specifications

### 4.1 L0 — Capture

**`FakeStdout` (`L0_capture/viewport.ts`)** — a writable stream with explicit
`columns`, `rows`, `isTTY=true`, capturing `write()` calls into two channels:

```ts
class FakeStdout {
  columns: number
  rows: number
  isTTY = true
  liveBuffer: string = ''
  staticBuffer: string = ''
  // Ink calls write() with the entire next frame; Static commits arrive as
  // separate writes that are *not* re-rendered. We tag any write following an
  // observed Static commit boundary into staticBuffer.
  write(chunk: string | Buffer): boolean
  clear(): void
  resize(cols: number, rows: number): void  // emits 'resize' event
}
```

**`renderWithViewport` (`L0_capture/render.ts`)**:

```ts
function renderWithViewport(
  node: React.ReactElement,
  viewport: { cols: number; rows: number },
  opts?: { stdin?: NodeJS.ReadStream }
): InkRenderHandle {
  const stdout = new FakeStdout(viewport.cols, viewport.rows)
  const stderr = new FakeStdout(viewport.cols, viewport.rows)
  const stdin = opts?.stdin ?? new MockStdin()
  // Reuse ink's render() with explicit { stdout, stderr, stdin, debug:false }.
  // exitOnCtrlC:false so fuzz cannot kill the harness.
  const inst = inkRender(node, { stdout, stderr, stdin, exitOnCtrlC: false, debug: false })
  return {
    frames: () => splitFrames(stdout.liveBuffer),
    lastFrame: () => lastSnapshot(stdout.liveBuffer),
    staticWrites: () => stdout.staticBuffer.split('\n').filter(Boolean),
    grid: (frame?: string) => AnsiGrid.parse(frame ?? lastSnapshot(stdout.liveBuffer), viewport),
    stdin: { write: (s: string) => stdin.emit('data', s) },
    resize: (c, r) => { stdout.resize(c, r); inst.rerender(node) },
    unmount: () => inst.unmount(),
  }
}
```

**`AnsiGrid` (`L0_capture/grid.ts`)** — the single typed surface higher layers
operate on:

```ts
type Cell = {
  char: string         // single visible glyph or ' '
  width: 0 | 1 | 2     // wcwidth (0 for combining, 2 for CJK/emoji)
  fg?: string; bg?: string
  bold?: boolean; dim?: boolean; underline?: boolean; inverse?: boolean
}
type Box = { x: number; y: number; w: number; h: number; style: 'single' | 'double' | 'round' | 'bold' }
type AnsiGrid = {
  cols: number; rows: number
  cells: Cell[][]            // [row][col]
  boxes: Box[]               // detected from box-drawing chars (U+2500–257F)
  asciiView: string          // strip-ansi, padded to cols × rows, '\n'-joined
  hash: string               // sha256 of asciiView; used by judge cache
  toJSON(): unknown
}
```

`AnsiGrid.parse(ansiString, viewport)`:
1. `strip-ansi` → text; concurrent state machine over original to record SGR per cell.
2. Walk char-by-char with `string-width` to allocate 1 or 2 cells.
3. Wrap rows at `cols` (mirror real-terminal behavior; this is what catches
   PromptInput overrun).
4. Detect boxes by tracing connected box-drawing characters into rectangles.
5. Compute SHA-256 of `asciiView` for cache keying.

**`staticTap` (`L0_capture/staticTap.ts`)** — Ink emits Static commits via a
distinct write call sequence; the tap classifies writes by the presence of
`\u001b[?1049l` / cursor-restore sequences and segregates them. The end result
is `staticWrites()` returning the lines that escaped to scrollback. The
`noStaticWrites` invariant defaults to enforcing zero, with a per-fixture
allowlist if a component legitimately uses `<Static>`.

### 4.2 L1 — Invariants

Six built-in checks. Each is `(grid, ctx) => Violation[]`:

```ts
type Violation = {
  rule: string
  severity: 'error' | 'warn'
  cells?: Array<{ x: number; y: number }>     // exact coords for highlighting
  excerpt?: string                              // 3-line snippet around the issue
  message: string
}
```

| Rule | What it checks | Catches (from §1) |
|---|---|---|
| `noContentBeyondColumns` | every visible cell `x < cols`; no logical line whose `string-width > cols` without a wrap point | PromptInput overrun |
| `noBorderBleed` | for each detected `Box`, perimeter cells must remain box-drawing chars (no inner content overlay) | StatusPanel column bleed, PromptInput border overrun |
| `noStaticWrites` | `staticWrites().length === 0` unless fixture sets `allowStatic: true` | Messages `<Static>` regression |
| `flexGrowBounded` | for any detected outer Box height, must be `≤ viewport.rows`; for components flagged `expectsHugContent`, must equal computed content height ±1 | Welcome `flexGrow=1`, hero contentHeight uncapped |
| `noOverlapBetweenZones` | if fixture declares `zones: { name → bbox }`, no two zones share a cell | future regression class |
| `noLossyTruncation` | fixture-declared `mustContain: string[]` must each appear in `asciiView` (catches "the last item disappeared") | SlashCard `/fork` last-item drop |

The first four run on **every** fixture without configuration. Five and six
require fixture metadata to be active.

### 4.3 L2 — Sweep

**Default viewport matrix** (`L2_sweep/viewportMatrix.ts`):

```ts
[
  { cols:  60, rows: 20 },   // narrow phone-style
  { cols:  80, rows: 24 },   // classic
  { cols: 100, rows: 30 },   // common modern
  { cols: 132, rows: 40 },   // wide
  { cols: 200, rows: 50 },   // ultra-wide
  { cols:  40, rows: 80 },   // tall+narrow
  { cols:  80, rows: 100 },  // tall (catches Welcome flexGrow inflation)
  { cols: 250, rows: 15 },   // short+ultra-wide
]
```

A fixture may add or restrict viewports.

**Fixture format** (`templates/fixture.example.tsx`):

```ts
import type { Fixture } from 'ink-ui-explorer/runner'
import { Welcome } from '../../src/tui/Welcome/Welcome'

export default {
  component: 'Welcome',
  cases: {
    cold: {
      render: () => <Welcome /* …minimal props… */ />,
      mustContain: ['NUKA'],
      expectsHugContent: true,                    // enables flexGrowBounded strict mode
    },
    withRecents: {
      render: () => <Welcome recents={[…]} />,
      mustContain: ['NUKA', 'Recent'],
      allowStatic: false,
    },
  },
  viewports: 'default',                            // or [{cols,rows}, …]
} satisfies Fixture
```

**Sweep loop**: for each fixture × each case × each viewport:
1. `mount = renderWithViewport(case.render(), viewport)`
2. `await flushFrames()` (poll until two consecutive identical frames or 250ms)
3. `grid = mount.grid()`
4. `violations = invariants.runAll(grid, { case, viewport, mount })`
5. if `violations.length` → `failureDump.write(record)`
6. emit JSONL log line; `unmount()`

After sweep completes, the **Judge stage runs automatically** on every
(fixture, case, viewport) cell whose grid hash hasn't been judged before,
even if no L1 invariant fired (this is how the framework finds *unknown*
classes of bug — the whole point of constraint B).

### 4.4 L3 — Fuzz

**Charset**: printable ASCII + arrow keys + Tab/Enter/Esc + Ctrl-C-equivalent
escape sequences (mapped through Ink's input parser, not raw Ctrl-C which
unmounts).

**Loop** (`fuzz.ts`):
1. Mount target (defaults to project's `App` if `--target app`, else fixture).
2. For up to N steps (default 200): pick a random key from charset; write to
   stdin; `await flushFrames()`; run L1 invariants; if violation → record
   sequence and break.
3. **Shrink** (PBT): binary-search the shortest prefix of the sequence that
   still reproduces the violation; then per-step deletion until no further
   reduction. Deterministic given the same seed.
4. Also fuzz **viewport resize** between keystrokes with probability `p_resize`
   (default 0.05) — picks a random viewport from the matrix and re-renders.
5. Failure dump includes the minimal stdin sequence + viewport sequence so the
   case is replayable.

Fuzz is invoked explicitly (`ink-ui-explorer fuzz [--target …] [--seed …] [--steps N]`)
because it is non-deterministic by default and has no upper time bound.

### 4.5 L3' — Judge

**Two-tier**:

```
                     ┌──────────────────────────┐
   AnsiGrid ───────► │ cache lookup by grid.hash│ ── hit ──► reuse verdict
                     └──────────────────────────┘
                                 │ miss
                                 ▼
                     ┌──────────────────────────┐
                     │ Haiku quick-pass         │
                     │ "issues yes/no, why?"    │
                     └──────────────────────────┘
                       │              │
                       │              └─ "no issues" → cache & return clean
                       ▼
                     ┌──────────────────────────┐
                     │ Opus precise-pass        │
                     │ "list violations w/ box  │
                     │  coords + suggested fix" │
                     └──────────────────────────┘
                                 │
                                 ▼
                       cache verdict + write FailureRecord
```

**Prompts** (`L3_judge/prompt.ts`) — templated, includes:
- Component name + fixture case description.
- The viewport (`cols × rows`).
- The full `asciiView` inside a fenced block.
- The component's declared `mustContain`, `expectsHugContent`, etc.
- Instruction: report only structural problems (overflow, overlap, broken
  borders, content escaping the frame, cramped/inflated regions). Do not
  comment on aesthetics unless they cross a threshold.

**Cache** (`L3_judge/cache.ts`) is a JSON file keyed by
`sha256(asciiView + componentName + viewportKey)`. Cache survives across runs;
invalidated only by deleting `.ink-explorer/judge-cache.json`. This makes
repeat sweeps cheap — only newly-changed grids hit the API.

**Cost guard**: per-run env caps `INK_EXPLORER_MAX_HAIKU=200`,
`INK_EXPLORER_MAX_OPUS=20`. Exceeded → judge phase logs and short-circuits with
a warning rather than failing the run.

**Client** (`L3_judge/client.ts`): minimal `fetch`-based POST to
`/v1/messages` using `ANTHROPIC_API_KEY`. No `@anthropic-ai/sdk` dependency
(keeps skill install footprint tiny). Models pinned to
`claude-haiku-4-5-20251001` and `claude-opus-4-7` per the assistant's known
model IDs at design time.

### 4.6 L4 — Repair

`ink-ui-explorer repair <failure-id>` flow:

1. **Read dump**: `dumpReader.ts` parses the failure markdown back into a
   typed `FailureRecord` (component, case, viewport, violations, asciiView,
   stdin sequence if from fuzz).
2. **Spawn Opus subagent** (`subagent.ts`):
   - System prompt: "You are repairing an Ink layout bug in the project at
     CWD. You have read/edit access to the project's source via tools."
   - User message: the FailureRecord + a one-shot example showing the
     ASCII grid, the violated invariant, and a known-good source diff.
   - Tool loop: `read_file`, `grep`, `edit_file`. Bounded turns
     (`INK_EXPLORER_REPAIR_MAX_TURNS=20`).
   - After each edit, the subagent calls a synthetic `verify` tool that
     re-runs L0+L1 on the failing fixture/case/viewport (and only that one)
     and returns the new violations or "clean".
3. **Verify** (`verify.ts`): on subagent's `verify` tool calls — re-mount the
   target fixture/case at the failing viewport *inside the same runner
   process* (no subprocess fork), run L0 + L1 only, return JSON. Source
   files modified by the subagent are picked up by clearing the relevant
   entries from Node's module cache before the re-mount.
4. **Promote** (`promote.ts`): when verify reports `clean`, write
   `test/ui-auto/fixtures/<component>/regression/<id>.tsx` containing:
   - The fixture case under a stable name `regression_<id>`.
   - The viewport list `[failing_viewport]` (single-entry — fast in CI).
   - Frozen `mustContain` derived from the original case.
   - A header comment with the dump path and the one-line root cause from
     subagent's final summary.
5. **Cleanup**: move `.ink-explorer/failures/<id>.md` →
   `.ink-explorer/resolved/<id>.md` (still gitignored, kept for audit).

If subagent exhausts turns without reaching `clean`, the failure dump is
annotated with the attempted edits and the verify history; no fixture is
promoted. Claude can pick up from there.

---

## 5. Skill calling convention (`SKILL.md` excerpt)

```yaml
---
name: ink-ui-explorer
description: |
  Explore and repair UI layout/render bugs in any Ink-based React TUI.
  Use when: the user reports a TUI looks wrong, when starting work on an Ink
  component, or after touching ink/yoga layout. Verbs: capture | sweep | fuzz
  | judge | repair.
---

# Verbs

- `ink-ui-explorer capture <fixture-path> [--viewport=80x24]`
  Mount a single fixture at one viewport, write the ASCII grid + grid JSON to
  `.ink-explorer/captures/`. Use to *see* what a component renders.

- `ink-ui-explorer sweep [--fixtures=<glob>] [--no-judge]`
  Run fixtures × default viewport matrix → L1 invariants → Judge (default on).
  Writes failure dumps and prints a summary table.

- `ink-ui-explorer fuzz [--target=app|<fixture-path>] [--seed=N] [--steps=200]`
  Random stdin + occasional viewport resize, shrunk to minimal repro on
  failure.

- `ink-ui-explorer judge [--re-judge]`
  Re-run only the Judge stage on the most recent sweep's grids; skip cache
  with --re-judge.

- `ink-ui-explorer repair <failure-id>`
  Spawn Opus subagent to read the dump, propose edits, verify, and promote a
  regression fixture.

# Decision rules
- User asks "what does X look like?" → `capture`.
- User says "find UI bugs" / starts a TUI session → `sweep`.
- User says "test it harder" / a sweep was clean but the user is suspicious → `fuzz`.
- A failure dump exists → `repair <id>`.
```

---

## 6. Failure dump format (`FailureRecord` markdown)

```markdown
---
id: 2026-05-02-welcome-flexgrow-7f3a
component: Welcome
case: cold
viewport: 80x100
discoveredBy: invariant   # or: judge, fuzz
invariants:
  - flexGrowBounded
judgeVerdict: null         # populated when judge raised it
stdinSequence: []          # populated by fuzz
---

## Violations

- **flexGrowBounded** at zone `Welcome.outer`: height 100 exceeds expected
  hug-content height 12 by 88 rows.

## Last frame (ASCII grid, 80×100)

```
<full asciiView, fenced, padded>
```

## Annotated cells

(80×100 grid with `▓` markers at `Violation.cells`)

## Reproducer (programmatic)

```ts
import Welcome from '<project>/src/tui/Welcome/Welcome'
const h = renderWithViewport(<Welcome />, { cols: 80, rows: 100 })
```

## Suggested next step

`ink-ui-explorer repair 2026-05-02-welcome-flexgrow-7f3a`
```

This file is the single source of truth a future Claude session needs to
understand and act on the failure.

---

## 7. Phasing

The whole framework is delivered in **one** spec because the layers are
co-dependent (L1 needs L0; L2 needs L1; L3 Judge and L4 Repair both need
failure dumps from L1/L3). But the **plan** breaks it into shippable
milestones:

| Milestone | Scope | Demo |
|---|---|---|
| M1 | L0 + AnsiGrid + 4 always-on invariants + skill skeleton + `capture` verb | Capture Welcome at 80x100, see grid, no judge |
| M2 | L2 sweep + fixture loader + 8 default viewports + remaining 2 invariants | Sweep Nuka's existing components, reproduce ≥6 of the 9 layout bugs as failures (with bugs reverted in fresh worktree) |
| M3 | L3' Judge (two-tier + cache + cost guards) | Sweep finds bugs that the structural invariants miss (Logo proportion class) |
| M4 | L3 Fuzz (stdinFuzzer + shrinker + viewport-resize) | Find at least one new bug in Nuka via fuzz |
| M5 | L4 Repair (subagent + verify + promote) | One-command `repair` produces a patch and a regression fixture for a M2 failure |
| M6 | Skill packaging + README + Nuka regression backfill (12 known bugs as fixtures) | `~/.claude/skills/ink-ui-explorer/` installable; Nuka's CI runs sweep |

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Ink internal API for `render({stdout})` changes between Ink 6 and a future Ink 7 | Pin Ink as peer with `^6 || ^7`; CI matrix on both; integration test at L0 boundary |
| `<Static>` detection heuristic (alt-screen escape sequence sniffing) misclassifies | Cross-validate by also checking that Static-classified content doesn't reappear in the next live frame; allow per-fixture `allowStatic` override |
| Judge cost balloons | Tiered Haiku→Opus, grid-hash cache (most repeat-sweep grids hit cache), env caps, default off in CI via `--no-judge` |
| Judge false positives waste repair budget | Repair is opt-in per failure-id (Claude/user picks); subagent has bounded turns; promotion only on verify-clean |
| Fuzz produces "of course it broke if you spam Ctrl-anything" noise | Charset excludes raw Ctrl-C; only invariants that should hold under *any* input fire during fuzz |
| Wcwidth disagreements (emoji ZWJ, regional indicators) make grid wrong | Use `string-width` (which uses unicode tables); document known divergences; fallback: render asciiView with `?` for ambiguous and surface that as a separate warning |
| Ink Issue #907 (line-wrap bug upstream) makes our wrap logic disagree with real terminal | Document divergence; our grid mirrors *intended* terminal behavior, not Ink's bug — so we may surface the upstream bug as a violation, which is desirable |
| Repair subagent makes wrong edit | Verify gate before promote; never promote without `clean`; resolved/ folder keeps the trail |

---

## 9. Out of scope (this spec)

- Pure data/state bugs (e.g. wrong number in `contextUsed`) — covered by
  existing unit tests.
- Multi-process / IPC scenarios.
- Mouse input (Ink doesn't support it portably).
- Performance/regression benchmarks (separate concern).
- Auto-publishing the skill to a marketplace.

---

## 10. Open implementation choices (deferred to plan)

These are decided in the plan, not the spec, because they don't change the
externally visible contract:

- Exact wcwidth library version & monkey-patches for emoji edge cases.
- Whether `runner/` is bundled as a single esbuilt JS or shipped as TS+tsx
  loader (tradeoff: install size vs. error-stack quality).
- Storage format of judge cache (flat JSON vs. SQLite if it grows >10k
  entries).
- Whether `repair` shells out to `claude` CLI or talks directly to Anthropic
  API (preference: direct API, to make the skill self-contained).

---

*End of design.*
