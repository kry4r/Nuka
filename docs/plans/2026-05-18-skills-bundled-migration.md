# SkillsLoader Bundled 17 Skills Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the 17 bundled skills from `Nuka-Code/src/skills/bundled/` into Nuka's existing `src/core/skill/bundled.ts` registry — tier-1 (5 zero-dependency skills) implemented in full as turnkey tasks; tier-2 (12 remaining skills, including MCP-tainted ones marked DROP) deferred to an appendix with surface-mapping notes.

**Architecture:** Nuka-Code skills are slash-commands with a dynamic `getPromptForCommand(args, ctx)`; Nuka skills are keyword-/session-activated context injectors with a static `body: string`. The shape gap is bridged by (a) extending `BundledSkillDefinition` with an optional `buildBody?: () => string` factory so dynamic content (markdown tables, env-dependent text) can be computed at registration time, and (b) explicitly choosing `when` per skill (`on-session-start` for always-on, `{ keyword: [...] }` for context-budget-sensitive ones). All MCP-dependent skills (`claudeInChrome`, `scheduleRemoteAgents`) are flagged DROP — Nuka rejects MCP entirely. Per-process registration is wired through a new `initBundledSkills()` entry, invoked from the existing loader bootstrap before the disk-skill load runs so registry-resolution order is `bundled → global → project`.

**Tech Stack:** TypeScript (strict), Vitest

**Out-of-band decisions (load-bearing):**
- `BundledSkillDefinition.buildBody?: () => string` is the dynamic-content escape hatch. When set, `registerBundledSkill` resolves it eagerly at registration time and the resulting string becomes the `Skill.body`. Async dynamic content is out of scope for this plan (none of the tier-1 skills need it; tier-2 `debug` is the only one and is deferred).
- Argument input (`/skill <name> <args>`) is OUT of scope. Nuka skills are keyword-activated, not slash-invoked. Skills that took args in Nuka-Code (debug, lorem-ipsum) lose that surface; the ported skill body documents the new keyword-trigger semantics.
- The MCP rejection covers two skills outright: `claudeInChrome` (imports `@ant/claude-for-chrome-mcp`) and `scheduleRemoteAgents` (imports `MCPServerConnection`). Both are listed in the deferred appendix with a `DROP — MCP` flag and no porting task.
- `claudeApi` requires a 247 KB markdown content bundle (`claudeApiContent.ts`). Deferred — porting the content bundle is its own multi-day task and is not in tier-1.
- Feature flags from Nuka-Code (`feature('KAIROS')`, `feature('AGENT_TRIGGERS')`, etc.) are replaced with Nuka env opt-ins (`NUKA_SKILL_<NAME>=1`) where retained, or dropped where the gated skill itself is deferred.

**Skill inventory (all 17):**

| # | Nuka-Code name | Tier | Nuka-Code path | Status |
|---|---|---|---|---|
| 1 | `lorem-ipsum` | T1 | `src/skills/bundled/loremIpsum.ts` | PORT |
| 2 | `simplify` | T1 | `src/skills/bundled/simplify.ts` | PORT |
| 3 | `stuck` | T1 | `src/skills/bundled/stuck.ts` | PORT |
| 4 | `remember` | T1 | `src/skills/bundled/remember.ts` | PORT |
| 5 | `skillify` | T1 | `src/skills/bundled/skillify.ts` | PORT |
| 6 | `debug` | T2 | `src/skills/bundled/debug.ts` | DEFER — needs debug-log surface |
| 7 | `keybindings-help` | T2 | `src/skills/bundled/keybindings.ts` | DEFER — needs `keybindings/` module |
| 8 | `verify` | T2 | `src/skills/bundled/verify.ts` | DEFER — content bundle |
| 9 | `update-config` | T2 | `src/skills/bundled/updateConfig.ts` | DEFER — needs SettingsSchema |
| 10 | `batch` | T2 | `src/skills/bundled/batch.ts` | DEFER — needs AgentTool + ENTER_PLAN_MODE const |
| 11 | `claude-api` | T2 | `src/skills/bundled/claudeApi.ts` | DEFER — 247 KB content bundle |
| 12 | `loop` | T2 | `src/skills/bundled/loop.ts` | DEFER — needs Nuka cron tool names |
| 13 | `dream` | T2 | `src/skills/bundled/dream.ts` (KAIROS-gated) | DEFER — Kairos surface |
| 14 | `hunter` | T2 | `src/skills/bundled/hunter.ts` (REVIEW_ARTIFACT-gated) | DEFER — review artifact |
| 15 | `run-skill-generator` | T2 | `src/skills/bundled/runSkillGenerator.ts` | DEFER — skill-generator infra |
| 16 | `claude-in-chrome` | DROP | `src/skills/bundled/claudeInChrome.ts` | DROP — MCP |
| 17 | `schedule-remote-agents` | DROP | `src/skills/bundled/scheduleRemoteAgents.ts` | DROP — MCP |

Tier-1 (5 skills) is the focus of this plan with full per-skill task blocks. Tier-2 (10 skills) + DROP (2) are catalogued in the **Deferred Batch Appendix** with surface-mapping notes so a future plan can pick up the deferred ones one by one.

---

## File Structure

```
src/core/skill/
  bundled.ts                          MODIFY  add buildBody factory hook
  bundled/                            CREATE  per-skill modules
    index.ts                          CREATE  initBundledSkills()
    loremIpsum.ts                     CREATE  T1 #1
    simplify.ts                       CREATE  T1 #2
    stuck.ts                          CREATE  T1 #3
    remember.ts                       CREATE  T1 #4
    skillify.ts                       CREATE  T1 #5
  loader.ts                           MODIFY  call initBundledSkills() before disk load
  __tests__/
    bundled.buildBody.test.ts         CREATE  buildBody resolves at registration
    bundled.initRegistry.test.ts      CREATE  all 5 tier-1 names register
    bundled.skillBodies.test.ts       CREATE  each body resolves to non-empty string
```

---

## Task 0 — `buildBody` factory hook on `registerBundledSkill`

**Files:**
- Modify: `src/core/skill/bundled.ts`
- Create: `src/core/skill/__tests__/bundled.buildBody.test.ts`

- [ ] **Step 0.1** — Write failing test

```ts
// src/core/skill/__tests__/bundled.buildBody.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearBundledSkills,
  getBundledSkills,
  registerBundledSkill,
} from '../bundled'

describe('registerBundledSkill — buildBody', () => {
  afterEach(() => clearBundledSkills())

  it('resolves buildBody eagerly at registration time', () => {
    let calls = 0
    registerBundledSkill({
      name: 'demo',
      buildBody: () => { calls++; return 'computed-body' },
    })
    expect(calls).toBe(1)
    const [skill] = getBundledSkills()
    expect(skill?.body).toBe('computed-body')
  })

  it('prefers buildBody over body when both are present', () => {
    registerBundledSkill({
      name: 'demo',
      body: 'static',
      buildBody: () => 'dynamic',
    })
    expect(getBundledSkills()[0]?.body).toBe('dynamic')
  })

  it('falls back to body when buildBody is absent', () => {
    registerBundledSkill({ name: 'demo', body: 'static-only' })
    expect(getBundledSkills()[0]?.body).toBe('static-only')
  })

  it('throws when neither body nor buildBody is provided', () => {
    expect(() =>
      registerBundledSkill({ name: 'bad' } as never),
    ).toThrow(/body or buildBody/)
  })
})
```

- [ ] **Step 0.2** — Run failing

```bash
npx vitest run src/core/skill/__tests__/bundled.buildBody.test.ts
```

- [ ] **Step 0.3** — Implement

In `src/core/skill/bundled.ts`, update the definition and the register function:

```ts
import type { Skill, SkillFrontmatter } from './types'

export type BundledSkillDefinition = {
  name: string
  description?: string
  when?: SkillFrontmatter['when']
  requires?: string[]
  /** Static body. Mutually exclusive with `buildBody`, but `buildBody` wins. */
  body?: string
  /** Dynamic body factory; called once at registration time. */
  buildBody?: () => string
  path?: string
}

const bundledSkills: Skill[] = []

export function registerBundledSkill(def: BundledSkillDefinition): void {
  const body = def.buildBody ? def.buildBody() : def.body
  if (typeof body !== 'string') {
    throw new Error(`registerBundledSkill(${def.name}): must provide body or buildBody`)
  }
  const skill: Skill = {
    name: def.name,
    ...(def.description !== undefined ? { description: def.description } : {}),
    when: def.when ?? 'on-session-start',
    ...(def.requires !== undefined ? { requires: def.requires } : {}),
    body,
    source: 'global',
    path: def.path ?? `<bundled>:${def.name}`,
  }
  const idx = bundledSkills.findIndex((s) => s.name === skill.name)
  if (idx >= 0) bundledSkills[idx] = skill
  else bundledSkills.push(skill)
}

export function getBundledSkills(): Skill[] {
  return [...bundledSkills]
}

export function clearBundledSkills(): void {
  bundledSkills.length = 0
}
```

- [ ] **Step 0.4** — Run passing

```bash
npx vitest run src/core/skill/__tests__/bundled.buildBody.test.ts
npx tsc --noEmit
```

- [ ] **Step 0.5** — Commit

```bash
git add src/core/skill/bundled.ts src/core/skill/__tests__/bundled.buildBody.test.ts
git commit -m "feat(skill/bundled): add buildBody factory hook to registerBundledSkill"
```

---

## Task 1 — Port `lorem-ipsum` (tier-1 #1)

**Surface mapping:** zero external dependencies. Drops the `args`-based dynamic token count — instead bakes a 10 000-token sample at registration time. Renames `userInvocable: true` → keyword-activated on `lorem`, `filler text`, `placeholder text`. Drops the `process.env.USER_TYPE === 'ant'` gate; replaced with `NUKA_SKILL_LOREM_IPSUM=1` env opt-in.

**Files:**
- Create: `src/core/skill/bundled/loremIpsum.ts`

- [ ] **Step 1.1** — Write failing test

```ts
// src/core/skill/__tests__/bundled.loremIpsum.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { clearBundledSkills, getBundledSkills } from '../bundled'
import { registerLoremIpsumSkill } from '../bundled/loremIpsum'

describe('registerLoremIpsumSkill', () => {
  afterEach(() => {
    clearBundledSkills()
    delete process.env['NUKA_SKILL_LOREM_IPSUM']
  })

  it('does not register when env opt-in is off', () => {
    registerLoremIpsumSkill()
    expect(getBundledSkills()).toEqual([])
  })

  it('registers a keyword-activated skill when opt-in is on', () => {
    process.env['NUKA_SKILL_LOREM_IPSUM'] = '1'
    registerLoremIpsumSkill()
    const [skill] = getBundledSkills()
    expect(skill?.name).toBe('lorem-ipsum')
    expect(skill?.when).toEqual({ keyword: ['lorem', 'filler text', 'placeholder text'] })
    expect(skill?.body.length).toBeGreaterThan(1000)
  })
})
```

- [ ] **Step 1.2** — Run failing

```bash
npx vitest run src/core/skill/__tests__/bundled.loremIpsum.test.ts
```

- [ ] **Step 1.3** — Implement

```ts
// src/core/skill/bundled/loremIpsum.ts
import { registerBundledSkill } from '../bundled'

const ONE_TOKEN_WORDS = [
  'the', 'a', 'an', 'I', 'you', 'he', 'she', 'it', 'we', 'they',
  'is', 'are', 'was', 'were', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could',
  'time', 'year', 'day', 'way', 'man', 'thing', 'life', 'hand',
  'good', 'new', 'first', 'last', 'long', 'great', 'little',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by',
  'and', 'or', 'but', 'if', 'than', 'because', 'as', 'until',
  'not', 'now', 'just', 'more', 'also', 'here', 'there', 'then',
  'test', 'code', 'data', 'file', 'line', 'text', 'word', 'number',
] as const

function generateLoremIpsum(targetTokens: number): string {
  let tokens = 0
  let result = ''
  while (tokens < targetTokens) {
    const sentenceLength = 10 + Math.floor(Math.random() * 11)
    let wordsInSentence = 0
    for (let i = 0; i < sentenceLength && tokens < targetTokens; i++) {
      const word = ONE_TOKEN_WORDS[Math.floor(Math.random() * ONE_TOKEN_WORDS.length)]
      result += word
      tokens++
      wordsInSentence++
      result += i === sentenceLength - 1 || tokens >= targetTokens ? '. ' : ' '
    }
    if (wordsInSentence > 0 && Math.random() < 0.2 && tokens < targetTokens) {
      result += '\n\n'
    }
  }
  return result.trim()
}

const DEFAULT_TOKEN_COUNT = 10_000

const HEADER =
  '# Lorem Ipsum (filler text)\n\n' +
  'When the user asks for filler text, placeholder text, or test content, ' +
  `paste the sample below (≈${DEFAULT_TOKEN_COUNT} tokens). If they need a ` +
  'different size, generate proportional text using the same one-token-word vocabulary.\n\n' +
  '---\n\n'

export function registerLoremIpsumSkill(): void {
  if (process.env['NUKA_SKILL_LOREM_IPSUM'] !== '1') return
  registerBundledSkill({
    name: 'lorem-ipsum',
    description: 'Generate filler / placeholder text for context-window testing.',
    when: { keyword: ['lorem', 'filler text', 'placeholder text'] },
    buildBody: () => HEADER + generateLoremIpsum(DEFAULT_TOKEN_COUNT),
  })
}
```

- [ ] **Step 1.4** — Run passing

```bash
npx vitest run src/core/skill/__tests__/bundled.loremIpsum.test.ts
npx tsc --noEmit
```

- [ ] **Step 1.5** — Commit

```bash
git add src/core/skill/bundled/loremIpsum.ts \
        src/core/skill/__tests__/bundled.loremIpsum.test.ts
git commit -m "feat(skill/bundled): port lorem-ipsum (tier-1) with env opt-in"
```

---

## Task 2 — Port `simplify` (tier-1 #2)

**Surface mapping:** zero external code dependencies. Body is a static markdown prompt. The original references `AGENT_TOOL_NAME` (Nuka-Code-internal constant); Nuka equivalent is the literal string `'AgentTool'` (Nuka's agent dispatch tool). Drops `args` (Nuka skills are keyword-only). Always-on registration (no env gate).

**Files:**
- Create: `src/core/skill/bundled/simplify.ts`

- [ ] **Step 2.1** — Write failing test

```ts
// src/core/skill/__tests__/bundled.simplify.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { clearBundledSkills, getBundledSkills } from '../bundled'
import { registerSimplifySkill } from '../bundled/simplify'

describe('registerSimplifySkill', () => {
  afterEach(() => clearBundledSkills())

  it('registers a keyword-activated review skill', () => {
    registerSimplifySkill()
    const [skill] = getBundledSkills()
    expect(skill?.name).toBe('simplify')
    expect(skill?.when).toEqual({ keyword: ['simplify', 'review', 'cleanup', 'code review'] })
    expect(skill?.body).toContain('Code Reuse Review')
    expect(skill?.body).toContain('Code Quality Review')
    expect(skill?.body).toContain('Efficiency Review')
  })
})
```

- [ ] **Step 2.2** — Run failing

```bash
npx vitest run src/core/skill/__tests__/bundled.simplify.test.ts
```

- [ ] **Step 2.3** — Implement

```ts
// src/core/skill/bundled/simplify.ts
import { registerBundledSkill } from '../bundled'

const AGENT_TOOL_NAME = 'AgentTool'

const SIMPLIFY_PROMPT = `# Simplify: Code Review and Cleanup

Review all changed files for reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

Run \`git diff\` (or \`git diff HEAD\` if there are staged changes) to see what changed. If there are no git changes, review the most recently modified files that the user mentioned or that you edited earlier in this conversation.

## Phase 2: Launch Three Review Agents in Parallel

Use the ${AGENT_TOOL_NAME} tool to launch all three agents concurrently in a single message. Pass each agent the full diff so it has the complete context.

### Agent 1: Code Reuse Review

For each change:

1. **Search for existing utilities and helpers** that could replace newly written code. Look for similar patterns elsewhere in the codebase — common locations are utility directories, shared modules, and files adjacent to the changed ones.
2. **Flag any new function that duplicates existing functionality.** Suggest the existing function to use instead.
3. **Flag any inline logic that could use an existing utility** — hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, and similar patterns are common candidates.

### Agent 2: Code Quality Review

Review the same changes for hacky patterns:

1. **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones
3. **Copy-paste with slight variation**: near-duplicate code blocks that should be unified with a shared abstraction
4. **Leaky abstractions**: exposing internal details that should be encapsulated, or breaking existing abstraction boundaries
5. **Stringly-typed code**: using raw strings where constants, enums (string unions), or branded types already exist in the codebase
6. **Unnecessary comments**: comments explaining WHAT the code does — delete; keep only non-obvious WHY (hidden constraints, subtle invariants, workarounds)

### Agent 3: Efficiency Review

Review the same changes for efficiency:

1. **Unnecessary work**: redundant computations, repeated file reads, duplicate network/API calls, N+1 patterns
2. **Missed concurrency**: independent operations run sequentially when they could run in parallel
3. **Hot-path bloat**: new blocking work added to startup or per-request/per-render hot paths
4. **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern) — operate directly and handle the error
5. **Memory**: unbounded data structures, missing cleanup, event listener leaks
6. **Overly broad operations**: reading entire files when only a portion is needed, loading all items when filtering for one

## Phase 3: Fix Issues

Wait for all three agents to complete. Aggregate their findings and fix each issue directly. If a finding is a false positive or not worth addressing, note it and move on — do not argue with the finding, just skip it.

When done, briefly summarize what was fixed (or confirm the code was already clean).
`

export function registerSimplifySkill(): void {
  registerBundledSkill({
    name: 'simplify',
    description: 'Review changed code for reuse, quality, and efficiency, then fix any issues found.',
    when: { keyword: ['simplify', 'review', 'cleanup', 'code review'] },
    body: SIMPLIFY_PROMPT,
  })
}
```

- [ ] **Step 2.4** — Run passing

```bash
npx vitest run src/core/skill/__tests__/bundled.simplify.test.ts
npx tsc --noEmit
```

- [ ] **Step 2.5** — Commit

```bash
git add src/core/skill/bundled/simplify.ts \
        src/core/skill/__tests__/bundled.simplify.test.ts
git commit -m "feat(skill/bundled): port simplify (tier-1)"
```

---

## Task 3 — Port `stuck` (tier-1 #3)

**Surface mapping:** zero external code dependencies. Body is a static markdown prompt. Drops the Slack/MCP posting instructions — Nuka skills must not depend on MCP. The ported body keeps the diagnostic flow and ends with "report findings to the user" instead of "post to Slack". Env-gated via `NUKA_SKILL_STUCK=1` (debugging-only, off by default).

**Files:**
- Create: `src/core/skill/bundled/stuck.ts`

- [ ] **Step 3.1** — Write failing test

```ts
// src/core/skill/__tests__/bundled.stuck.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { clearBundledSkills, getBundledSkills } from '../bundled'
import { registerStuckSkill } from '../bundled/stuck'

describe('registerStuckSkill', () => {
  afterEach(() => {
    clearBundledSkills()
    delete process.env['NUKA_SKILL_STUCK']
  })

  it('does not register when env opt-in is off', () => {
    registerStuckSkill()
    expect(getBundledSkills()).toEqual([])
  })

  it('registers a keyword-activated diagnostic skill on opt-in', () => {
    process.env['NUKA_SKILL_STUCK'] = '1'
    registerStuckSkill()
    const [skill] = getBundledSkills()
    expect(skill?.name).toBe('stuck')
    expect(skill?.when).toEqual({ keyword: ['stuck', 'frozen', 'hung', 'unresponsive'] })
    expect(skill?.body).toContain('High CPU')
    expect(skill?.body).not.toMatch(/slack|mcp/i)
  })
})
```

- [ ] **Step 3.2** — Run failing

```bash
npx vitest run src/core/skill/__tests__/bundled.stuck.test.ts
```

- [ ] **Step 3.3** — Implement

```ts
// src/core/skill/bundled/stuck.ts
import { registerBundledSkill } from '../bundled'

const STUCK_PROMPT = `# Stuck — diagnose frozen/slow Nuka sessions

The user thinks another Nuka session on this machine is frozen, stuck, or very slow. Investigate and report findings back to the user.

## What to look for

Scan for other Nuka processes (excluding the current one). Process names are typically \`nuka\` (installed) or \`node\` running \`nuka\` dev builds.

Signs of a stuck session:
- **High CPU (≥90%) sustained** — likely an infinite loop. Sample twice, 1-2s apart, to confirm it's not a transient spike.
- **Process state \`D\` (uninterruptible sleep)** — often an I/O hang. The \`state\` column in \`ps\` output; first character matters (ignore modifiers like \`+\`, \`s\`, \`<\`).
- **Process state \`T\` (stopped)** — user probably hit Ctrl+Z by accident.
- **Process state \`Z\` (zombie)** — parent isn't reaping.
- **Very high RSS (≥4GB)** — possible memory leak making the session sluggish.
- **Stuck child process** — a hung \`git\`, \`node\`, or shell subprocess can freeze the parent. Check \`pgrep -lP <pid>\` for each session.

## Investigation steps

1. **List all Nuka processes** (macOS/Linux):
   \`\`\`
   ps -axo pid=,pcpu=,rss=,etime=,state=,comm=,command= | grep -E '(nuka|node)' | grep -v grep
   \`\`\`
   Filter to rows where \`comm\` is \`nuka\` or where the command path mentions \`nuka\`.

2. **For anything suspicious**, gather more context:
   - Child processes: \`pgrep -lP <pid>\`
   - If high CPU: sample again after 1-2s to confirm it's sustained
   - If a child looks hung (e.g., a git command), note its full command line with \`ps -p <child_pid> -o command=\`

3. **Consider a stack dump** for a truly frozen process (advanced, optional):
   - macOS: \`sample <pid> 3\` gives a 3-second native stack sample
   - Only grab it if the process is clearly hung and you want to know *why*

## Report

**Only report findings to the user if you actually found something stuck.** If every session looks healthy, tell the user that directly. When you do find a stuck/slow session, include:

- PID, CPU%, RSS, state, uptime, command line, child processes
- Your diagnosis of what's likely wrong
- Any captured \`sample\` output

## Notes

- Don't kill or signal any processes — this is diagnostic only.
`

export function registerStuckSkill(): void {
  if (process.env['NUKA_SKILL_STUCK'] !== '1') return
  registerBundledSkill({
    name: 'stuck',
    description: 'Investigate frozen/stuck/slow Nuka sessions on this machine.',
    when: { keyword: ['stuck', 'frozen', 'hung', 'unresponsive'] },
    body: STUCK_PROMPT,
  })
}
```

- [ ] **Step 3.4** — Run passing

```bash
npx vitest run src/core/skill/__tests__/bundled.stuck.test.ts
npx tsc --noEmit
```

- [ ] **Step 3.5** — Commit

```bash
git add src/core/skill/bundled/stuck.ts \
        src/core/skill/__tests__/bundled.stuck.test.ts
git commit -m "feat(skill/bundled): port stuck (tier-1) without MCP/Slack dependency"
```

---

## Task 4 — Port `remember` (tier-1 #4)

**Surface mapping:** Nuka-Code's body referenced `isAutoMemoryEnabled` from a memdir subsystem. Nuka has `src/core/memdir/synth.ts` and related modules; the skill body is content-only (instructions to the model on how to use memdir), so no runtime dependency is needed. The original was gated `USER_TYPE === 'ant'` — replaced with `NUKA_SKILL_REMEMBER=1`. Keyword-activated on `remember`, `memorize`, `save to memory`.

**Files:**
- Create: `src/core/skill/bundled/remember.ts`

- [ ] **Step 4.1** — Write failing test

```ts
// src/core/skill/__tests__/bundled.remember.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { clearBundledSkills, getBundledSkills } from '../bundled'
import { registerRememberSkill } from '../bundled/remember'

describe('registerRememberSkill', () => {
  afterEach(() => {
    clearBundledSkills()
    delete process.env['NUKA_SKILL_REMEMBER']
  })

  it('does not register when opt-in is off', () => {
    registerRememberSkill()
    expect(getBundledSkills()).toEqual([])
  })

  it('registers a memdir-aware keyword skill on opt-in', () => {
    process.env['NUKA_SKILL_REMEMBER'] = '1'
    registerRememberSkill()
    const [skill] = getBundledSkills()
    expect(skill?.name).toBe('remember')
    expect(skill?.when).toEqual({ keyword: ['remember', 'memorize', 'save to memory'] })
    expect(skill?.body).toContain('memdir')
  })
})
```

- [ ] **Step 4.2** — Run failing

```bash
npx vitest run src/core/skill/__tests__/bundled.remember.test.ts
```

- [ ] **Step 4.3** — Implement

```ts
// src/core/skill/bundled/remember.ts
import { registerBundledSkill } from '../bundled'

const REMEMBER_PROMPT = `# Remember — persist a fact to user memdir

The user wants you to remember something across sessions. Use the memdir subsystem to persist the fact as a small structured note.

## How to save

1. Distill the fact into a single sentence of useful, durable context. Examples:
   - "User prefers TypeScript strict mode and refuses \`any\`."
   - "User's primary editor is Helix; they avoid GUI tools."
   - "When debugging hooks, user wants pipeline mode (\`NUKA_HOOK_PIPELINE_MODE=pipeline\`)."
2. Avoid duplicates — first scan existing memdir entries (under \`~/.nuka/memdir/\`). If a near-duplicate exists, update it instead of adding a new note.
3. Avoid noise — don't save transient facts (e.g. the current branch name, the file you just edited). Save only patterns and preferences that will be useful in future sessions.
4. Avoid PII unless the user explicitly named it for storage.

## Format

Each note is a single markdown file. Filename is a short kebab-case slug of the fact. Body is one short paragraph; the first line is the fact, optionally followed by 1-3 bullets of context.

## Confirmation

After saving, tell the user briefly: "Saved to memdir: <slug>". Do not echo the full content back unless asked.
`

export function registerRememberSkill(): void {
  if (process.env['NUKA_SKILL_REMEMBER'] !== '1') return
  registerBundledSkill({
    name: 'remember',
    description: 'Persist user preferences and durable facts to memdir.',
    when: { keyword: ['remember', 'memorize', 'save to memory'] },
    body: REMEMBER_PROMPT,
  })
}
```

- [ ] **Step 4.4** — Run passing

```bash
npx vitest run src/core/skill/__tests__/bundled.remember.test.ts
npx tsc --noEmit
```

- [ ] **Step 4.5** — Commit

```bash
git add src/core/skill/bundled/remember.ts \
        src/core/skill/__tests__/bundled.remember.test.ts
git commit -m "feat(skill/bundled): port remember (tier-1) with memdir guidance"
```

---

## Task 5 — Port `skillify` (tier-1 #5)

**Surface mapping:** Nuka-Code references `getSessionMemoryContent` and `getMessagesAfterCompactBoundary`. The body is content-only — the dynamic context (current-session summary) is omitted in the Nuka port; instead the skill prompts the model to derive context itself by reading recent messages with built-in tools. Always-on (no env gate). Keyword-activated on `skillify`, `extract skill`, `make a skill`.

**Files:**
- Create: `src/core/skill/bundled/skillify.ts`

- [ ] **Step 5.1** — Write failing test

```ts
// src/core/skill/__tests__/bundled.skillify.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { clearBundledSkills, getBundledSkills } from '../bundled'
import { registerSkillifySkill } from '../bundled/skillify'

describe('registerSkillifySkill', () => {
  afterEach(() => clearBundledSkills())

  it('registers a keyword-activated skill-authoring helper', () => {
    registerSkillifySkill()
    const [skill] = getBundledSkills()
    expect(skill?.name).toBe('skillify')
    expect(skill?.when).toEqual({ keyword: ['skillify', 'extract skill', 'make a skill'] })
    expect(skill?.body).toContain('.nuka/skills/')
    expect(skill?.body).toContain('frontmatter')
  })
})
```

- [ ] **Step 5.2** — Run failing

```bash
npx vitest run src/core/skill/__tests__/bundled.skillify.test.ts
```

- [ ] **Step 5.3** — Implement

```ts
// src/core/skill/bundled/skillify.ts
import { registerBundledSkill } from '../bundled'

const SKILLIFY_PROMPT = `# Skillify — extract a reusable skill from this conversation

The user wants to capture a recurring workflow as a Nuka skill so it can be activated automatically in future sessions.

## Step 1: Identify the workflow

Read back through this session (most recent 20-30 messages) and find:

1. A concrete sequence of steps the user explicitly or implicitly relies on
2. Activation cues — what keywords / phrases the user uses when this workflow applies
3. Constraints — invariants, output formats, tools the user expects to be used

Surface the identified workflow back to the user in 3-5 bullets and confirm before writing anything.

## Step 2: Decide scope

Skills live at one of two paths:

- **Project**: \`.nuka/skills/<name>.md\` — checked into the repo, applies to this codebase only
- **Global**: \`~/.nuka/skills/<name>.md\` — applies to all sessions on this machine

Default to project scope unless the workflow is editor- or machine-level.

## Step 3: Author the skill file

Use this frontmatter shape (validated by Nuka at load time):

\`\`\`markdown
---
name: my-skill-name
description: One sentence on when to use this skill.
when:
  keyword:
    - cue word
    - another cue
requires:
  - tag1
---

# Body

The body is the prompt injected when the skill activates. Write it as
direct, second-person instructions to the agent.
\`\`\`

- \`name\`: kebab-case, unique
- \`description\`: shown in skill listings
- \`when.keyword\`: array of substrings matched case-insensitively against the user prompt
- \`requires\`: optional capability tags that union with the always-on \`core\` set

## Step 4: Write it

Use the Write tool to create the file. Then confirm to the user:

> Saved <scope> skill: <name>. It will activate when you mention: <keywords>.
`

export function registerSkillifySkill(): void {
  registerBundledSkill({
    name: 'skillify',
    description: 'Extract a recurring workflow from the current session into a reusable Nuka skill.',
    when: { keyword: ['skillify', 'extract skill', 'make a skill'] },
    body: SKILLIFY_PROMPT,
  })
}
```

- [ ] **Step 5.4** — Run passing

```bash
npx vitest run src/core/skill/__tests__/bundled.skillify.test.ts
npx tsc --noEmit
```

- [ ] **Step 5.5** — Commit

```bash
git add src/core/skill/bundled/skillify.ts \
        src/core/skill/__tests__/bundled.skillify.test.ts
git commit -m "feat(skill/bundled): port skillify (tier-1) authoring helper"
```

---

## Task 6 — `initBundledSkills()` entry point

**Files:**
- Create: `src/core/skill/bundled/index.ts`
- Create: `src/core/skill/__tests__/bundled.initRegistry.test.ts`

- [ ] **Step 6.1** — Write failing test

```ts
// src/core/skill/__tests__/bundled.initRegistry.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearBundledSkills, getBundledSkills } from '../bundled'
import { initBundledSkills } from '../bundled/index'

describe('initBundledSkills', () => {
  beforeEach(() => clearBundledSkills())
  afterEach(() => {
    clearBundledSkills()
    delete process.env['NUKA_SKILL_LOREM_IPSUM']
    delete process.env['NUKA_SKILL_STUCK']
    delete process.env['NUKA_SKILL_REMEMBER']
  })

  it('registers the always-on tier-1 skills by default', () => {
    initBundledSkills()
    const names = getBundledSkills().map(s => s.name).sort()
    expect(names).toEqual(['simplify', 'skillify'])
  })

  it('registers all five tier-1 skills when all opt-ins are on', () => {
    process.env['NUKA_SKILL_LOREM_IPSUM'] = '1'
    process.env['NUKA_SKILL_STUCK'] = '1'
    process.env['NUKA_SKILL_REMEMBER'] = '1'
    initBundledSkills()
    const names = getBundledSkills().map(s => s.name).sort()
    expect(names).toEqual(['lorem-ipsum', 'remember', 'simplify', 'skillify', 'stuck'])
  })

  it('each registered skill has a non-empty body', () => {
    process.env['NUKA_SKILL_LOREM_IPSUM'] = '1'
    process.env['NUKA_SKILL_STUCK'] = '1'
    process.env['NUKA_SKILL_REMEMBER'] = '1'
    initBundledSkills()
    for (const s of getBundledSkills()) {
      expect(s.body.length).toBeGreaterThan(50)
    }
  })

  it('is idempotent across multiple calls', () => {
    initBundledSkills()
    initBundledSkills()
    initBundledSkills()
    const names = getBundledSkills().map(s => s.name)
    // No duplicates — registerBundledSkill replaces by name
    expect(new Set(names).size).toBe(names.length)
  })
})
```

- [ ] **Step 6.2** — Run failing

```bash
npx vitest run src/core/skill/__tests__/bundled.initRegistry.test.ts
```

- [ ] **Step 6.3** — Implement

```ts
// src/core/skill/bundled/index.ts
import { registerLoremIpsumSkill } from './loremIpsum'
import { registerRememberSkill } from './remember'
import { registerSimplifySkill } from './simplify'
import { registerSkillifySkill } from './skillify'
import { registerStuckSkill } from './stuck'

/**
 * Register all bundled (in-process) skills. Tier-1 set; tier-2 skills are
 * deferred (see docs/plans/2026-05-18-skills-bundled-migration.md).
 *
 * Each `register*Skill()` is responsible for its own env-gate. Skills with
 * no gate (simplify, skillify) always register; opt-in skills no-op when
 * their env is unset. Calling this function twice is safe — the registry
 * dedupes by name.
 */
export function initBundledSkills(): void {
  registerSimplifySkill()
  registerSkillifySkill()
  registerLoremIpsumSkill()
  registerRememberSkill()
  registerStuckSkill()
}
```

- [ ] **Step 6.4** — Run passing

```bash
npx vitest run src/core/skill/__tests__/bundled.initRegistry.test.ts
npx tsc --noEmit
```

- [ ] **Step 6.5** — Commit

```bash
git add src/core/skill/bundled/index.ts \
        src/core/skill/__tests__/bundled.initRegistry.test.ts
git commit -m "feat(skill/bundled): initBundledSkills() entry registers tier-1 set"
```

---

## Task 7 — Wire `initBundledSkills()` into the loader

**Files:**
- Modify: `src/core/skill/loader.ts`
- Create: `src/core/skill/__tests__/loader.bundled.test.ts`

- [ ] **Step 7.1** — Write failing test

```ts
// src/core/skill/__tests__/loader.bundled.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { clearBundledSkills } from '../bundled'
import { loadSkills } from '../loader'

describe('loadSkills — bundled merge', () => {
  const home = mkdtempSync(join(tmpdir(), 'nuka-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'nuka-cwd-'))

  afterEach(() => {
    clearBundledSkills()
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  it('returns bundled skills alongside disk skills', async () => {
    const result = await loadSkills({ home, cwd })
    const names = result.skills.map(s => s.name)
    // simplify and skillify are unconditional tier-1 bundled skills
    expect(names).toContain('simplify')
    expect(names).toContain('skillify')
  })

  it('disk-loaded skills with the same name override bundled', async () => {
    mkdirSync(join(cwd, '.nuka', 'skills'), { recursive: true })
    writeFileSync(
      join(cwd, '.nuka', 'skills', 'simplify.md'),
      '---\nname: simplify\ndescription: project override\n---\n\nproject body\n',
    )
    const result = await loadSkills({ home, cwd })
    const simplify = result.skills.find(s => s.name === 'simplify')
    expect(simplify?.body.trim()).toBe('project body')
    expect(simplify?.source).toBe('project')
  })
})
```

- [ ] **Step 7.2** — Run failing

```bash
npx vitest run src/core/skill/__tests__/loader.bundled.test.ts
```

- [ ] **Step 7.3** — Implement

In `src/core/skill/loader.ts`, locate the top of `loadSkills({ home, cwd })` and prepend bundled-init + merge:

```ts
import { getBundledSkills } from './bundled'
import { initBundledSkills } from './bundled/index'

// At the top of loadSkills():
initBundledSkills()
const bundled = getBundledSkills()

// Existing disk-load flow returns `global: Skill[]` and `project: Skill[]`.
// Merge order (precedence): project > global > bundled — last write wins by name.
function mergeByName(layers: ReadonlyArray<ReadonlyArray<Skill>>): Skill[] {
  const byName = new Map<string, Skill>()
  for (const layer of layers) {
    for (const s of layer) byName.set(s.name, s)
  }
  return [...byName.values()]
}

// existing return shape:
return {
  skills: mergeByName([bundled, globalSkills, projectSkills]),
  /* warnings, errors ... */
}
```

If `loader.ts` already has its own merge logic, prepend `bundled` to the precedence chain at the lowest priority slot — never let bundled win over disk.

- [ ] **Step 7.4** — Run passing

```bash
npx vitest run src/core/skill/__tests__/loader.bundled.test.ts
npx tsc --noEmit
```

- [ ] **Step 7.5** — Commit

```bash
git add src/core/skill/loader.ts \
        src/core/skill/__tests__/loader.bundled.test.ts
git commit -m "feat(skill/loader): merge bundled tier-1 skills below disk skills"
```

---

## Task 8 — Body-resolution smoke test

**Files:**
- Create: `src/core/skill/__tests__/bundled.skillBodies.test.ts`

- [ ] **Step 8.1** — Write the test

```ts
// src/core/skill/__tests__/bundled.skillBodies.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearBundledSkills, getBundledSkills } from '../bundled'
import { initBundledSkills } from '../bundled/index'

describe('bundled skills — body resolves without runtime error', () => {
  beforeEach(() => {
    process.env['NUKA_SKILL_LOREM_IPSUM'] = '1'
    process.env['NUKA_SKILL_STUCK'] = '1'
    process.env['NUKA_SKILL_REMEMBER'] = '1'
    clearBundledSkills()
  })
  afterEach(() => {
    clearBundledSkills()
    delete process.env['NUKA_SKILL_LOREM_IPSUM']
    delete process.env['NUKA_SKILL_STUCK']
    delete process.env['NUKA_SKILL_REMEMBER']
  })

  it('initBundledSkills does not throw', () => {
    expect(() => initBundledSkills()).not.toThrow()
  })

  it('every registered tier-1 skill has a non-empty body and valid `when`', () => {
    initBundledSkills()
    const skills = getBundledSkills()
    expect(skills.length).toBe(5)
    for (const s of skills) {
      expect(s.body).toMatch(/\S/)
      expect(['on-session-start']).toContain(typeof s.when === 'string' ? s.when : 'on-session-start')
      if (typeof s.when !== 'string') {
        expect(Array.isArray(s.when.keyword)).toBe(true)
        expect(s.when.keyword.length).toBeGreaterThan(0)
      }
    }
  })

  it('no bundled skill body references MCP or claude-for-chrome', () => {
    initBundledSkills()
    for (const s of getBundledSkills()) {
      expect(s.body).not.toMatch(/MCP|claude-for-chrome|@ant\//)
    }
  })
})
```

- [ ] **Step 8.2** — Run passing

```bash
npx vitest run src/core/skill/__tests__/bundled.skillBodies.test.ts
npx tsc --noEmit
```

- [ ] **Step 8.3** — Commit

```bash
git add src/core/skill/__tests__/bundled.skillBodies.test.ts
git commit -m "test(skill/bundled): smoke test bodies + MCP-rejection invariant"
```

---

## Deferred Batch Appendix (tier-2: 10 skills + 2 DROP)

For each deferred skill: name → Nuka-Code path → proposed Nuka target path → surface mapping notes. A future plan picks one (or a small batch) and follows the same task-block shape as tier-1: write failing test → implement → register in `bundled/index.ts` → commit.

### T2-#6 — `debug`

- **Source:** `Nuka-Code/src/skills/bundled/debug.ts`
- **Target:** `Nuka/src/core/skill/bundled/debug.ts`
- **Surface mappings required:**
  - `enableDebugLogging()` / `getDebugLogPath()` from Nuka-Code `utils/debug.js` → Nuka has no equivalent; needs a new `src/core/debug/log.ts` helper exposing the same shape. Out of scope until the debug-log subsystem exists.
  - `getSettingsFilePathForSource('userSettings'|'projectSettings'|'localSettings')` → Nuka does not have layered settings yet. Stub with placeholder paths.
  - `CLAUDE_CODE_GUIDE_AGENT_TYPE` reference → drop; Nuka's agent dispatch tool name is `'AgentTool'` (see tier-1 `simplify`).
- **Body strategy:** static markdown body; `buildBody` not required if we drop the live log-tail.
- **Env gate:** `NUKA_SKILL_DEBUG=1`.
- **Activation:** `{ keyword: ['debug session', 'diagnose', 'troubleshoot'] }`.

### T2-#7 — `keybindings-help`

- **Source:** `Nuka-Code/src/skills/bundled/keybindings.ts`
- **Target:** `Nuka/src/core/skill/bundled/keybindings.ts`
- **Surface mappings required:**
  - `DEFAULT_BINDINGS`, `KEYBINDING_ACTIONS`, `KEYBINDING_CONTEXT_DESCRIPTIONS`, `KEYBINDING_CONTEXTS`, `KEYBINDINGS_SCHEMA`, `MACOS_RESERVED`, `NON_REBINDABLE`, `TERMINAL_RESERVED` → Nuka has a `src/keybindings/` (per recent commit `2026-05-18-keybindings.md`); confirm matching exports before porting.
  - `isKeybindingCustomizationEnabled` → use Nuka's keybindings activation check; expose if not already exported.
- **Body strategy:** dynamic — uses `buildBody` to generate three markdown tables (contexts, actions, reserved shortcuts) at registration.
- **Env gate:** none (always-on once Nuka's keybindings stack is finalised).
- **Activation:** `{ keyword: ['keybinding', 'shortcut', 'rebind'] }`.

### T2-#8 — `verify`

- **Source:** `Nuka-Code/src/skills/bundled/verify.ts` + `verifyContent.ts`
- **Target:** `Nuka/src/core/skill/bundled/verify.ts` + `Nuka/src/core/skill/bundled/verify/` (inline markdown bundle)
- **Surface mappings required:**
  - Content bundle: ~6 KB across `SKILL_MD` + `SKILL_FILES`. Inline as TypeScript string literals (no Bun-only text loader; Nuka uses plain `tsc`).
  - `parseFrontmatter` → Nuka's skill loader already parses frontmatter; expose the helper or duplicate the (~20 LOC) function.
- **Body strategy:** static (the markdown bundle inlined verbatim).
- **Env gate:** none.
- **Activation:** `{ keyword: ['verify', 'sanity check', 'check work'] }`.

### T2-#9 — `update-config`

- **Source:** `Nuka-Code/src/skills/bundled/updateConfig.ts`
- **Target:** `Nuka/src/core/skill/bundled/updateConfig.ts`
- **Surface mappings required:**
  - `SettingsSchema` from `utils/settings/types.js` → Nuka has no canonical settings Zod schema yet. Either (a) introduce a minimal one for Nuka-specific config, or (b) defer until config persistence lands.
  - `toJSONSchema` from `zod/v4` → Nuka does not depend on `zod/v4` (the `no new npm deps` invariant). Use `zod-to-json-schema` only if already in deps; otherwise hand-write the JSON schema fragment.
- **Body strategy:** `buildBody` — generates JSON-schema reference text at registration.
- **Env gate:** none.
- **Activation:** `{ keyword: ['change setting', 'update config', 'configure nuka'] }`.

### T2-#10 — `batch`

- **Source:** `Nuka-Code/src/skills/bundled/batch.ts`
- **Target:** `Nuka/src/core/skill/bundled/batch.ts`
- **Surface mappings required:**
  - `AGENT_TOOL_NAME`, `ASK_USER_QUESTION_TOOL_NAME`, `ENTER_PLAN_MODE_TOOL_NAME`, `EXIT_PLAN_MODE_TOOL_NAME`, `SKILL_TOOL_NAME` → string-interpolated into the prompt body. Replace each with the Nuka tool name string (`'AgentTool'`, etc.; consult `src/core/tools/`).
- **Body strategy:** static markdown.
- **Env gate:** none.
- **Activation:** `{ keyword: ['batch', 'parallel agents', 'multiple tasks'] }`.

### T2-#11 — `claude-api`

- **Source:** `Nuka-Code/src/skills/bundled/claudeApi.ts` + `claudeApiContent.ts`
- **Target:** `Nuka/src/core/skill/bundled/claudeApi.ts` (+ a sibling `claudeApi/` content directory)
- **Surface mappings required:**
  - 247 KB of inlined markdown reference docs across multiple languages (csharp, curl, go, java, javascript, python, ruby, rust, swift, typescript). Bun's text-loader is not available; the port must inline each as a TS string literal, OR keep them on disk and read at registration via `readFileSync`. Disk read is preferred (faster TS compile).
  - `getCwd` and project-detection logic → drop; the skill body should be language-agnostic, with a single "detect the user's language and paste the relevant section" instruction.
- **Body strategy:** dynamic via `buildBody` if disk-read; static if inlined.
- **Env gate:** `NUKA_SKILL_CLAUDE_API=1`.
- **Activation:** `{ keyword: ['claude api', 'claude sdk', 'building with claude'] }`.

### T2-#12 — `loop`

- **Source:** `Nuka-Code/src/skills/bundled/loop.ts`
- **Target:** `Nuka/src/core/skill/bundled/loop.ts`
- **Surface mappings required:**
  - `CRON_CREATE_TOOL_NAME`, `CRON_DELETE_TOOL_NAME`, `DEFAULT_MAX_AGE_DAYS`, `isKairosCronEnabled` → Nuka has its own cron stack (`src/core/cron/`); map to the Nuka cron tool names. Confirm by reading `src/core/tools/cron.ts` or wherever Nuka registers cron tools.
- **Body strategy:** static markdown referencing the Nuka cron tool names.
- **Env gate:** `NUKA_SKILL_LOOP=1` (gated by cron-scheduler env `NUKA_CRON_SCHEDULER=1` as a soft prerequisite).
- **Activation:** `{ keyword: ['loop', 'autonomous evolution', 'self-improve'] }`.

### T2-#13 — `dream` (KAIROS-gated upstream)

- **Source:** `Nuka-Code/src/skills/bundled/dream.ts` (dynamic-required in `bundledSkills.ts:36-40`)
- **Target:** `Nuka/src/core/skill/bundled/dream.ts`
- **Surface mappings required:** Kairos surface (whatever the KAIROS / KAIROS_DREAM feature exposes). Nuka has no equivalent.
- **Status:** DEFER pending a Kairos port. If Kairos is never ported, this skill is `DROP`.

### T2-#14 — `hunter` (REVIEW_ARTIFACT-gated upstream)

- **Source:** `Nuka-Code/src/skills/bundled/hunter.ts` (dynamic-required in `bundledSkills.ts:42-46`)
- **Target:** `Nuka/src/core/skill/bundled/hunter.ts`
- **Surface mappings required:** review-artifact subsystem. Nuka has no equivalent.
- **Status:** DEFER pending review-artifact infra.

### T2-#15 — `run-skill-generator`

- **Source:** `Nuka-Code/src/skills/bundled/runSkillGenerator.ts` (dynamic-required in `bundledSkills.ts:73-77`)
- **Target:** `Nuka/src/core/skill/bundled/runSkillGenerator.ts`
- **Surface mappings required:** skill-generator infra (a sub-agent that authors new skills). Nuka has `skillify` (tier-1 #5) which covers most of this niche manually. Status: DEFER, possibly DROP as redundant with `skillify`.

### DROP-#16 — `claude-in-chrome`

- **Source:** `Nuka-Code/src/skills/bundled/claudeInChrome.ts`
- **Status:** DROP — imports `@ant/claude-for-chrome-mcp`. Nuka rejects MCP entirely (per project invariant). No replacement planned.

### DROP-#17 — `schedule-remote-agents`

- **Source:** `Nuka-Code/src/skills/bundled/scheduleRemoteAgents.ts`
- **Status:** DROP — imports `MCPServerConnection` and the Slack-MCP send path. Nuka rejects MCP entirely. Remote agent scheduling, if added later, would need a non-MCP transport — separate plan.

---

## Self-Review Checklist

- [ ] No `any` in any new file (verify with `grep -Rn ': any' src/core/skill/bundled`)
- [ ] No `@ts-ignore` introduced
- [ ] No new npm deps (`git diff package.json` shows no change)
- [ ] All new code uses Vitest (`describe/it/expect` from `'vitest'`)
- [ ] `npx tsc --noEmit` passes at every commit
- [ ] All commit messages omit `Co-Authored-By:` lines
- [ ] No bundled skill body references MCP, `@ant/claude-for-chrome-mcp`, or Slack MCP tools (test enforced in Task 8)
- [ ] Disk skills always override bundled (precedence test in Task 7)
- [ ] Each tier-1 skill has its own test file + test for "registers under the expected name"
- [ ] `initBundledSkills()` is idempotent (test in Task 6)
- [ ] All 5 tier-1 skills appear in `bundled/index.ts` `initBundledSkills()` registration order
- [ ] Deferred Batch Appendix lists all 12 remaining skills (10 T2 + 2 DROP), with target path + surface mapping notes for each
- [ ] Env opt-in naming convention consistent: `NUKA_SKILL_<UPPER_SNAKE_NAME>=1`
- [ ] Architecture decisions (buildBody, no-args, MCP-drop, claudeApi-defer) are stated in the header BEFORE any task block
