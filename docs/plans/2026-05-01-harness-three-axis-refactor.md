# Harness 三轴重构 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 harness 从单维 7-class profile 重构为三正交轴（profile × difficulty × testStrategy），并新增 `src/core/coordination/` 中间层承载 sub-task 拆分与 a2a 事件订阅推送。

**Architecture:** 三轴模型 + YAML 数据驱动的 stage matrix；新建 `coordination/` 处理 task graph、scheduler、a2a router；`harness/` 瘦身只管 stage 状态机；硬迁移删除旧 7-class，沿用 phase14a 的 swarm/messaging/teams 原语。

**Tech Stack:** TypeScript, Node ≥18, Vitest, zod (JSON schema), yaml, ulid, ink (TUI), Anthropic SDK fast model（fork）。

**Reference design:** `docs/plans/2026-05-01-harness-three-axis-refactor-design.md`

---

## Phase 0 — 准备

### Task 0.1: 创建工作分支

**Step 1:** 创建 feature 分支
```bash
git checkout -b refactor/harness-three-axis
```

**Step 2:** 验证基线测试通过
```bash
npm run typecheck && npm test 2>&1 | tail -20
```
Expected: 全绿 (基线状态)。任何已 fail 的测试要先记下来作为已知 baseline。

**Step 3:** 不需要 commit。

---

## Phase 1 — 数据 schema 与 YAML 加载

### Task 1.1: 重写 harness/types.ts（三轴 + Triage）

**Files:**
- Modify: `src/core/harness/types.ts`（整文件替换）
- Test: `test/core/harness/types.test.ts`

**Step 1: 写失败测试**

```ts
// test/core/harness/types.test.ts
import { describe, it, expect } from 'vitest'
import type { TaskProfile, Difficulty, TestStrategy, Triage } from '../../../src/core/harness/types'

describe('harness types', () => {
  it('TaskProfile 包含新 6 类', () => {
    const profiles: TaskProfile[] = ['feature', 'debug-fix', 'refactor', 'investigate', 'doc', 'odd-jobs']
    expect(profiles).toHaveLength(6)
  })
  it('Difficulty 4 档', () => {
    const d: Difficulty[] = ['simple', 'medium', 'hard', 'hell']
    expect(d).toHaveLength(4)
  })
  it('TestStrategy 3 档', () => {
    const t: TestStrategy[] = ['tdd', 'cross-module', 'multi-test']
    expect(t).toHaveLength(3)
  })
  it('Triage 包含 reasoning + userConfirmed', () => {
    const triage: Triage = { profile: 'feature', difficulty: 'medium', testStrategy: 'tdd', reasoning: 'r', userConfirmed: true }
    expect(triage.userConfirmed).toBe(true)
  })
})
```

**Step 2: 运行 — 应失败（旧类型）**
```bash
npx vitest run test/core/harness/types.test.ts
```
Expected: 类型断言失败（旧 TaskProfile 是 explore/fix/refactor/feature/docs/config/research）。

**Step 3: 替换 types.ts**

```ts
// src/core/harness/types.ts
export type TaskProfile =
  | 'feature' | 'debug-fix' | 'refactor'
  | 'investigate' | 'doc' | 'odd-jobs'

export type Difficulty = 'simple' | 'medium' | 'hard' | 'hell'
export type TestStrategy = 'tdd' | 'cross-module' | 'multi-test'

export type HarnessStage =
  | 'brainstorm' | 'spec' | 'plan' | 'search'
  | 'implement' | 'review' | 'recap'

export type HarnessMode = 'deep' | 'fast' | 'off'
export type StageRequirement = 'mandatory' | 'optional' | 'forbidden'

export type Triage = {
  profile: TaskProfile
  difficulty: Difficulty
  testStrategy: TestStrategy
  reasoning: string
  userConfirmed: boolean
}

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
  triage: Triage | null
  currentStage: HarnessStage | null
  history: StageEntry[]
  scratchpadPath: string
  taskGraphPath: string
  startedAt: number
}
```

**Step 4: 运行 — 应通过**
```bash
npx vitest run test/core/harness/types.test.ts
```

**Step 5: typecheck 会爆**
```bash
npm run typecheck 2>&1 | head -50
```
Expected: 大量旧调用点报错（这是硬迁移想要的 — 暴露所有调用点）。先记下报错文件清单，下面 task 逐个修。

**Step 6: 不 commit。等本 phase 全部修完一起 commit。**

### Task 1.2: 创建 profiles.yaml

**Files:**
- Create: `assets/harness/profiles.yaml`
- Test: `test/core/harness/profilesYaml.test.ts`

**Step 1: 写失败测试**

```ts
// test/core/harness/profilesYaml.test.ts
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { loadProfilesYaml } from '../../../src/core/harness/profilesLoader'

describe('profiles.yaml loader', () => {
  it('加载 6 个 profile', () => {
    const p = loadProfilesYaml(path.join(process.cwd(), 'assets/harness/profiles.yaml'))
    expect(Object.keys(p.profiles).sort()).toEqual(['debug-fix','doc','feature','investigate','odd-jobs','refactor'])
  })
  it('investigate.implement = forbidden', () => {
    const p = loadProfilesYaml(path.join(process.cwd(), 'assets/harness/profiles.yaml'))
    expect(p.profiles.investigate.stages.implement).toBe('forbidden')
  })
  it('feature 全 mandatory', () => {
    const p = loadProfilesYaml(path.join(process.cwd(), 'assets/harness/profiles.yaml'))
    expect(p.profiles.feature.stages.brainstorm).toBe('mandatory')
  })
})
```

**Step 2: 运行 — 应失败（loader 未实现，YAML 不存在）**

**Step 3: 创建 YAML**

```yaml
# assets/harness/profiles.yaml
profiles:
  feature:
    stages:
      brainstorm: mandatory
      spec: mandatory
      plan: mandatory
      search: mandatory
      implement: mandatory
      review: mandatory
      recap: mandatory
  debug-fix:
    stages:
      brainstorm: optional
      spec: optional
      plan: mandatory
      search: mandatory
      implement: mandatory
      review: mandatory
      recap: mandatory
  refactor:
    stages:
      brainstorm: optional
      spec: mandatory
      plan: mandatory
      search: mandatory
      implement: mandatory
      review: mandatory
      recap: mandatory
  investigate:
    stages:
      brainstorm: mandatory
      spec: optional
      plan: optional
      search: mandatory
      implement: forbidden
      review: optional
      recap: mandatory
  doc:
    stages:
      brainstorm: optional
      spec: optional
      plan: optional
      search: mandatory
      implement: mandatory
      review: optional
      recap: mandatory
  odd-jobs:
    stages:
      brainstorm: optional
      spec: optional
      plan: optional
      search: mandatory
      implement: mandatory
      review: optional
      recap: mandatory
```

**Step 4: 创建 loader**

```ts
// src/core/harness/profilesLoader.ts
import * as fs from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'
import type { TaskProfile, HarnessStage, StageRequirement } from './types'

const StageReq = z.enum(['mandatory','optional','forbidden'])
const ProfileSpec = z.object({
  stages: z.object({
    brainstorm: StageReq, spec: StageReq, plan: StageReq, search: StageReq,
    implement: StageReq, review: StageReq, recap: StageReq,
  }),
})
const Schema = z.object({
  profiles: z.record(z.string(), ProfileSpec),
})

export type ProfilesConfig = z.infer<typeof Schema>

export function loadProfilesYaml(filePath: string): ProfilesConfig {
  const raw = fs.readFileSync(filePath, 'utf8')
  return Schema.parse(parse(raw))
}

export function stageReqFromConfig(cfg: ProfilesConfig, profile: TaskProfile, stage: HarnessStage): StageRequirement {
  return cfg.profiles[profile].stages[stage]
}
```

**Step 5: 运行测试**
```bash
npx vitest run test/core/harness/profilesYaml.test.ts
```
Expected: PASS

**Step 6: 不 commit。**

### Task 1.3: 重写 matrix.ts（移除硬编码 + difficulty modifier）

**Files:**
- Modify: `src/core/harness/matrix.ts`
- Test: `test/core/harness/matrix.test.ts`

**Step 1: 写失败测试**

```ts
// test/core/harness/matrix.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import * as path from 'node:path'
import { effectiveStageRequirement, initMatrix } from '../../../src/core/harness/matrix'

describe('matrix', () => {
  beforeAll(() => initMatrix(path.join(process.cwd(), 'assets/harness/profiles.yaml')))

  it('feature/medium = profile 默认值', () => {
    expect(effectiveStageRequirement('feature', 'medium', 'brainstorm')).toBe('mandatory')
  })
  it('debug-fix/hard 把 brainstorm 提到 mandatory', () => {
    expect(effectiveStageRequirement('debug-fix', 'hard', 'spec')).toBe('mandatory')
  })
  it('investigate/hell 不会突破 forbidden', () => {
    expect(effectiveStageRequirement('investigate', 'hell', 'implement')).toBe('forbidden')
  })
  it('odd-jobs/simple 把 implement 保持 mandatory（不能下调）', () => {
    expect(effectiveStageRequirement('odd-jobs', 'simple', 'implement')).toBe('mandatory')
  })
})
```

**Step 2: 运行 — 应失败**

**Step 3: 实现 matrix.ts**

```ts
// src/core/harness/matrix.ts
import type { TaskProfile, Difficulty, HarnessStage, StageRequirement } from './types'
import { loadProfilesYaml, stageReqFromConfig, type ProfilesConfig } from './profilesLoader'

let CFG: ProfilesConfig | null = null

export function initMatrix(yamlPath: string): void {
  CFG = loadProfilesYaml(yamlPath)
}

const DIFFICULTY_FLOOR: Record<Difficulty, Partial<Record<HarnessStage, StageRequirement>>> = {
  simple: {},
  medium: {},
  hard:   { spec: 'mandatory' },
  hell:   { spec: 'mandatory', review: 'mandatory' },
}

const ORDER: Record<StageRequirement, number> = { forbidden: 0, optional: 1, mandatory: 2 }

export function effectiveStageRequirement(profile: TaskProfile, difficulty: Difficulty, stage: HarnessStage): StageRequirement {
  if (!CFG) throw new Error('matrix not initialized; call initMatrix() first')
  const profileReq = stageReqFromConfig(CFG, profile, stage)
  if (profileReq === 'forbidden') return 'forbidden' // 红线，不可被 difficulty 突破
  const floor = DIFFICULTY_FLOOR[difficulty][stage]
  if (!floor) return profileReq
  return ORDER[floor] > ORDER[profileReq] ? floor : profileReq
}

// legacy single-axis API（标记 deprecated，待 transitions.ts 迁移完毕后删除）
export function stageRequirement(profile: TaskProfile, stage: HarnessStage): StageRequirement {
  return effectiveStageRequirement(profile, 'medium', stage)
}
```

**Step 4: 运行测试**
```bash
npx vitest run test/core/harness/matrix.test.ts
```

**Step 5: 不 commit。**

### Task 1.4: 修 transitions.ts 以使用 effectiveStageRequirement

**Files:** Modify `src/core/harness/transitions.ts`

**Step 1:** 把 `stageRequirement(opts.profile, opts.to)` 调用改为接收 difficulty。新增 `difficulty` 字段到 `CanTransitionOpts`。

**Step 2:** 改完跑 typecheck：`npm run typecheck 2>&1 | grep transitions`，确认本文件干净。

**Step 3:** 不 commit。

### Task 1.5: 修 state.ts 以使用 Triage

**Files:** Modify `src/core/harness/state.ts`

**Step 1:** 替换 `taskProfile` 字段为 `triage: Triage | null`；构造函数接收三轴；`canTransition` / `canExit` 内部使用 `effectiveStageRequirement(triage.profile, triage.difficulty, ...)`；scratchpad 写入展示三轴。

**Step 2:** typecheck：`npm run typecheck 2>&1 | grep state.ts`

**Step 3:** 不 commit。

### Task 1.6: Phase 1 收尾 commit

**Step 1:** 修复 typecheck 中剩余的 import/类型错（cli.tsx / slash/harness.ts / tui/Monitor 中引用旧 TaskProfile 的位置 — 只做最小补丁让编译通过，不动语义）。

**Step 2:**
```bash
npm run typecheck && npx vitest run test/core/harness/
```
Expected: PASS

**Step 3: Commit**
```bash
git add -A
git commit -m "refactor(harness): three-axis types + YAML profiles + difficulty modifier"
```

---

## Phase 2 — Triage 三轴判定

### Task 2.1: 写 triage.ts（LLM fork + zod 校验）

**Files:**
- Create: `src/core/harness/triage.ts`
- Test: `test/core/harness/triage.test.ts`

**Step 1: 写失败测试**（用 mock fork 验证 JSON 解析 + 重试 + fallback）

```ts
// test/core/harness/triage.test.ts
import { describe, it, expect, vi } from 'vitest'
import { triageMessage } from '../../../src/core/harness/triage'

const validJson = JSON.stringify({ profile: 'feature', difficulty: 'medium', testStrategy: 'tdd', reasoning: 'looks routine' })

describe('triage', () => {
  it('解析有效 JSON', async () => {
    const fork = vi.fn().mockResolvedValue({ text: validJson })
    const t = await triageMessage({ userMessage: 'add login', repoSummary: '', runFork: fork })
    expect(t.profile).toBe('feature')
    expect(t.userConfirmed).toBe(false)
  })
  it('JSON 损坏时重试一次', async () => {
    const fork = vi.fn()
      .mockResolvedValueOnce({ text: 'garbage' })
      .mockResolvedValueOnce({ text: validJson })
    const t = await triageMessage({ userMessage: 'x', repoSummary: '', runFork: fork })
    expect(fork).toHaveBeenCalledTimes(2)
    expect(t.profile).toBe('feature')
  })
  it('两次失败 fallback 到 {feature, medium, tdd}', async () => {
    const fork = vi.fn().mockResolvedValue({ text: 'still garbage' })
    const t = await triageMessage({ userMessage: 'x', repoSummary: '', runFork: fork })
    expect(t).toMatchObject({ profile: 'feature', difficulty: 'medium', testStrategy: 'tdd' })
    expect(t.reasoning).toContain('fallback')
  })
})
```

**Step 2: 运行 — 应失败**

**Step 3: 实现 triage.ts**

```ts
// src/core/harness/triage.ts
import { z } from 'zod'
import type { Triage } from './types'

const Schema = z.object({
  profile: z.enum(['feature','debug-fix','refactor','investigate','doc','odd-jobs']),
  difficulty: z.enum(['simple','medium','hard','hell']),
  testStrategy: z.enum(['tdd','cross-module','multi-test']),
  reasoning: z.string(),
})

const PROMPT = (msg: string, repo: string) => `You classify a coding task into 3 axes and return STRICT JSON only.

Repo summary:
${repo}

User request:
${msg}

Schema:
{
  "profile": "feature|debug-fix|refactor|investigate|doc|odd-jobs",
  "difficulty": "simple|medium|hard|hell",
  "testStrategy": "tdd|cross-module|multi-test",
  "reasoning": "<one sentence>"
}

Reply with the JSON object only, no prose.`

function tryParse(text: string): z.infer<typeof Schema> | null {
  try {
    const s = text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '')
    return Schema.parse(JSON.parse(s))
  } catch { return null }
}

export async function triageMessage(opts: {
  userMessage: string
  repoSummary: string
  runFork: (prompt: string) => Promise<{ text: string }>
}): Promise<Triage> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await opts.runFork(PROMPT(opts.userMessage, opts.repoSummary))
    const parsed = tryParse(r.text)
    if (parsed) return { ...parsed, userConfirmed: false }
  }
  return {
    profile: 'feature', difficulty: 'medium', testStrategy: 'tdd',
    reasoning: 'fallback: triage LLM failed twice',
    userConfirmed: false,
  }
}
```

**Step 4: 跑测试**
```bash
npx vitest run test/core/harness/triage.test.ts
```

**Step 5: Commit**
```bash
git add src/core/harness/triage.ts test/core/harness/triage.test.ts
git commit -m "feat(harness): triage three-axis classifier with JSON schema + fallback"
```

### Task 2.2: 接入 ask_user_question 确认流

**Files:** Modify `src/core/harness/triage.ts` 增加 `confirmTriage()`，Modify `state.ts` 在 `start()` 里调用 triage + confirm。

**Step 1:** 写测试 `triage.confirm.test.ts`：模拟 askUser 返回 "ok" 时 userConfirmed=true；返回 "改成 hard" 时重 fork 一次。

**Step 2:** 实现 `confirmTriage()`：单 ask_user_question 多选展示三轴；用户回复字符串若包含"ok/yes/确认"则 commit；否则把回复作为 hint 再 fork 一次。

**Step 3:** 把 `state.ts` 的 `start()` 改为：
```ts
this.state.triage = await triageMessage({...})
this.state.triage = await confirmTriage(this.state.triage, deps)
```

**Step 4:** 跑相关测试 + typecheck。

**Step 5: Commit**
```bash
git commit -am "feat(harness): triage user-confirm loop via ask_user_question"
```

### Task 2.3: 删除旧 classifier.ts

**Files:** Delete `src/core/harness/classifier.ts`

**Step 1:** 检查是否还有引用 `classifyTaskProfile`：
```bash
grep -rn "classifyTaskProfile" src test
```
若有，迁移到 `triageMessage`，否则直接删。

**Step 2:**
```bash
rm src/core/harness/classifier.ts
npm run typecheck && npm test
```

**Step 3: Commit**
```bash
git commit -am "refactor(harness): remove legacy classifier.ts"
```

---

## Phase 3 — Coordination 层基础（types + TaskGraph）

### Task 3.1: coordination/types.ts

**Files:** Create `src/core/coordination/types.ts`, Test `test/core/coordination/types.test.ts`

**Step 1:** 测试只验证类型导出存在 + ulid 可用。

**Step 2:** 实现按 design § 5.2 落地 SubTask / TaskGraph / A2ASubscription。

**Step 3:** 跑 typecheck + 单元测试。

**Step 4: Commit**
```bash
git commit -am "feat(coordination): types for SubTask/TaskGraph/A2ASubscription"
```

### Task 3.2: TaskGraph 类（CRUD + toposort + persist）

**Files:**
- Create: `src/core/coordination/taskGraph.ts`
- Create: `src/core/coordination/persist.ts`
- Test: `test/core/coordination/taskGraph.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { TaskGraph } from '../../../src/core/coordination/taskGraph'

describe('TaskGraph', () => {
  it('add + ready 返回无依赖任务', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hard' })
    g.add({ id: 'a', title: 'A', profile: 'feature', testStrategy: 'tdd', agentId: null, status: 'pending', dependsOn: [], contextFor: [], result: null })
    g.add({ id: 'b', title: 'B', profile: 'feature', testStrategy: 'tdd', agentId: null, status: 'pending', dependsOn: ['a'], contextFor: [], result: null })
    expect(g.ready().map(t => t.id)).toEqual(['a'])
  })
  it('markDone 解锁下游', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hard' })
    g.add({ id: 'a', /* ... */ } as any)
    g.add({ id: 'b', dependsOn: ['a'], /* ... */ } as any)
    g.markRunning('a', 'agent1')
    g.markDone('a', { summary: 's', artifacts: [] })
    expect(g.ready().map(t => t.id)).toContain('b')
  })
  it('toposort 支持跨层级', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hard' })
    // a → b, a → c, b → d
    g.add({ id: 'a' } as any); g.add({ id: 'b', dependsOn: ['a'] } as any)
    g.add({ id: 'c', dependsOn: ['a'] } as any); g.add({ id: 'd', dependsOn: ['b'] } as any)
    const order = g.toposort()
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'))
  })
  it('toJSON / fromJSON 圆周', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hell' })
    g.add({ id: 'a' } as any)
    const round = TaskGraph.fromJSON(g.toJSON())
    expect(round.ready()).toHaveLength(1)
  })
})
```

**Step 2:** 实现 TaskGraph（Kahn 算法 toposort，参考 `src/core/swarm/pipeline.ts` 的 `topoLevels`）。

**Step 3:** 实现 persist.ts（`saveGraph(path, graph)` / `loadGraph(path)`，atomic write 用 tmp+rename）。

**Step 4:** 跑测试。

**Step 5: Commit**
```bash
git commit -am "feat(coordination): TaskGraph CRUD + toposort + persist"
```

---

## Phase 4 — Decompose + Scheduler

### Task 4.1: decompose.ts (LLM 拆分)

**Files:** Create `src/core/coordination/decompose.ts`, Test `test/core/coordination/decompose.test.ts`

**Step 1:** 测试 mock runFork 返回拆分 JSON：N 个 task + edges。验证 zod 校验、重试、fallback 单点。

**Step 2:** 实现 prompt + parse：

```ts
const Out = z.object({
  tasks: z.array(z.object({ id: z.string(), title: z.string(), profile: z.enum([...]), testStrategy: z.enum([...]) })),
  edges: z.array(z.tuple([z.string(), z.string(), z.string()])),
})
```

**Step 3:** Fallback：解析失败时返回 `{ tasks: [{ id: ulid(), title: rootMessage, ... }], edges: [] }`。

**Step 4:** 跑测试。

**Step 5: Commit**
```bash
git commit -am "feat(coordination): decompose LLM with zod schema + single-point fallback"
```

### Task 4.2: scheduler.ts

**Files:** Create `src/core/coordination/scheduler.ts`, Test `test/core/coordination/scheduler.test.ts`

**Step 1:** 测试覆盖 4 难度 × 行为映射：
- simple → 不入图，返回 `{ kind: 'inline' }`
- medium → 不入图，`{ kind: 'inline' }`
- hard → 调 decompose，返回 `{ kind: 'graph', graph, listening: false }`
- hell → 调 decompose，返回 `{ kind: 'graph', graph, listening: true }`

**Step 2:** 实现 `planExecution(triage, rootMessage, deps)` 返回 ExecutionPlan。

**Step 3:** 实现 `runGraph(graph, deps)`：拓扑层级 dispatch；同层用 `pipeline_run`（已有）；跨层串行；hell 难度的每个 task 完成后调 `markListening` + 注册 A2A。

**Step 4:** 跑测试。

**Step 5: Commit**
```bash
git commit -am "feat(coordination): scheduler difficulty-driven execution plan + DAG runner"
```

---

## Phase 5 — A2A Router

### Task 5.1: a2aRouter.ts

**Files:** Create `src/core/coordination/a2aRouter.ts`, Test `test/core/coordination/a2aRouter.test.ts`

**Step 1: 测试**

```ts
it('订阅命中 → dispatch a2a.dispatched 事件 + send_message', async () => {
  const bus = new EventBus()
  const messaging = { send: vi.fn() }
  const router = new A2ARouter({ bus, messaging })
  router.subscribe({ subscriberAgentId: 'agent1', ownsTaskId: 'a', triggersOn: ['b'], triggerCount: 0, lifecycle: 'until-correlated-tasks-done' })
  bus.emit('coordination.task.started', { taskId: 'b', agentId: 'agent2' })
  await flushMicrotasks()
  expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ from: 'agent1', to: 'agent2' }))
})

it('triggerCount 上限 3', async () => {
  // 触发 4 次，第 4 次应被忽略
})

it('lifecycle until-correlated-tasks-done 在所有 triggersOn 完成后 unsubscribe', async () => {})
```

**Step 2:** 实现 router；订阅注册写入 `~/.nuka/coordination/<sessionId>.subs.json`；监听 `coordination.task.started` 事件；`buildSupplement()` 从 owner task result 摘要 + scratchpad 头部 N 行拼接。

**Step 3:** 跑测试。

**Step 4: Commit**
```bash
git commit -am "feat(coordination): a2a router event-driven supplement messaging"
```

### Task 5.2: correlation.ts

**Files:** Create `src/core/coordination/correlation.ts`, Test `test/core/coordination/correlation.test.ts`

**Step 1:** 测试：给 graph 含 correlations 时返回非空 TestSpec[]；无 correlations 返回 []。

**Step 2:** 实现：从 graph.correlations 抽出每对 → LLM fork 生成 `describe('correlation between A and B')` 测试模板 → 写入 `test/correlation/<hash>.test.ts`。

**Step 3:** Commit。

---

## Phase 6 — Harness 与 Coordination 接合

### Task 6.1: state.ts 接入 scheduler

**Files:** Modify `src/core/harness/state.ts`

**Step 1:** 在 implement stage 进入时调用：
```ts
const plan = await planExecution(this.state.triage!, userMessage, deps)
if (plan.kind === 'graph') {
  await runGraph(plan.graph, deps)
}
```

**Step 2:** 测试：mock scheduler 验证调用路径。

**Step 3:** Commit。

### Task 6.2: skills.ts 适配新 profile

**Files:** Modify `src/core/harness/skills.ts`

**Step 1:** 把 `TDD_PROFILES` 改为读 testStrategy 而非 profile：当 testStrategy === 'tdd' 时 implement 强制 [tdd, simplify]；cross-module / multi-test 启用 correlation skill。

**Step 2:** 测试覆盖 6 profile × 3 testStrategy 组合（抽样）。

**Step 3:** Commit。

---

## Phase 7 — Editor + 工具

### Task 7.1: 新增 coordination 工具

**Files:**
- Create: `src/core/tools/builtin/coordinationDecompose.ts`
- Create: `src/core/tools/builtin/coordinationStatus.ts`
- Create: `src/core/tools/builtin/coordinationA2aSend.ts`
- Test: 各自 test 文件

**Step 1:** 仿 `src/core/harness/primitives.ts` 用 `defineTool` 注册三个 builtin 工具。

**Step 2:** 测试每个工具的 input schema + 调用结果。

**Step 3:** 注册到 builtin 列表（找 `src/core/tools/` 中的 registry / builtin loader 加 export）。

**Step 4:** Commit。

### Task 7.2: editor.ts system prompt 更新

**Files:** Modify `src/core/agents/builtin/editor.ts`

**Step 1:** 在 system prompt 中加入：
- 三轴语义说明（profile/difficulty/testStrategy 各自的取值与含义）
- hard/hell 时必须先 `coordination_decompose` 再 dispatch
- hell 时启动每个 sub-task 前主动检查 `coordination_status` 的订阅段

**Step 2:** 视觉验证：跑一次 dev session，观察 editor 输出。

**Step 3:** Commit。

---

## Phase 8 — Slash & TUI

### Task 8.1: slash/triage.ts

**Files:** Create `src/slash/triage.ts`

**Step 1:** 注册 `/triage` 与 `/harness retriage` 命令；调用 triageMessage + confirmTriage；写回 HarnessState。

**Step 2:** 测试。

**Step 3:** Commit。

### Task 8.2: slash/coordination.ts

**Files:** Create `src/slash/coordination.ts`

**Step 1:** 注册 `/coordination status` 展示当前 TaskGraph + 订阅；`/coordination a2a-send <from> <to> <body>` 触发手动推送。

**Step 2:** 测试。

**Step 3:** Commit。

### Task 8.3: slash/harness.ts 更新

**Files:** Modify `src/slash/harness.ts`

**Step 1:** 把展示中的旧 `taskProfile` 替换为 triage 三轴展示（profile / difficulty / testStrategy）。

**Step 2:** 测试。

**Step 3:** Commit。

### Task 8.4: TUI Monitor 加 coordination.* 事件 case

**Files:** Modify `src/tui/Monitor/useMonitorEvents.ts` + `TimelineView.tsx`

**Step 1:** 加 4 个 case 分支，分别给颜色 + 文案。

**Step 2:** ink-testing-library 测试。

**Step 3:** Commit。

---

## Phase 9 — 删除旧路径 / smoke 测试

### Task 9.1: 全仓库扫描旧 7-class 残留

**Step 1:**
```bash
grep -rn "explore\|fix\|research\|config\|docs" src/core/harness src/core/agents/builtin/editor.ts | grep -v -E "explore=|//|/\*"
```
逐条检查是否旧 profile 残留，全部替换为新 6 类语义。

**Step 2:** typecheck + 全量测试：
```bash
npm run typecheck && npm test
```

**Step 3:** Commit (只在有改动时)。

### Task 9.2: superseded 标注旧 design

**Files:** Modify `docs/superpowers/specs/2026-04-30-phase14d-harness-design.md`

**Step 1:** 顶部加：
```
> **Superseded by:** docs/plans/2026-05-01-harness-three-axis-refactor-design.md (2026-05-01)
```

**Step 2:** Commit。

### Task 9.3: 端到端集成测试

**Files:** Create `test/integration/harness/threeAxis.test.ts`

**Step 1:** 测试 3 个场景：
- simple-debug-fix：单点 TDD，无图
- hard-feature：3 task DAG，pipeline_run 调度，correlation test 生成
- hell-refactor：3 task DAG + a2a 订阅，agent1 在 task B 启动时 supplement message 命中 agent2

**Step 2:** mock provider，断言 EventBus 上的事件序列。

**Step 3:** Commit。

### Task 9.4: 最终验证

**Step 1:**
```bash
npm run lint && npm run typecheck && npm test && npm run build
```

**Step 2:** 看 `dist/` 是否生成成功；smoke `node dist/cli.js --version`。

**Step 3:** 不需要 commit；准备合并。

---

## 完成标准

- [ ] `git grep "explore\|research" src/core/harness` 无匹配（旧 profile 清零）
- [ ] `npm run typecheck && npm test` 全绿
- [ ] `assets/harness/profiles.yaml` 存在并被 loader 测试覆盖
- [ ] `src/core/coordination/` 6 个文件齐全，每个有测试
- [ ] `test/integration/harness/threeAxis.test.ts` 覆盖 3 场景
- [ ] `docs/plans/2026-05-01-harness-three-axis-refactor-design.md` 已 commit
- [ ] 旧 `phase14d-harness-design.md` 顶部有 superseded 标注

---

## Skills 引用

- @superpowers:test-driven-development — 每个 task 先红再绿
- @superpowers:simplify — Phase 4/5 完成后回头精简 coordination 实现
- @superpowers:verification-before-completion — Phase 9.4 最终验证前必走
- @superpowers:requesting-code-review — 全部完成后请求 review
