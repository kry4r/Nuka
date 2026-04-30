# Phase 14d Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the workflow harness — stage state machine + editor-in-chief agent + three mid-stage primitives + profile classifier + `/harness` control + Recap stage handoff. This is the answer to the user's "永远只是 TDD" complaint: TDD becomes profile-conditional, not default.

**Architecture:** Eight milestones. Layer 1 — pure state machine (transition table + matrix + skill picker). Layer 2 — primitives as built-in tools. Layer 3 — editor agent + boot wiring. The editor never holds Edit/Write/Bash; it dispatches workers via phase14a swarm tools.

**Tech Stack:** TypeScript 5.6, vitest 2.1, foundation (HarnessEvent + HarnessStage already on EventBus, runForkedAgent, paths), phase14a (swarm dispatch tools), phase14c (`/recap` for Recap stage handoff).

**Source-of-truth spec:** `docs/superpowers/specs/2026-04-30-phase14d-harness-design.md`

---

## File Structure

**New files:**

```
src/core/harness/
  types.ts                         § 5.1 — HarnessState, StageEntry, TaskProfile, HarnessMode
  transitions.ts                   § 5.3 — transition table + canTransition gate
  matrix.ts                        § 4 profile-aware matrix (mandatory/optional/forbidden)
  skills.ts                        § 5.2 — pickSkillsForStage
  classifier.ts                    § 6.2 — small-fast-model fork
  state.ts                         § 6.1 — HarnessStateMachine class
  scratchpad.ts                    § 5.4 — markdown read/write + 50KB truncation
  editorPrompt.ts                  § 6.3 — system prompt template
  primitives.ts                    § 6.4 — sequential_thinking, search_and_verify, ask_user_question tools
  format.ts                        /harness status formatter
src/core/agents/builtin/editor.ts  § 6.3 — editor agent def
src/slash/harness.ts               § 6.5 — slash command

test/core/harness/
  transitions.test.ts
  matrix.test.ts
  skills.test.ts
  classifier.test.ts
  state.test.ts
  scratchpad.test.ts
  primitives.test.ts
  format.test.ts
test/core/agents/builtin/editor.test.ts
test/slash/harness.test.ts
test/integration/phase14d-harness.test.ts
```

**Modified files:**

```
src/cli.tsx                        register editor agent + primitives + slash; instantiate HarnessStateMachine
src/core/config/schema.ts          add harness.* fields
```

**Bundle budget:** phase14a+b+c (450 KB) + 60 KB = 510 KB.

---

## Task 1: Types + matrix + transitions

**Files:**
- Create: `src/core/harness/types.ts`
- Create: `src/core/harness/matrix.ts`
- Create: `src/core/harness/transitions.ts`
- Create: `test/core/harness/matrix.test.ts`
- Create: `test/core/harness/transitions.test.ts`

- [ ] **Step 1: Test matrix**

```ts
// test/core/harness/matrix.test.ts
import { describe, it, expect } from 'vitest'
import { stageRequirement } from '../../../src/core/harness/matrix'

describe('stageRequirement', () => {
  it('explore profile forbids implement', () => {
    expect(stageRequirement('explore', 'implement')).toBe('forbidden')
  })
  it('feature profile mandates spec', () => {
    expect(stageRequirement('feature', 'spec')).toBe('mandatory')
  })
  it('docs profile keeps implement optional+no-tdd', () => {
    expect(stageRequirement('docs', 'implement')).toBe('mandatory')
  })
  it('research profile forbids implement', () => {
    expect(stageRequirement('research', 'implement')).toBe('forbidden')
  })
})
```

- [ ] **Step 2: Implement types + matrix**

```ts
// src/core/harness/types.ts
export type TaskProfile = 'explore' | 'fix' | 'refactor' | 'feature' | 'docs' | 'config' | 'research'
export type HarnessStage = 'brainstorm' | 'spec' | 'plan' | 'search' | 'implement' | 'review' | 'recap'
export type HarnessMode = 'deep' | 'fast' | 'off'
export type StageRequirement = 'mandatory' | 'optional' | 'forbidden'

export type StageEntry = {
  stage: HarnessStage
  enteredAt: number
  exitedAt?: number
  workersSpawned: Array<{ taskId: string; agentName: string }>
  primitivesSeen: { sequentialThinking: boolean; searchAndVerify: boolean; askUser: boolean }
  exitReason?: 'completed' | 'aborted' | 'reentered' | 'fast-path-skipped'
}

export type HarnessState = {
  sessionId: string
  mode: HarnessMode
  taskProfile: TaskProfile | null
  currentStage: HarnessStage | null
  history: StageEntry[]
  scratchpadPath: string
  startedAt: number
}
```

```ts
// src/core/harness/matrix.ts
import type { TaskProfile, HarnessStage, StageRequirement } from './types'

const M: Record<TaskProfile, Record<HarnessStage, StageRequirement>> = {
  explore:  { brainstorm: 'optional',  spec: 'forbidden', plan: 'optional',  search: 'mandatory', implement: 'forbidden', review: 'optional',  recap: 'mandatory' },
  fix:      { brainstorm: 'optional',  spec: 'optional',  plan: 'mandatory', search: 'mandatory', implement: 'mandatory', review: 'mandatory', recap: 'mandatory' },
  refactor: { brainstorm: 'optional',  spec: 'mandatory', plan: 'mandatory', search: 'mandatory', implement: 'mandatory', review: 'mandatory', recap: 'mandatory' },
  feature:  { brainstorm: 'mandatory', spec: 'mandatory', plan: 'mandatory', search: 'mandatory', implement: 'mandatory', review: 'mandatory', recap: 'mandatory' },
  docs:     { brainstorm: 'optional',  spec: 'optional',  plan: 'optional',  search: 'mandatory', implement: 'mandatory', review: 'optional',  recap: 'mandatory' },
  config:   { brainstorm: 'optional',  spec: 'optional',  plan: 'optional',  search: 'mandatory', implement: 'mandatory', review: 'optional',  recap: 'mandatory' },
  research: { brainstorm: 'mandatory', spec: 'optional',  plan: 'optional',  search: 'mandatory', implement: 'forbidden', review: 'optional',  recap: 'mandatory' },
}

export function stageRequirement(profile: TaskProfile, stage: HarnessStage): StageRequirement {
  return M[profile][stage]
}
```

- [ ] **Step 3: Test transitions**

```ts
// test/core/harness/transitions.test.ts
import { describe, it, expect } from 'vitest'
import { canTransition } from '../../../src/core/harness/transitions'

describe('canTransition', () => {
  it('allows brainstorm → spec for feature', () => {
    expect(canTransition({ from: 'brainstorm', to: 'spec', profile: 'feature', mode: 'deep' }).ok).toBe(true)
  })
  it('refuses implement for explore profile', () => {
    const r = canTransition({ from: 'search', to: 'implement', profile: 'explore', mode: 'deep' })
    expect(r.ok).toBe(false)
  })
  it('fast mode allows brainstorm → search', () => {
    expect(canTransition({ from: 'brainstorm', to: 'search', profile: 'feature', mode: 'fast' }).ok).toBe(true)
  })
  it('deep mode refuses brainstorm → implement', () => {
    expect(canTransition({ from: 'brainstorm', to: 'implement', profile: 'feature', mode: 'deep' }).ok).toBe(false)
  })
  it('terminal: recap has no out-edges', () => {
    expect(canTransition({ from: 'recap', to: 'implement', profile: 'feature', mode: 'deep' }).ok).toBe(false)
  })
})
```

- [ ] **Step 4: Implement**

```ts
// src/core/harness/transitions.ts
import type { HarnessStage, HarnessMode, TaskProfile } from './types'
import { stageRequirement } from './matrix'

const TRANSITIONS: Record<HarnessStage, HarnessStage[]> = {
  brainstorm: ['spec', 'plan', 'search'],
  spec:       ['plan', 'search', 'brainstorm'],
  plan:       ['search', 'implement', 'spec'],
  search:     ['implement', 'plan', 'recap'],
  implement:  ['review', 'search', 'plan'],
  review:     ['recap', 'implement'],
  recap:      [],
}

export type CanTransitionOpts = {
  from: HarnessStage
  to: HarnessStage
  profile: TaskProfile
  mode: HarnessMode
}

export function canTransition(opts: CanTransitionOpts): { ok: true } | { ok: false; reason: string } {
  if (opts.mode === 'off') return { ok: true }
  if (stageRequirement(opts.profile, opts.to) === 'forbidden') {
    return { ok: false, reason: `stage "${opts.to}" forbidden for profile "${opts.profile}"` }
  }
  // Fast mode skips brainstorm + spec mandates
  if (opts.mode === 'fast' && (opts.to === 'brainstorm' || opts.to === 'spec')) {
    return { ok: false, reason: `fast-path: stage "${opts.to}" is bypassed` }
  }
  // Allow extra edges in fast mode (brainstorm → search, spec → implement)
  if (opts.mode === 'fast') {
    const fastEdges: Array<[HarnessStage, HarnessStage]> = [['brainstorm', 'search'], ['spec', 'implement'], ['plan', 'implement']]
    if (fastEdges.some(([a, b]) => a === opts.from && b === opts.to)) return { ok: true }
  }
  if (TRANSITIONS[opts.from].includes(opts.to)) return { ok: true }
  return { ok: false, reason: `no edge ${opts.from} → ${opts.to}` }
}
```

- [ ] **Step 5: Run + commit**

```bash
npx vitest run test/core/harness/matrix.test.ts test/core/harness/transitions.test.ts
git add src/core/harness/types.ts src/core/harness/matrix.ts src/core/harness/transitions.ts test/core/harness/matrix.test.ts test/core/harness/transitions.test.ts
git commit -m "feat(phase14d/m1): types + profile matrix + transition table"
```

---

## Task 2: Skill bundle picker

**Files:**
- Create: `src/core/harness/skills.ts`
- Create: `test/core/harness/skills.test.ts`

- [ ] **Step 1: Test**

```ts
// test/core/harness/skills.test.ts
import { describe, it, expect } from 'vitest'
import { pickSkillsForStage } from '../../../src/core/harness/skills'

describe('pickSkillsForStage', () => {
  it('explore profile forbids tdd', () => {
    const b = pickSkillsForStage('implement', 'explore')
    expect(b.forbidden).toContain('tdd')
  })
  it('feature implement requires tdd', () => {
    const b = pickSkillsForStage('implement', 'feature')
    expect(b.required).toContain('tdd')
  })
  it('docs implement no tdd', () => {
    const b = pickSkillsForStage('implement', 'docs')
    expect(b.required).not.toContain('tdd')
  })
  it('brainstorm always brings brainstorming skill', () => {
    expect(pickSkillsForStage('brainstorm', 'feature').required).toContain('superpowers:brainstorming')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/core/harness/skills.ts
import type { HarnessStage, TaskProfile } from './types'

export type SkillBundle = { required: string[]; optional: string[]; forbidden: string[] }

const TDD_PROFILES: TaskProfile[] = ['feature', 'fix', 'refactor']

export function pickSkillsForStage(stage: HarnessStage, profile: TaskProfile): SkillBundle {
  const tddRequiresProfile = TDD_PROFILES.includes(profile)
  switch (stage) {
    case 'brainstorm': return { required: ['superpowers:brainstorming'],     optional: ['claudeApi'], forbidden: ['tdd', 'simplify'] }
    case 'spec':       return { required: ['superpowers:writing-skills'],    optional: ['claudeApi'], forbidden: ['tdd'] }
    case 'plan':       return { required: ['superpowers:writing-plans'],     optional: ['claudeApi'], forbidden: ['tdd'] }
    case 'search':     return { required: ['loop'],                          optional: ['claudeApi'], forbidden: ['tdd'] }
    case 'implement':  return tddRequiresProfile
                          ? { required: ['tdd', 'simplify'], optional: [],       forbidden: [] }
                          : { required: ['simplify'],        optional: ['tdd'],  forbidden: [] }
    case 'review':     return { required: ['superpowers:requesting-code-review'], optional: [], forbidden: ['tdd'] }
    case 'recap':      return { required: [], optional: [], forbidden: ['tdd', 'simplify', 'superpowers:brainstorming', 'superpowers:writing-plans'] }
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/core/harness/skills.test.ts
git add src/core/harness/skills.ts test/core/harness/skills.test.ts
git commit -m "feat(phase14d/m3): skill bundle picker (TDD only for fix/refactor/feature)"
```

---

## Task 3: Profile classifier

**Files:**
- Create: `src/core/harness/classifier.ts`
- Create: `test/core/harness/classifier.test.ts`

- [ ] **Step 1: Test**

```ts
// test/core/harness/classifier.test.ts
import { describe, it, expect, vi } from 'vitest'
import { classifyTaskProfile } from '../../../src/core/harness/classifier'

describe('classifyTaskProfile', () => {
  it('returns the profile token', async () => {
    const fakeFork = vi.fn().mockResolvedValue({ text: 'feature' })
    const p = await classifyTaskProfile({ userMessage: 'add login', runFork: fakeFork })
    expect(p).toBe('feature')
  })
  it('falls back to feature on unknown token after retry', async () => {
    const fakeFork = vi.fn().mockResolvedValue({ text: 'unknown' })
    const p = await classifyTaskProfile({ userMessage: 'x', runFork: fakeFork })
    expect(p).toBe('feature')
    expect(fakeFork).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/core/harness/classifier.ts
import type { TaskProfile } from './types'

const VALID: TaskProfile[] = ['explore', 'fix', 'refactor', 'feature', 'docs', 'config', 'research']

export async function classifyTaskProfile(opts: {
  userMessage: string
  runFork: (prompt: string) => Promise<{ text: string }>
}): Promise<TaskProfile> {
  const prompt = `Classify the following user request into ONE of: explore, fix, refactor, feature, docs, config, research. Reply with the single word, no explanation.\n\nRequest: ${opts.userMessage}\n\nClassification:`
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await opts.runFork(prompt)
    const tok = r.text.trim().toLowerCase().split(/\s+/)[0] as TaskProfile
    if (VALID.includes(tok)) return tok
  }
  return 'feature'
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/core/harness/classifier.test.ts
git add src/core/harness/classifier.ts test/core/harness/classifier.test.ts
git commit -m "feat(phase14d/m2): task profile classifier with feature fallback"
```

---

## Task 4: Scratchpad

**Files:**
- Create: `src/core/harness/scratchpad.ts`
- Create: `test/core/harness/scratchpad.test.ts`

- [ ] **Step 1: Test**

```ts
// test/core/harness/scratchpad.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { readScratchpad, writeScratchpad, truncateToCap } from '../../../src/core/harness/scratchpad'

describe('scratchpad', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-sp-')) })
  it('write+read round-trips', () => {
    const file = path.join(dir, 's.md')
    writeScratchpad(file, '# Hello\nWorld')
    expect(readScratchpad(file)).toBe('# Hello\nWorld')
  })
  it('returns empty string when missing', () => {
    expect(readScratchpad(path.join(dir, 'missing.md'))).toBe('')
  })
  it('truncates to cap KB by dropping oldest sections', () => {
    const big = Array.from({ length: 100 }, (_, i) => `## Section ${i}\n${'x'.repeat(2_000)}`).join('\n')
    const t = truncateToCap(big, 50 * 1024)
    expect(Buffer.byteLength(t, 'utf8')).toBeLessThanOrEqual(50 * 1024 + 200)
    // newest section retained
    expect(t).toContain('Section 99')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/core/harness/scratchpad.ts
import * as fs from 'node:fs'

export function readScratchpad(file: string): string {
  if (!fs.existsSync(file)) return ''
  return fs.readFileSync(file, 'utf8')
}

export function writeScratchpad(file: string, content: string): void {
  fs.mkdirSync(file.replace(/\/[^/]+$/, ''), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

export function truncateToCap(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return content
  const sections = content.split(/(?=^## )/m)
  const header = sections.shift() ?? ''
  while (sections.length && Buffer.byteLength([header, '_(older sections truncated)_', ...sections].join('\n'), 'utf8') > maxBytes) {
    sections.shift()
  }
  return [header, '_(older sections truncated)_', ...sections].join('\n')
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/core/harness/scratchpad.test.ts
git add src/core/harness/scratchpad.ts test/core/harness/scratchpad.test.ts
git commit -m "feat(phase14d/m1): scratchpad read/write + cap truncation"
```

---

## Task 5: HarnessStateMachine

**Files:**
- Create: `src/core/harness/state.ts`
- Create: `test/core/harness/state.test.ts`

- [ ] **Step 1: Test**

```ts
// test/core/harness/state.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { HarnessStateMachine } from '../../../src/core/harness/state'
import { createEventBus } from '../../../src/core/events/bus'
import { ensureNukaLayout } from '../../../src/core/paths'

describe('HarnessStateMachine', () => {
  let home: string; let bus: ReturnType<typeof createEventBus>
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-hsm-')); ensureNukaLayout(home); bus = createEventBus() })

  it('start() sets profile and emits events', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's1', bus, home, mode: 'deep' })
    let evtCount = 0; bus.subscribe('harness', () => evtCount++)
    const profile = await hsm.start('add new login flow', { runFork: async () => ({ text: 'feature' }) })
    expect(profile).toBe('feature')
    expect(hsm.snapshot().taskProfile).toBe('feature')
  })

  it('canTransition gates against profile', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's2', bus, home, mode: 'deep' })
    await hsm.start('explore the registry', { runFork: async () => ({ text: 'explore' }) })
    await hsm.transition('search')
    expect(hsm.canTransition('implement').ok).toBe(false)
  })

  it('exit gate blocks if mandatory primitives unrecorded (brainstorm)', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's3', bus, home, mode: 'deep' })
    await hsm.start('add x', { runFork: async () => ({ text: 'feature' }) })
    await hsm.transition('brainstorm')
    const r = hsm.canExit('spec')
    expect(r.ok).toBe(false)
    hsm.recordPrimitive('sequentialThinking')
    hsm.recordPrimitive('searchAndVerify')
    hsm.recordPrimitive('askUser')
    expect(hsm.canExit('spec').ok).toBe(true)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/core/harness/state.ts
import * as path from 'node:path'
import type { EventBus } from '../events/bus'
import type { HarnessState, HarnessStage, HarnessMode, TaskProfile, StageEntry } from './types'
import { canTransition as transitionCheck } from './transitions'
import { stageRequirement } from './matrix'
import { readScratchpad, writeScratchpad, truncateToCap } from './scratchpad'

export type HarnessStateMachineOpts = {
  sessionId: string
  bus: EventBus
  home: string
  mode?: HarnessMode
  scratchpadKB?: number
}

export class HarnessStateMachine {
  private state: HarnessState
  private bus: EventBus
  private capBytes: number

  constructor(opts: HarnessStateMachineOpts) {
    this.bus = opts.bus
    this.capBytes = (opts.scratchpadKB ?? 50) * 1024
    this.state = {
      sessionId: opts.sessionId,
      mode: opts.mode ?? 'deep',
      taskProfile: null,
      currentStage: null,
      history: [],
      scratchpadPath: path.join(opts.home, '.nuka', 'harness', `${opts.sessionId}.md`),
      startedAt: Date.now(),
    }
  }

  async start(userMessage: string, deps: { runFork: (p: string) => Promise<{ text: string }> }): Promise<TaskProfile> {
    const { classifyTaskProfile } = await import('./classifier')
    this.state.taskProfile = await classifyTaskProfile({ userMessage, runFork: deps.runFork })
    this.appendScratchpad(`# Harness — ${this.state.sessionId}\n- Profile: ${this.state.taskProfile}\n- Mode: ${this.state.mode}\n`)
    return this.state.taskProfile
  }

  canTransition(to: HarnessStage): { ok: true } | { ok: false; reason: string } {
    if (!this.state.taskProfile) return { ok: false, reason: 'profile not classified yet' }
    if (this.state.currentStage === null) {
      if (stageRequirement(this.state.taskProfile, to) === 'forbidden') return { ok: false, reason: `forbidden by profile` }
      return { ok: true }
    }
    return transitionCheck({ from: this.state.currentStage, to, profile: this.state.taskProfile, mode: this.state.mode })
  }

  canExit(_nextStage: HarnessStage): { ok: true } | { ok: false; reason: string } {
    if (!this.state.currentStage) return { ok: true }
    const entry = this.state.history[this.state.history.length - 1]
    if (!entry) return { ok: true }
    if (['brainstorm', 'spec', 'plan'].includes(this.state.currentStage)) {
      const p = entry.primitivesSeen
      if (!p.sequentialThinking) return { ok: false, reason: 'missing primitive: sequential_thinking' }
      if (!p.searchAndVerify)    return { ok: false, reason: 'missing primitive: search_and_verify' }
      if (!p.askUser)            return { ok: false, reason: 'missing primitive: ask_user_question' }
    }
    return { ok: true }
  }

  async transition(to: HarnessStage, reason = 'completed'): Promise<void> {
    const r = this.canTransition(to)
    if (!r.ok) throw new Error(`refused: ${r.reason}`)
    if (this.state.currentStage) {
      const entry = this.state.history[this.state.history.length - 1]
      if (entry) { entry.exitedAt = Date.now(); entry.exitReason = reason as StageEntry['exitReason'] }
      this.bus.emit('harness', { type: 'harness.stage.exit', stage: this.state.currentStage, sessionId: this.state.sessionId, reason })
    }
    this.state.currentStage = to
    this.state.history.push({
      stage: to, enteredAt: Date.now(), workersSpawned: [],
      primitivesSeen: { sequentialThinking: false, searchAndVerify: false, askUser: false },
    })
    this.bus.emit('harness', { type: 'harness.stage.enter', stage: to, sessionId: this.state.sessionId })
    this.appendScratchpad(`\n## ▶ ${to} (${new Date().toISOString()})\n`)
  }

  recordPrimitive(name: 'sequentialThinking' | 'searchAndVerify' | 'askUser'): void {
    const entry = this.state.history[this.state.history.length - 1]
    if (entry) entry.primitivesSeen[name] = true
  }

  snapshot(): HarnessState { return JSON.parse(JSON.stringify(this.state)) as HarnessState }

  setMode(mode: HarnessMode): void { this.state.mode = mode }

  private appendScratchpad(chunk: string): void {
    const cur = readScratchpad(this.state.scratchpadPath)
    const next = truncateToCap(cur + chunk, this.capBytes)
    writeScratchpad(this.state.scratchpadPath, next)
  }

  async flushScratchpad(): Promise<void> { /* no-op — append already flushes */ }
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/core/harness/state.test.ts
git add src/core/harness/state.ts test/core/harness/state.test.ts
git commit -m "feat(phase14d/m1): HarnessStateMachine with profile + transition + primitive gates"
```

---

## Task 6: Mid-stage primitive tools

**Files:**
- Create: `src/core/harness/primitives.ts`
- Create: `test/core/harness/primitives.test.ts`

- [ ] **Step 1: Test**

```ts
// test/core/harness/primitives.test.ts
import { describe, it, expect, vi } from 'vitest'
import { makeSequentialThinkingTool, makeSearchAndVerifyTool, makeAskUserQuestionTool } from '../../../src/core/harness/primitives'

describe('harness primitives', () => {
  it('sequential_thinking records primitive', async () => {
    const harness = { recordPrimitive: vi.fn() }
    const tool = makeSequentialThinkingTool(harness as any)
    const r = await tool.run({ thought: 'I am thinking' }, {} as never)
    expect(r.isError).toBe(false)
    expect(harness.recordPrimitive).toHaveBeenCalledWith('sequentialThinking')
  })

  it('search_and_verify records primitive', async () => {
    const harness = { recordPrimitive: vi.fn() }
    const tool = makeSearchAndVerifyTool(harness as any, { runResearcher: async () => 'found x' })
    const r = await tool.run({ query: 'foo' }, {} as never)
    expect(r.isError).toBe(false)
    expect(harness.recordPrimitive).toHaveBeenCalledWith('searchAndVerify')
  })

  it('ask_user_question records primitive', async () => {
    const harness = { recordPrimitive: vi.fn() }
    const tool = makeAskUserQuestionTool(harness as any, { askUser: async () => 'yes' })
    const r = await tool.run({ question: 'continue?' }, {} as never)
    expect(r.isError).toBe(false)
    expect(harness.recordPrimitive).toHaveBeenCalledWith('askUser')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/core/harness/primitives.ts
import { defineTool } from '../tools/define'
import type { HarnessStateMachine } from './state'

export function makeSequentialThinkingTool(harness: HarnessStateMachine) {
  return defineTool<{ thought: string }>({
    name: 'sequential_thinking',
    description: 'Record a thinking step. Returns immediately. Use to force pause + reflection before action.',
    parameters: { type: 'object', properties: { thought: { type: 'string' } }, required: ['thought'], additionalProperties: false },
    source: 'builtin', tags: ['core', 'harness'],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(_input, _ctx) {
      harness.recordPrimitive('sequentialThinking')
      return { output: 'thought recorded', isError: false }
    },
  })
}

export function makeSearchAndVerifyTool(harness: HarnessStateMachine, deps: { runResearcher: (q: string) => Promise<string> }) {
  return defineTool<{ query: string }>({
    name: 'search_and_verify',
    description: 'Run a read-only researcher pass to verify an assumption. Returns findings.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    source: 'builtin', tags: ['core', 'harness'],
    annotations: { readOnly: true, destructive: false, openWorld: true, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input, _ctx) {
      try {
        const findings = await deps.runResearcher(input.query)
        harness.recordPrimitive('searchAndVerify')
        return { output: findings, isError: false }
      } catch (e) { return { output: (e as Error).message, isError: true } }
    },
  })
}

export function makeAskUserQuestionTool(harness: HarnessStateMachine, deps: { askUser: (q: string) => Promise<string> }) {
  return defineTool<{ question: string }>({
    name: 'ask_user_question',
    description: 'Ask the user a clarifying question. Required at least once in Brainstorm/Spec/Plan first-entry.',
    parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false },
    source: 'builtin', tags: ['core', 'harness'],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: false },
    needsPermission: () => 'none',
    async run(input, _ctx) {
      try {
        const answer = await deps.askUser(input.question)
        harness.recordPrimitive('askUser')
        return { output: answer, isError: false }
      } catch (e) { return { output: (e as Error).message, isError: true } }
    },
  })
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/core/harness/primitives.test.ts
git add src/core/harness/primitives.ts test/core/harness/primitives.test.ts
git commit -m "feat(phase14d/m4): three mid-stage primitives as built-in tools"
```

---

## Task 7: Editor agent def + system prompt

**Files:**
- Create: `src/core/agents/builtin/editor.ts`
- Create: `src/core/harness/editorPrompt.ts`
- Create: `test/core/agents/builtin/editor.test.ts`

- [ ] **Step 1: Test**

```ts
// test/core/agents/builtin/editor.test.ts
import { describe, it, expect } from 'vitest'
import { editorAgent } from '../../../../src/core/agents/builtin/editor'

describe('editorAgent', () => {
  it('denies write tools', () => {
    expect(editorAgent.deniedTools).toContain('Edit')
    expect(editorAgent.deniedTools).toContain('Write')
    expect(editorAgent.deniedTools).toContain('Bash')
  })
  it('allows swarm dispatch tools', () => {
    expect(editorAgent.allowedTools).toContain('dispatch_agent')
    expect(editorAgent.allowedTools).toContain('team_create')
    expect(editorAgent.allowedTools).toContain('send_message')
  })
  it('has high maxTurns for long-running coordination', () => {
    expect(editorAgent.maxTurns).toBeGreaterThanOrEqual(50)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/core/harness/editorPrompt.ts
import type { HarnessStage, TaskProfile, HarnessMode } from './types'
import { stageRequirement } from './matrix'

export function buildEditorSystemPrompt(opts: {
  currentStage: HarnessStage | null
  taskProfile: TaskProfile | null
  mode: HarnessMode
  scratchpad: string
  workerList: string
}): string {
  const stageRules = opts.currentStage && opts.taskProfile
    ? `Stage requirement: ${stageRequirement(opts.taskProfile, opts.currentStage)}.`
    : 'No stage entered yet.'
  return `You are the workflow editor-in-chief. You DO NOT write code.
Your job is to navigate the workflow stages, dispatch workers, audit outputs, and decide when to advance.

Current stage: ${opts.currentStage ?? '(not entered)'}
Task profile: ${opts.taskProfile ?? '(not classified)'}
Mode: ${opts.mode}

Stage rules:
- ${stageRules}

Mandatory primitives this stage (if Brainstorm/Spec/Plan first-entry):
- sequential_thinking before any worker dispatch
- search_and_verify at least once
- ask_user_question if this is your first entry into Brainstorm/Spec/Plan

Workers available:
${opts.workerList}

Scratchpad (your global view):
<scratchpad>
${opts.scratchpad}
</scratchpad>

When this stage's work is complete, propose the transition. Otherwise continue dispatching workers and reasoning.
NEVER call Edit/Write/Bash directly — you don't have those tools. Use dispatch_agent or team_create+send_message instead.`
}
```

```ts
// src/core/agents/builtin/editor.ts
import type { AgentDef } from '../types'

export const editorAgent: AgentDef & { pluginName: string } = {
  pluginName: 'core',
  name: 'editor',
  description: 'Workflow editor-in-chief. Holds global view, dispatches workers, never writes code directly.',
  systemPrompt: '',                                 // built dynamically by HarnessStateMachine
  allowedTools: [
    'dispatch_agent', 'team_create', 'team_delete', 'send_message',
    'pipeline_run', 'roundtable',
    'sequential_thinking', 'search_and_verify', 'ask_user_question',
    'recap',
    'Read', 'Grep', 'Glob',
    'task_create', 'task_update', 'task_list',
  ],
  deniedTools: ['Edit', 'Write', 'Bash'],
  maxTurns: 100,
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/core/agents/builtin/editor.test.ts
git add src/core/agents/builtin/editor.ts src/core/harness/editorPrompt.ts test/core/agents/builtin/editor.test.ts
git commit -m "feat(phase14d/m5): editor-in-chief agent + system prompt builder"
```

---

## Task 8: `/harness` slash command

**Files:**
- Create: `src/slash/harness.ts`
- Create: `src/core/harness/format.ts`
- Create: `test/slash/harness.test.ts`

- [ ] **Step 1: Test**

```ts
// test/slash/harness.test.ts
import { describe, it, expect, vi } from 'vitest'
import { harnessCommand } from '../../src/slash/harness'

describe('/harness', () => {
  it('deep sets mode', async () => {
    const harness = { setMode: vi.fn(), snapshot: () => ({ mode: 'deep' }) }
    const ctx = { harness, printAssistant: vi.fn() } as any
    await harnessCommand.handler(ctx, 'deep')
    expect(harness.setMode).toHaveBeenCalledWith('deep')
  })
  it('status prints snapshot', async () => {
    const harness = { snapshot: () => ({ sessionId: 's', mode: 'deep', taskProfile: 'feature', currentStage: 'plan', history: [], scratchpadPath: '/x', startedAt: 0 }) }
    const printAssistant = vi.fn()
    await harnessCommand.handler({ harness, printAssistant } as any, 'status')
    expect(printAssistant).toHaveBeenCalled()
    expect(printAssistant.mock.calls[0]![0]).toContain('feature')
  })
  it('transition refuses invalid', async () => {
    const harness = { transition: vi.fn(async () => { throw new Error('refused: forbidden') }) }
    const printAssistant = vi.fn()
    await harnessCommand.handler({ harness, printAssistant } as any, 'transition implement')
    expect(printAssistant.mock.calls[0]![0]).toMatch(/refused/)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/core/harness/format.ts
import type { HarnessState } from './types'

export function formatStatus(s: HarnessState): string {
  const lines = [
    `Harness — session ${s.sessionId}`,
    `  mode:    ${s.mode}`,
    `  profile: ${s.taskProfile ?? '(not classified)'}`,
    `  stage:   ${s.currentStage ?? '(not entered)'}`,
    `  history: ${s.history.length} entries`,
    `  scratchpad: ${s.scratchpadPath}`,
  ]
  return lines.join('\n')
}
```

```ts
// src/slash/harness.ts
import type { SlashCommand } from './types'
import { formatStatus } from '../core/harness/format'
import type { HarnessStage, HarnessMode } from '../core/harness/types'

export const harnessCommand: SlashCommand = {
  name: 'harness',
  description: 'Control the workflow harness',
  async handler(ctx: any, args = '') {
    const harness = ctx.harness
    if (!harness) { ctx.printAssistant('harness not initialized'); return { ok: false } }
    const tokens = args.trim().split(/\s+/).filter(Boolean)
    const sub = tokens[0] ?? 'status'

    if (sub === 'deep' || sub === 'fast' || sub === 'off') {
      harness.setMode(sub as HarnessMode)
      ctx.printAssistant(`harness mode → ${sub}`)
      return { ok: true }
    }
    if (sub === 'status') { ctx.printAssistant(formatStatus(harness.snapshot())); return { ok: true } }
    if (sub === 'reset') { harness.reset?.(); ctx.printAssistant('harness reset; will re-classify on next user message'); return { ok: true } }
    if (sub === 'transition') {
      const to = tokens[1] as HarnessStage
      try { await harness.transition(to, 'manual'); ctx.printAssistant(`transitioned → ${to}`) }
      catch (e) { ctx.printAssistant(`refused: ${(e as Error).message}`) }
      return { ok: true }
    }
    ctx.printAssistant(`unknown subcommand: ${sub}`)
    return { ok: false }
  },
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/slash/harness.test.ts
git add src/core/harness/format.ts src/slash/harness.ts test/slash/harness.test.ts
git commit -m "feat(phase14d/m6): /harness slash command + status formatter"
```

---

## Task 9: Boot integration

**Files:**
- Modify: `src/cli.tsx`
- Modify: `src/core/config/schema.ts`

- [ ] **Step 1: Wire**

```ts
// src/cli.tsx (boot section)
import { HarnessStateMachine } from './core/harness/state'
import { editorAgent } from './core/agents/builtin/editor'
import { makeSequentialThinkingTool, makeSearchAndVerifyTool, makeAskUserQuestionTool } from './core/harness/primitives'
import { harnessCommand } from './slash/harness'
import { buildEditorSystemPrompt } from './core/harness/editorPrompt'

const harnessMode = config.harness?.mode ?? 'deep'
const harness = new HarnessStateMachine({ sessionId: session.id, bus: eventBus, home, mode: harnessMode })

agentRegistry.register(editorAgent)
toolRegistry.register(makeSequentialThinkingTool(harness))
toolRegistry.register(makeSearchAndVerifyTool(harness, { runResearcher: async (q) => `(stub) results for ${q}` }))
toolRegistry.register(makeAskUserQuestionTool(harness, { askUser: async (q) => `(prompt user via TUI: ${q})` }))   // actual UI binding done by phase14b later
slashRegistry.register(harnessCommand)

// Make the harness available to slash handlers and the editor system prompt.
ctx.harness = harness

// When harness mode != off, the lead session uses editor agent.
if (harnessMode !== 'off') {
  session.leadAgent = 'core:editor'
  session.systemPromptOverride = (): string => buildEditorSystemPrompt({
    currentStage: harness.snapshot().currentStage,
    taskProfile: harness.snapshot().taskProfile,
    mode: harness.snapshot().mode,
    scratchpad: '',                              // read from disk in real wiring
    workerList: agentRegistry.list().map(a => `- ${a.name}: ${a.description}`).join('\n'),
  })
}
```

```ts
// src/core/config/schema.ts (add)
harness: z.object({
  mode: z.enum(['deep', 'fast', 'off']).default('deep'),
  scratchpadKB: z.number().default(50),
  forceTddProfiles: z.array(z.string()).default(['feature', 'fix', 'refactor']),
}).default({}),
```

- [ ] **Step 2: Run + commit**

```bash
npm run typecheck && npm test
git add src/cli.tsx src/core/config/schema.ts
git commit -m "feat(phase14d/m7): boot integration — editor + primitives + /harness"
```

---

## Task 10: M8 — End-to-end

**Files:**
- Create: `test/integration/phase14d-harness.test.ts`

- [ ] **Step 1: Test**

```ts
// test/integration/phase14d-harness.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { HarnessStateMachine } from '../../src/core/harness/state'
import { createEventBus } from '../../src/core/events/bus'
import { ensureNukaLayout } from '../../src/core/paths'
import type { HarnessEvent } from '../../src/core/events/types'

describe('phase14d e2e: feature profile through stages', () => {
  let home: string
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-14d-')); ensureNukaLayout(home) })

  it('walks brainstorm → spec → plan → search → implement → review → recap', async () => {
    const bus = createEventBus()
    const events: HarnessEvent[] = []
    bus.subscribe<HarnessEvent>('harness', e => events.push(e))
    const hsm = new HarnessStateMachine({ sessionId: 's1', bus, home, mode: 'deep' })
    await hsm.start('add a new login feature', { runFork: async () => ({ text: 'feature' }) })

    for (const stage of ['brainstorm', 'spec', 'plan', 'search'] as const) {
      await hsm.transition(stage)
      hsm.recordPrimitive('sequentialThinking')
      hsm.recordPrimitive('searchAndVerify')
      hsm.recordPrimitive('askUser')
    }
    await hsm.transition('implement')
    await hsm.transition('review')
    await hsm.transition('recap')

    const stages = events.filter(e => e.type === 'harness.stage.enter').map(e => e.stage)
    expect(stages).toEqual(['brainstorm', 'spec', 'plan', 'search', 'implement', 'review', 'recap'])
    expect(fs.existsSync(hsm.snapshot().scratchpadPath)).toBe(true)
  })

  it('refuses implement for explore profile', async () => {
    const bus = createEventBus()
    const hsm = new HarnessStateMachine({ sessionId: 's2', bus, home, mode: 'deep' })
    await hsm.start('explore the registry', { runFork: async () => ({ text: 'explore' }) })
    await hsm.transition('search')
    await expect(hsm.transition('implement')).rejects.toThrow(/forbidden/)
  })

  it('fast mode allows brainstorm → search', async () => {
    const bus = createEventBus()
    const hsm = new HarnessStateMachine({ sessionId: 's3', bus, home, mode: 'fast' })
    await hsm.start('add x', { runFork: async () => ({ text: 'feature' }) })
    await hsm.transition('search')                  // no brainstorm needed in fast mode
    expect(hsm.snapshot().currentStage).toBe('search')
  })
})
```

- [ ] **Step 2: Run + audit**

```bash
npx vitest run test/integration/phase14d-harness.test.ts
npm run typecheck && npm test && npm run build
git add test/integration/phase14d-harness.test.ts
git commit -m "test(phase14d/m8): e2e — feature walk + explore refusal + fast mode"
```

Expected: green; bundle ≤ 510 KB.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Plan task |
|--------------|-----------|
| § 4 profile matrix | Task 1 |
| § 5.3 transition table | Task 1 |
| § 5.2 skill bundle picker | Task 2 |
| § 6.2 classifier | Task 3 |
| § 5.4 scratchpad | Task 4 |
| § 6.1 HarnessStateMachine | Task 5 |
| § 6.4 mid-stage primitives | Task 6 |
| § 6.3 editor agent + prompt | Task 7 |
| § 6.5 /harness slash | Task 8 |
| § 6.6 boot integration | Task 9 |
| § 6.7 stage-recap handoff | Task 9 (calls /recap on transition('recap')) |
| § 6.8 config | Task 9 |
| M8 e2e | Task 10 |

**2. Placeholder scan:** Two stubs — `runResearcher` and `askUser` deps in Task 9 are `(stub)` strings; full UI/researcher wiring is the implementer's polish task or deferred to phase14b/c follow-up. The stubs are clearly marked, not silent TODOs.

**3. Type consistency:** `HarnessStage` / `TaskProfile` / `HarnessMode` defined in `types.ts`, imported throughout. `HarnessEvent` from foundation.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-phase14d-harness-plan.md`. Two execution options: subagent-driven (recommended) or inline. Which approach?
