# Plan — Spec E: Context efficiency audit & redesign

**Date:** 2026-05-02
**Spec:** `docs/superpowers/specs/2026-05-02-spec-e-context-audit-design.md`
**Test-first:** every implementation task is preceded by its acceptance test.
**Total estimated LOC:** ~3,750 production + ~2,200 test = ~5,950.
**Total estimated PRs:** 11–13 across 5 milestones.

---

## Conventions

- All file paths are repository-relative (`src/...`, `test/...`, `docs/...`).
- Acceptance criteria are *runnable* assertions — `npm test`, `npm run measure-context`, or a manual TUI verification step.
- Each task lists its **LOC budget** as a hard ceiling. If a task exceeds it, split first.
- "Test-first" means the test file lands in the same PR as the implementation, but is committed *first* in the diff and asserted to fail before the implementation lands. Reviewers should see this as two consecutive commits.
- Every PR includes a `## Measurement delta` section in its description quoting `npm run measure-context` before and after.

---

## Milestone 1 — Measurement reproducibility (2 PRs, ~480 LOC)

Goal: lock today's baseline into CI so the rest of the migration cannot accidentally regress without alarms. **No user-visible behaviour changes.**

### Task M1.T1 — Add `'prompt'` topic to EventBus

**File:** `src/core/events/topics.ts`
**Reads:** `src/core/events/bus.ts` (foundation §6.2 topic union)
**Signature:**
```ts
// Add to TopicMap union:
prompt: { type: 'prompt.assembled' /* …PromptAssembledEvent shape (placeholder) */ }
```

Drop a placeholder `PromptAssembledEvent` type with `type: 'prompt.assembled'` and a TODO referencing M5. The actual event payload lands in M5 — for now we just register the topic so subscribers can be wired without a follow-up bus migration.

**Test (lands first in PR):** `test/core/events/promptTopic.test.ts`
```ts
test('prompt topic accepts assembled event', () => {
  const bus = new EventBus()
  let got: any
  bus.on('prompt', e => (got = e))
  bus.emit('prompt', { type: 'prompt.assembled' } as any)
  expect(got?.type).toBe('prompt.assembled')
})
```

**Acceptance:** test passes. `tsc --noEmit` clean (the union is exhaustively typed).
**LOC:** ≈ 25 prod + 25 test = 50.

### Task M1.T2 — Standalone measurement script

**File (new):** `scripts/measure-context.ts`
**Reads:** mirrors the boot path of `cli.tsx:404–600` — same factory calls, same registration order, but isolated from TUI.

**Function signature:**
```ts
export async function measureContext(opts: {
  cwd: string
  home: string
  harnessMode?: 'deep' | 'fast' | 'off'
  withLsp?: boolean
}): Promise<{
  rows: Array<{ id: string; bytes: number; tokDiv4: number; tokDiv6: number; conditional: string }>
  totals: { tools: number; system: number; user: number; grand: number }
}>
```

Approach: instantiate `ToolRegistry`, register every factory with stub deps (e.g. `runPipeline = () => Promise.resolve(...)`), call `toToolSpec` per registered tool, JSON-stringify `{name, description, input_schema}` and measure. System prompt: call `buildSystemPrompt({…})` with the same inputs the cli passes. Concatenate, output ASCII table mirroring spec §2.2.

**CLI wrapper:** `npm run measure-context` invokes `node --loader ts-node/esm scripts/measure-context.ts`. Add to `package.json` scripts.

**Test:** `test/scripts/measureContext.test.ts`
```ts
test('measureContext returns 19-row tools table for default config', async () => {
  const r = await measureContext({ cwd: '/tmp/nuka-test', home: '/tmp/nuka-test-home' })
  expect(r.rows.length).toBe(19)            // 9 builtin file/shell + Skill + 5 swarm + dispatch + 3 harness
  expect(r.totals.grand).toBeGreaterThan(7000)
  expect(r.totals.grand).toBeLessThan(9000)
})
```

**Acceptance:** test passes; running `npm run measure-context` prints a table matching spec §2.2 within ±5% per row, with grand-total ∈ [7,500, 8,500] bytes.
**LOC:** ≈ 220 prod + 80 test = 300.

### Task M1.T3 — In-test "snapshot of today" baseline

**File (new):** `test/core/agent/contextBaseline.test.ts`
Imports `measureContext`. Asserts the per-row sizes match a frozen JSON snapshot located at `test/fixtures/contextBaseline.json` (committed alongside).

```ts
test('legacy default-config "hello" matches frozen baseline', async () => {
  const r = await measureContext({ cwd: process.cwd(), home: os.tmpdir() })
  const snap = JSON.parse(fs.readFileSync('test/fixtures/contextBaseline.json', 'utf8'))
  for (const row of snap.rows) {
    const live = r.rows.find(x => x.id === row.id)!
    expect(Math.abs(live.bytes - row.bytes) / row.bytes).toBeLessThan(0.05)
  }
})
```

The snapshot file is a one-time generation: run `npm run measure-context -- --emit-snapshot > test/fixtures/contextBaseline.json` once at task close, commit. From this point on, any inadvertent description-bloat fails CI.

**Acceptance:** test green at HEAD. Manually edit any tool's description to add a sentence; CI fails on next run.
**LOC:** ≈ 80 test + 100 fixture = 180.

---

## Milestone 2 — Fragment registry refactor (4 PRs, ~1,400 LOC)

Goal: replace the 71-line `systemPrompt.ts` with a fragment registry; preserve byte-for-byte output under the legacy flag; only the `sys.tools-usage` block changes shape (folded with `expand_block`).

### Task M2.T1 — Fragment types and registry

**Files (new):**
- `src/core/agent/fragments/types.ts` — `Fragment`, `FragmentTrace`, `FragmentPriority`, `FragmentKind` from spec §6.1.
- `src/core/agent/fragments/registry.ts` — `class FragmentRegistry { register(f: Fragment), list(), find(id), remove(id) }`.

**Signatures:** see spec §6.1.

**Test (lands first):** `test/core/agent/fragments/registry.test.ts`
```ts
test('register + list returns ordered fragments', () => {
  const r = new FragmentRegistry()
  r.register({ id: 'a', kind: 'system', priority: 'critical', optional: false, appliesWhen: () => true, render: () => 'A' })
  r.register({ id: 'b', kind: 'system', priority: 'high',     optional: true,  appliesWhen: () => true, render: () => 'B' })
  expect(r.list().map(f => f.id)).toEqual(['a','b'])
})
test('register rejects duplicate id', () => { … })
test('find / remove work', () => { … })
```

**Acceptance:** all 3 tests green; types compile under `tsc --noEmit`.
**LOC:** ≈ 110 prod + 90 test = 200.

### Task M2.T2 — `AssemblyContext` factory

**File (new):** `src/core/agent/assemblyContext.ts`

```ts
export function buildAssemblyContext(input: {
  session: Session
  userText: string
  cwd: string; platform: string; shell: string; nodeVersion: string
  gitBranch: GitBranch | null
  skills: Skill[]
  memoryCache: MemoryEntry[]
  plan: { active: boolean; body: string } | null
  triage: Triage | null
  provider: ProviderId
  model: string
}): AssemblyContext
```

Computes:
- `matchedSkills = matchKeywordSkills(skills, userText)` (re-uses `activator.ts:7`).
- `onSessionSkills = alwaysOnSkills(skills)` (re-uses `activator.ts:3`).
- `memory = findRelevant(memoryCache, tokenize(userText), 5)` (re-uses `cli.tsx:653`).
- `isCoordinator = isCoordinatorMode()` (re-uses `coordinatorMode.ts:6`).
- `isResume = (session.messages.length > 0 && session.firstTurnId === currentTurnId)`.
- `turnId = ulid()` (per-turn fresh).

**Test:** `test/core/agent/assemblyContext.test.ts` — verify each computed field for 3 representative inputs (default, with coordinator env, with skills).

**Acceptance:** 3 tests green.
**LOC:** ≈ 110 prod + 100 test = 210.

### Task M2.T3 — Port the 6 existing system blocks to fragments

**Files (new):** `src/core/agent/fragments/{header,env,toolUsage,skill,memory,plan}Fragment.ts`
**Reads:** `src/core/agent/systemPrompt.ts:31–68` (lift each block verbatim into a `render`).

**Skill fragment is special:** today the skill body is injected as a *system message* (`loop.ts:216`) for matched-keyword skills, and folded into the system prompt (`systemPrompt.ts:48–56`) for on-session-start skills. The fragment registry unifies these into `sys.skills.<name>` and `sys.skills.matched.<name>`. The legacy code path keeps the system-message injection during M2; v2 lifts the matched skills into the fragment trace too. **In M2 only the on-session-start fragments are wired; the matched-skill fragments land in M3 alongside the loop change.**

**Test (per fragment):** `test/core/agent/fragments/<name>Fragment.test.ts`
- `appliesWhen` predicate truth table (true/false cases).
- `render` produces the expected string for a baseline ctx; byte size within the §8.2 ceilings.

Five tests per fragment × 6 fragments = 30 tests in this task.

**Acceptance:** 30 tests green; total fragment LOC < 350.
**LOC:** ≈ 230 prod + 360 test = 590.

### Task M2.T4 — `assemblePrompt` skeleton + parity gate

**File (new):** `src/core/agent/assembler.ts`

```ts
export function assemblePrompt(
  ctx: AssemblyContext,
  fragmentRegistry: FragmentRegistry,
  toolRegistry: ToolRegistry,
  policy?: BudgetPolicy,
  deps?: { bus?: EventBus },
): AssembledPrompt
```

In M2, the body only handles **system fragments**. Tool fragments are still produced via the existing `loop.ts:243–250` path. The signature accepts `toolRegistry` so we don't need to change it again in M3. `policy` is unused in M2 (budget enforcement lands in M4) — accept and ignore.

**File (modified):** `src/core/config/schema.ts`
- Add `context: { assembler: z.enum(['legacy','v2']).default('legacy'), fullToolFloor: z.boolean().default(true) }` (legacy stays default).

**File (modified):** `src/core/agent/loop.ts:234`
```ts
// before:
const system = deps.systemPromptInput ? buildSystemPrompt(deps.systemPromptInput()) : ''
// after:
const system = deps.assemblePrompt
  ? deps.assemblePrompt(ctx).system
  : (deps.systemPromptInput ? buildSystemPrompt(deps.systemPromptInput()) : '')
```

`RunAgentDeps` gets a new optional `assemblePrompt?: (ctx) => AssembledPrompt`; when present, takes precedence. Falls back to legacy when `config.context.assembler === 'legacy'`.

**File (modified):** `src/cli.tsx:651–662`
- When `config.context.assembler === 'v2'`, build the FragmentRegistry, register the 6 fragments from M2.T3, and pass `assemblePrompt` into `runAgent` deps.
- When `'legacy'`, behaviour is unchanged.

**Test (parity):** `test/core/agent/assemblerParity.test.ts`
```ts
test.each(scenarios)('parity: legacy === v2 (sans tool-usage fold)', (name, ctx) => {
  const legacy = buildSystemPrompt(toLegacyInput(ctx))
  const v2     = assemblePrompt(ctx, defaultFragmentRegistry(), toolRegistry).system
  // tool-usage fold is the only intentional difference; reverse it for parity:
  const v2Unfolded = unfoldToolUsage(v2)
  expect(v2Unfolded).toBe(legacy)
})
```

`scenarios` covers 12 ctx variations: default, with-skill, with-memory, plan-active, coordinator-on, coordinator-off, harness-classified, resume, dirty-git, no-git, plugin-skills, full-stack.

**Acceptance:** all 12 parity tests green. `npm run measure-context` shows total bytes in v2 mode < legacy mode by exactly the `tool-usage` fold delta (~210 bytes).
**LOC:** ≈ 220 prod + 180 test = 400.

---

## Milestone 3 — Lazy tool injection (3 PRs, ~1,000 LOC)

Goal: tool list goes through fragment predicates. Default-config "hello" turn shrinks to ≤ 2,400 bytes.

### Task M3.T1 — Flip the inverted default in `activeToolsForMany`

**File (modified):** `src/core/skill/activation.ts:66–83`

Today (`activation.ts:70`):
```ts
if (skills.length === 0) return registry.list()       // ← BUG: returns FULL set
```

Change to (gated on a config knob so legacy users can revert):
```ts
if (skills.length === 0) {
  if (opts?.fullToolFloor) return registry.list()
  return registry.list().filter(t =>
    (t.tags ?? []).includes('core') && t.alwaysLoad !== false
  )
}
```

`activeToolsForMany` gets a third optional argument `opts?: { fullToolFloor?: boolean }` plumbed from `config.context.fullToolFloor`. Default in M3 is `true` (legacy behaviour); a follow-up commit in this task flips the default to `false` ONLY when `assembler === 'v2'`.

**Test:** `test/core/skill/activation.test.ts` (extend)
```ts
test('no skills + fullToolFloor=false → only core+critical/high tools', () => {
  const tools = activeToolsForMany([], registry, { fullToolFloor: false })
  expect(tools.map(t => t.name)).toEqual(
    ['Read','Write','Edit','Bash','Glob','Grep','Skill','expand_block','TodoWrite']
  )
})
test('no skills + fullToolFloor=true → registry unchanged (legacy)', () => {
  const tools = activeToolsForMany([], registry, { fullToolFloor: true })
  expect(tools.length).toBe(registry.list().length)
})
```

**Acceptance:** both tests green; pre-existing tests of `activeToolsForMany` still green (we did not change `skills.length > 0` semantics).
**LOC:** ≈ 60 prod + 80 test = 140.

### Task M3.T2 — Tool fragments wired through `assemblePrompt`

**Files (modified):**
- `src/core/agent/assembler.ts` — extend body to also produce `tools: ToolSpec[]`.
- `src/core/agent/loop.ts:243–257` — replace the per-turn tool-spec construction (`narrowed.flatMap(...)`) with `const { system, tools } = deps.assemblePrompt(ctx)`.

**Files (new):** `src/core/agent/fragments/toolFragment.ts`
- A `toToolFragment(tool: Tool, predicate: (ctx) => boolean): Fragment` adapter.
- `defaultToolPredicates` map keyed by tool name → predicate, populated per spec §7.2.

**File (new):** `src/core/tools/expandBlockTool.ts`
```ts
const FOLDED_BLOCKS: Record<string, string> = {
  'tool-usage': '  - Use tools to read files, edit files, …',
  'harness-rationale': '…',
}
export const ExpandBlockTool = defineTool<{ name: string }>({
  name: 'expand_block',
  description: 'Fetch the full text of a folded system block.',
  parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  source: 'builtin',
  tags: ['core'],
  alwaysLoad: true,
  needsPermission: () => 'none',
  async run({ name }) {
    const body = FOLDED_BLOCKS[name]
    return body
      ? { isError: false, output: body }
      : { isError: true, output: `unknown block: ${name}. Available: ${Object.keys(FOLDED_BLOCKS).join(', ')}` }
  },
})
```

Registered in `cli.tsx:405` alongside the file/shell tools.

**File (modified):** `src/cli.tsx:404–600` — pass each tool through `toToolFragment(t, defaultToolPredicates[t.name] ?? alwaysTrue)` and register it in the FragmentRegistry, in addition to the existing ToolRegistry registration. The two registries share the same Tool instances; the FragmentRegistry only carries the predicate.

**File (modified):** `src/core/agent/coordinatorFragment.ts` (new) — predicate returns `ctx.isCoordinator`.

**Test (snapshot, the spec §8.1 hard bar):**
`test/core/agent/assembler.snapshot.test.ts`
```ts
test('default "hello" turn ≤ 2400 bytes', async () => {
  const ctx = await freshHelloCtx()
  const out = assemblePrompt(ctx, defaultFragments(), defaultRegistry())
  expect(out.trace.totalBytes).toBeLessThanOrEqual(2400)
})
test('default "hello" produces only the lean fragment id list', async () => {
  const ctx = await freshHelloCtx()
  const ids = assemblePrompt(ctx, defaultFragments(), defaultRegistry())
    .trace.fragments.filter(f => f.rendered).map(f => f.id)
  expect(ids).toEqual(LEAN_HELLO_BASELINE)   // 12 ids from spec §8.1
})
```

**Tool-not-available retry test:** `test/core/agent/loop.toolNotAvailable.test.ts`
```ts
test('model emits tool_use for inactive tool → loop replies with not-available + Skill hint', async () => {
  const session = newSession({ context: { assembler: 'v2', fullToolFloor: false } })
  await runAgent({ text: 'use pipeline_run' }, session, deps, signal)
  // assert the next user-role message in transcript contains "not active" + "Skill('"
})
```

**Acceptance:** snapshot test ≤ 2,400 bytes; lean fragment list matches spec §8.1; tool-not-available retry test green; all M2 parity tests still green.
**LOC:** ≈ 380 prod + 280 test = 660.

### Task M3.T3 — Backfill `searchHint` for the deferred tools

**Files (modified):**
- `src/core/tools/builtin/pipelineRun.ts` — add `searchHint: ['pipeline','dag','cascade']`.
- `src/core/tools/builtin/roundtable.ts` — add `searchHint: ['roundtable','debate','synthesizer']`.
- `src/core/tools/builtin/sendMessage.ts` — add `searchHint: ['team:','broadcast']`.
- `src/core/agents/dispatchTool.ts` — add `searchHint: ['dispatch','sub-agent','delegate','specialist']`.
- `src/core/harness/primitives.ts` — none (harness predicate gates on `ctx.triage !== null`, see §7.2).
- `src/core/tools/webFetch.ts` — add `searchHint: ['http','url','fetch']` (already implicit but make explicit).

**Test:** `test/core/agent/searchHint.test.ts`
```ts
test('user msg "run a pipeline" un-defers pipeline_run', async () => {
  const session = newSession({ context: { assembler: 'v2', fullToolFloor: false } })
  await primeUserMessage(session, 'run a pipeline')
  const ids = lastAssembledTrace(session).fragments
                .filter(f => f.rendered).map(f => f.id)
  expect(ids).toContain('tool.pipeline_run')
})
```

**Acceptance:** test green; manually verify "hello" still does NOT include any of these tools.
**LOC:** ≈ 30 prod + 90 test = 120.

---

## Milestone 4 — Budget enforcer + dedup + folding (2 PRs, ~600 LOC)

### Task M4.T1 — `BudgetEnforcer.fit`

**File (new):** `src/core/agent/budgetEnforcer.ts`

```ts
export const PRIORITY_ORDER: Record<FragmentPriority, number> = {
  low: 0, medium: 1, high: 2, critical: 3,
}

export function fit(
  fragments: Array<{ frag: Fragment; bytes: number }>,
  policy: BudgetPolicy,
): { kept: Fragment[]; droppedIds: string[]; finalBytes: number }
```

Behaviour per spec §7.3.

**Test:** `test/core/agent/budgetEnforcer.test.ts`
```ts
test('under cap → no drops', () => { … })
test('over cap → drops lowest priority first', () => {
  const fragments = [
    { frag: critFrag('a', 1000), bytes: 1000 },
    { frag: highFrag('b', 1000), bytes: 1000 },
    { frag: lowFrag ('c', 1500), bytes: 1500 },
    { frag: medFrag ('d', 1500), bytes: 1500 },
  ]
  const out = fit(fragments, { capBytes: 3000, warnBytes: 2400, dropOrder: ['low','medium','high'], deterministic: true })
  expect(out.droppedIds).toEqual(['c','d'])
  expect(out.finalBytes).toBe(2000)
})
test('deterministic tie-break: alphabetically last drops first', () => { … })
test('cannot fit → still returns; finalBytes > capBytes', () => { … })
```

**Acceptance:** 4 tests green.
**LOC:** ≈ 110 prod + 140 test = 250.

### Task M4.T2 — `assemblePrompt` calls `fit` after rendering

**File (modified):** `src/core/agent/assembler.ts`

After collecting `rendered`, call `fit(rendered, policy ?? DEFAULT_BUDGET)`. Mark `dropped` on each `FragmentTrace` whose `frag.id ∈ droppedIds`. Concatenate only `kept` into `system` and `tools`.

**File (modified):** `src/core/agent/fragments/toolUsageFragment.ts`
- Replace the verbatim 248-byte block with the 1-line summary `Use tools to read/edit/run; ask before destructive (call expand_block('tool-usage') for full guidance).` (~110 bytes). The full body lives in `expandBlockTool.ts`'s `FOLDED_BLOCKS['tool-usage']`.

**File (new):** `src/core/agent/fragments/dedup.ts`
```ts
export function dedupSkillBodies(fragments: Fragment[], rendered: Map<string,string>): Fragment[] {
  // For each sys.skills.<name> fragment, if its body verbatim contains the
  // current sys.tools-usage fragment's render, drop the latter.
  // Implemented as a post-render hook in assemblePrompt.
}
```

**Test:** `test/core/agent/dedup.test.ts`
```ts
test('skill body containing tool-usage drops sys.tools-usage', () => {
  const skill = makeSkill({ body: 'Tool usage:\n  - Use tools to read files…' })
  const ctx = ctxWith(skill)
  const trace = assemblePrompt(ctx, …).trace
  expect(trace.droppedIds).toContain('sys.tools-usage')
})
```

**Acceptance:** dedup test green; M2 parity tests now skip the `tool-usage` fragment when the skill body matches (parity test gets a documented exemption).
**LOC:** ≈ 130 prod + 80 test = 210.

### Task M4.T3 — TUI status-line indicator

**File (modified):** `src/tui/StatusBar.tsx` (or wherever the status segments live)
Add a new segment `ctx`:
- Default rendering: `ctx 312/16000B` (dim text).
- When `lastTrace.cappedAtHard === true`: yellow color, append `(trim)`.
- Tooltip on hover (help command): "Context budget; press /doctor for breakdown."

**Subscriber:** a small in-memory ring buffer (`src/tui/contextTraceStore.ts`) listens on `bus.on('prompt', ev => store.push(ev))`, keeps last 1.

**Test (TUI snapshot):** `test/tui/StatusBar.contextSegment.test.tsx`
```tsx
test('renders ctx segment with bytes', () => {
  const r = render(<StatusBar lastTrace={{ totalBytes: 312, policy: { capBytes: 16000 } }} />)
  expect(r.lastFrame()).toContain('ctx 312/16000B')
})
test('renders yellow + (trim) when cappedAtHard', () => { … })
```

**Acceptance:** 2 tests green; manual run with `capBytes: 1000` flips the segment yellow.
**LOC:** ≈ 70 prod + 70 test = 140.

---

## Milestone 5 — Telemetry + /doctor + /stats + flag flip (2 PRs, ~700 LOC)

### Task M5.T1 — Emit `prompt.assembled`

**File (modified):** `src/core/agent/assembler.ts`

Replace the M1 placeholder type with the full `PromptAssembledEvent` from spec §6.4. At the end of `assemblePrompt`, if `deps?.bus`, call `deps.bus.emit('prompt', event)`.

**File (modified):** `src/core/agent/loop.ts:243`
- Pass `bus` into `assemblePrompt` deps.

**Test:** `test/core/agent/assembler.telemetry.test.ts`
```ts
test('emits prompt.assembled with breakdown', () => { /* per spec §8.6 */ })
test('breakdown sums to totalBytes', () => {
  const ev = capture()
  expect(ev.fragments.filter(f => !f.dropped).reduce((s,f)=>s+f.bytes,0)).toBe(ev.totalBytes)
})
```

**Acceptance:** both tests green.
**LOC:** ≈ 80 prod + 90 test = 170.

### Task M5.T2 — `/doctor` integration

**File (modified):** `src/slash/doctor.ts`

Add a "Last context assembly" section that consumes the ring buffer from M4.T3:

```
Last context assembly (turn ulid_xxx)
  total: 312 / 16000 B    (~52 tok BPE)
  system: 218 B (5 fragments)
  tools : 94 B  (12 fragments)
  dropped: (none)
  fragments:
    sys.header             92 B  ✓
    sys.env               145 B  ✓
    sys.tools-usage       110 B  ✓ (folded)
    sys.skills.<name>     0 B   - (not applicable)
    tool.Read             263 B  ✓
    …
```

**File (modified):** `src/core/doctor/<existing>.ts` — add a `lastContextAssembly` field to the doctor data struct.

**Test:** `test/slash/doctor.contextSection.test.ts`
```ts
test('doctor shows last context assembly when ring has an entry', () => {
  // push a synthetic event into the ring; run /doctor; assert "Last context assembly" appears
})
test('doctor shows "(none yet)" when ring is empty', () => { … })
```

**Acceptance:** both tests green; manual /doctor after a turn shows the table.
**LOC:** ≈ 140 prod + 100 test = 240.

### Task M5.T3 — `/stats` integration

**File (modified):** `src/slash/stats.ts`

Add a "Context (last 200 turns)" section:
```
Context (last 200 turns)
  bytes p50: 312    p99: 1840    cap: 16000
  drops freq:
    sys.memory          12 / 200 turns
    sys.harness-summary  3 / 200 turns
```

A new in-memory `RollingStats` (`src/core/stats/contextRolling.ts`) subscribes to `prompt.assembled`, keeps last 200 events, computes percentiles.

**Test:** `test/core/stats/contextRolling.test.ts` — feed 200 synthetic events with mixed sizes, assert p50/p99 match expected (use a known fixture distribution).

**Acceptance:** test green; `/stats` after several turns shows non-zero p50/p99.
**LOC:** ≈ 110 prod + 110 test = 220.

### Task M5.T4 — `--no-budget` CLI flag and default flip

**File (modified):** `src/cli.tsx` (top-level argv parsing)
- Recognize `--no-budget`. When present, override `policy.capBytes = Infinity` in the `assemblePrompt` deps wiring.
- Recognize `--assembler=legacy|v2`.

**File (modified):** `src/core/config/schema.ts`
- Flip `context.assembler` default from `'legacy'` to `'v2'`.
- Flip `context.fullToolFloor` default from `true` to `false`.
- Add deprecation comment on `'legacy'` referencing this spec.

**File (modified):** `src/cli.tsx` (startup banner)
- When `config.context.assembler === 'legacy'`, print a one-line dim warning:
  `[nuka] context.assembler='legacy' is deprecated; v2 will become the only option in next major.`

**Test (config):** `test/core/config/schema.test.ts`
```ts
test('default config now has assembler=v2', () => {
  const c = loadConfig({ home: '/tmp/empty', cwd: '/tmp/empty' })
  expect(c.context?.assembler).toBe('v2')
  expect(c.context?.fullToolFloor).toBe(false)
})
```

**Test (flag):** `test/cli/noBudget.test.ts`
```ts
test('--no-budget sets capBytes=Infinity', async () => {
  const result = await runCli(['--no-budget'], { dryRun: true })
  expect(result.deps.policy?.capBytes).toBe(Infinity)
})
```

**Acceptance:** both tests green; manual run with `--no-budget` and a 50 KB skill body confirms no drops occur; manual run with `--assembler=legacy` confirms today's behaviour.
**LOC:** ≈ 70 prod + 80 test = 150.

---

## Cross-cutting tasks

### CC-1 — Documentation updates

**Files (modified):**
- `README.md` — add a "Context efficiency" subsection explaining the budget and `--no-budget`.
- `docs/superpowers/specs/2026-04-23-nuka-rewrite-design.md` — add a one-line forward reference to Spec E in §6 (system prompt section).

**Acceptance:** `git diff` shows only the README + design-doc cross-reference; no code touched.
**LOC:** ≈ 90 docs.

### CC-2 — Migration recipe in `docs/superpowers/`

**File (new):** `docs/superpowers/migrations/2026-spec-e-context.md`
- For users on a release where `assembler: 'legacy'` is still the default: recipe for opting into v2.
- For users on the post-flip release: recipe for staying on legacy via `assembler: 'legacy'`.
- For plugin authors: how to add `appliesWhen` to a plugin tool to control its inclusion.

**Acceptance:** doc exists, > 80 lines.
**LOC:** ≈ 110 docs.

### CC-3 — `package.json` script wiring

Add:
```json
"scripts": {
  "measure-context": "node --loader ts-node/esm scripts/measure-context.ts",
  "measure-context:emit": "node --loader ts-node/esm scripts/measure-context.ts --emit-snapshot"
}
```

**Acceptance:** `npm run measure-context` invokes the M1 script; CI step `Measure context` (added to `.github/workflows/ci.yml` if applicable) is green.
**LOC:** ≈ 10.

---

## LOC summary

| Milestone | Production | Test | Docs | Total |
|-----------|-----------:|-----:|-----:|------:|
| M1 — Measurement | 245 | 105 | — | 350 |
| M2 — Fragment registry | 670 | 730 | — | 1,400 |
| M3 — Lazy tool injection | 470 | 450 | — | 920 |
| M4 — Budget + dedup + folding | 310 | 290 | — | 600 |
| M5 — Telemetry + /doctor + /stats + flip | 400 | 380 | — | 780 |
| CC — Docs / scripts | — | — | 210 | 210 |
| **TOTAL** | **2,095** | **1,955** | **210** | **~4,260** |

---

## Sequencing & dependencies

```
M1.T1 ──┐
M1.T2 ──┼──► M1.T3 ──► (baseline frozen; CI gate active)
        │
M1 done └──► M2.T1 ──► M2.T2 ──► M2.T3 ──► M2.T4 ──► (parity gate active)
                                           │
                   M2 done ────────────────┴──► M3.T1 ──► M3.T2 ──► M3.T3
                                                          │          │
                                                          └─► (≤2400 B snapshot bar)
                                                                     │
                                       M3 done ───────────────────── M4.T1 ──► M4.T2 ──► M4.T3
                                                                                          │
                                       M4 done ─────────────────────────────────────────  M5.T1 ──► M5.T2 ──► M5.T3 ──► M5.T4
                                                                                                                          │
                                                                          ────────────────────────────────────────────►  CC-1, CC-2, CC-3
```

Critical path: M1 → M2 → M3.T2 (snapshot test). Once M3.T2 lands, the spec's primary headline number (≤ 2,400 bytes) is enforced. M4 and M5 are "polish" relative to that bar — they make the system production-grade but do not move the headline.

---

## Per-task acceptance dashboard

| Task | Acceptance gate | Blocks | Blocked by |
|------|------|---------|------------|
| M1.T1 | promptTopic test green | M5.T1 | — |
| M1.T2 | measureContext returns 19 rows; grand-total ∈ [7.5KB, 8.5KB] | M1.T3, M3.T2 | — |
| M1.T3 | contextBaseline test green; fixture committed | (CI gate) | M1.T2 |
| M2.T1 | FragmentRegistry CRUD tests green | M2.T3, M2.T4 | — |
| M2.T2 | buildAssemblyContext 3 scenarios pass | M2.T4 | M2.T1 |
| M2.T3 | 30 fragment tests green | M2.T4 | M2.T1 |
| M2.T4 | 12-scenario parity test green; tcs `--no-emit` clean | M3.T1, M3.T2 | M2.T1, M2.T2, M2.T3 |
| M3.T1 | activeToolsForMany tests (both fullToolFloor flavours) green | M3.T2 | M2.T4 |
| M3.T2 | snapshot test ≤ 2,400 B; tool-not-available retry test green | M3.T3, M4.T2 | M3.T1 |
| M3.T3 | searchHint un-defer test green | M4 unblocked | M3.T2 |
| M4.T1 | fit() 4 unit tests green | M4.T2 | — (independent of M3) |
| M4.T2 | dedup test green; assembler integrates fit() | M4.T3, M5.T1 | M4.T1, M3.T2 |
| M4.T3 | StatusBar context segment test (2) green; manual TUI verification | M5.T2 | M4.T2 |
| M5.T1 | telemetry tests green | M5.T2, M5.T3 | M4.T2 |
| M5.T2 | /doctor section test (2) green | (M5 done) | M5.T1, M4.T3 |
| M5.T3 | /stats rolling test green | (M5 done) | M5.T1 |
| M5.T4 | config-default test + --no-budget test green | (release-ready) | M5.T1, M5.T2, M5.T3 |
| CC-1 | docs diff exists | — | M5.T4 |
| CC-2 | migration recipe ≥ 80 lines | — | M5.T4 |
| CC-3 | npm run measure-context green in CI | (CI) | M1.T2 |

---

## Definitions of done

A milestone is *done* when:

1. Every task in it ships its acceptance gate green in CI.
2. `npm run measure-context` is run against the merged main branch and the output is captured in the milestone-closing PR description.
3. For M3, M4, M5: the PR description quotes the new "hello" baseline byte count and confirms it is below the milestone target (M3: ≤ 2,400; M4: still ≤ 2,400 with budget enforcement live; M5: still ≤ 2,400 *as the new default*).
4. `tsc --noEmit` is clean.
5. No deprecation warnings other than the intentional `legacy` warning land in CI logs.

The spec is *complete* when M5.T4 lands: the default Nuka boot uses `assembler: 'v2'` with `fullToolFloor: false`, baseline ≤ 2,400 bytes, telemetry surfaces in `/doctor` and `/stats`, and `legacy` is one config-flip away for any user who needs it.

---

## Out-of-scope reminders (cross-checked against spec §4)

- Provider abstraction work belongs to **Spec D**. If a task here touches `src/core/provider/*.ts`, it must justify why in the PR.
- Prompt caching (Anthropic `cache_control` markers) is a separate spec — `2026-spec-?-prompt-caching-design.md`. The fragment registry is *cache-friendly* by construction (each fragment is a stable string), so a future caching spec can target individual fragments.
- The `'legacy'` code path **stays alive for one release after the M5.T4 flip**. Removing it is a separate task in the next major.

---

*End of plan.*
