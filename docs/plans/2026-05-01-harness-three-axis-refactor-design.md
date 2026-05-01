# Harness 三轴重构设计

**Date:** 2026-05-01
**Status:** Spec
**Supersedes:** `docs/superpowers/specs/2026-04-30-phase14d-harness-design.md` 中的 7-class profile 模型
**Author:** Brainstorming session 2026-05-01

## 1. 问题

phase14d 的 harness 把"任务类型"压成了一个维度（7 个 profile），导致：
- 类别过细（explore / fix / refactor / feature / docs / config / research），用户体感"分类没有意义"。
- 测试策略硬绑定在 profile 上（feature/fix/refactor 强制 TDD，其他禁用），无法表达"odd-jobs 里有个需要测试的 config 脚本"或"hell 级别 feature 要做跨模块测试"。
- 没有"任务难度"的概念：simple bugfix 和 hell 级 feature 走同一套 stage 流程，要么过度（小任务也被 brainstorm 拖住）要么不足（大任务缺少 sub-task 拆分与 agent 间联系）。
- 多个相关 sub-task 之间没有 a2a 协议：当 task B 依赖 task A 时，agent2 拿不到 agent1 的最新约束，主 agent 也只是单向调度，缺少 agent1 → agent2 的"事件驱动补充"。

本次重构把 harness 的语义从"profile 单轴"升级为**三个正交轴**，并新增 `coordination/` 中间层承担 sub-task 拆分与 a2a 路由。

## 2. 目标

1. **三轴模型**：profile（6 类，可扩展） / difficulty（4 档） / testStrategy（3 档）。
2. **三轴均由 LLM 启发式预调，再由 ask_user_question 让用户确认/调整**。
3. **profile 数据驱动**：从 YAML 加载，便于未来加入"writing"/"workflow"等非代码类。
4. **difficulty 是 preset，同时调三件事**：是否拆 sub-task / 是否 a2a / review 严格度与全局 verify 范围。
5. **coordination 层承载 task graph + scheduler + a2a router**：harness 只管 stage 流转，复杂度下沉到 coordination。
6. **a2a = 事件订阅 + 主动推送**：agent 完成主任务后转 listening；下游 task 启动事件唤醒；agent1 主动 send_message 给 agent2，不必经主 agent。
7. **硬迁移**：删除现有 7-class profile + 硬编码 matrix，TS 编译错误暴露所有调用点，全量替换。

## 3. Non-goals

- ❌ 不重写 swarm/teams/messaging（沿用 phase14a 原语）。
- ❌ 不引入跨 session 的 task graph 持久化（每 session 起一份）。
- ❌ 不做完整 actor 模型：a2a 是一个订阅注册器，不是真正的 mailbox。
- ❌ difficulty 不能突破 profile 的 forbidden（`investigate.implement = forbidden` 不会因为 hell 而被开启）。

## 4. 架构

```
                          user message
                                │
                                ▼
                      ┌─────────────────┐
                      │  Triage 三轴    │  单次 LLM fork → JSON
                      │  + ask_user 确认 │  { profile, difficulty, testStrategy }
                      └────────┬────────┘
                               │
                               ▼
              ┌─────────────────────────────────────┐
              │     HarnessStateMachine             │  瘦身版：仅 stage 状态机 +
              │  brainstorm/spec/plan/search/       │  scratchpad + editor prompt
              │  implement/review/recap             │
              │  cell = matrix(profile,difficulty)  │  YAML profile + difficulty modifier
              └────────────────┬────────────────────┘
                               │ implement / review 阶段调用
                               ▼
              ┌─────────────────────────────────────┐
              │  src/core/coordination/  (新)        │
              │  ├ taskGraph.ts                      │
              │  ├ scheduler.ts                      │
              │  ├ a2aRouter.ts                      │
              │  ├ correlation.ts                    │
              │  └ decompose.ts                      │
              └────────────────┬────────────────────┘
                               │ 通过现有原语执行
                               ▼
              ┌─────────────────────────────────────┐
              │  swarm/  teams/  messaging/  agents/ │  不变
              │  dispatch_agent / send_message /     │
              │  pipeline_run / roundtable           │
              └─────────────────────────────────────┘
```

## 5. 数据 schema

### 5.1 harness types（重写）

```ts
// src/core/harness/types.ts
export type TaskProfile =
  | 'feature' | 'debug-fix' | 'refactor'
  | 'investigate' | 'doc' | 'odd-jobs'
  // 列表从 assets/harness/profiles.yaml 加载，新增不需要改 TS

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

### 5.2 coordination types

```ts
// src/core/coordination/types.ts
export type SubTaskId = string

export type SubTask = {
  id: SubTaskId
  title: string
  profile: TaskProfile
  testStrategy: TestStrategy
  agentId: string | null
  status: 'pending' | 'running' | 'listening' | 'done' | 'failed'
  dependsOn: SubTaskId[]
  contextFor: SubTaskId[]
  result: { summary: string; artifacts: string[] } | null
}

export type TaskGraph = {
  rootMessage: string
  difficulty: Difficulty
  nodes: Record<SubTaskId, SubTask>
  correlations: Array<{ between: [SubTaskId, SubTaskId]; reason: string }>
}

export type A2ASubscription = {
  subscriberAgentId: string
  ownsTaskId: SubTaskId
  triggersOn: SubTaskId[]
  triggerCount: number
  lifecycle: 'until-correlated-tasks-done' | 'until-session-end'
}
```

### 5.3 持久化

| 文件 | 用途 |
|---|---|
| `~/.nuka/harness/<sessionId>.md` | editor scratchpad（不变） |
| `~/.nuka/coordination/<sessionId>.json` | TaskGraph 快照 |
| `~/.nuka/coordination/<sessionId>.subs.json` | A2ASubscription 注册表 |

### 5.4 EventBus 新事件

```
coordination.task.created    { taskId, agentId? }
coordination.task.started    { taskId, agentId }
coordination.task.completed  { taskId, agentId }
coordination.a2a.dispatched  { from, to, reason }
```

## 6. Triage 流程

```
user message
   ↓
LLM fork（small fast model）
   输入：user message + 仓库摘要 (10 行)
   输出：JSON Schema { profile, difficulty, testStrategy, reasoning }
   重试：2 次；最终失败 fallback {feature, medium, tdd}
   ↓
ask_user_question（multiSelect 单题展示三轴当前选择，允许覆盖）
   ↓
HarnessState.triage = { ..., userConfirmed: true }
```

`/harness retriage` 命令重跑该流程；用户也可在三轴任一项后追加自然语言（"我觉得这个比 medium 简单"），触发再次 fork。

## 7. Stage 矩阵

profile 维度（YAML）：

```yaml
# assets/harness/profiles.yaml
profiles:
  feature:
    stages: { brainstorm: mandatory, spec: mandatory, plan: mandatory, search: mandatory, implement: mandatory, review: mandatory, recap: mandatory }
  debug-fix:
    stages: { brainstorm: optional, spec: optional, plan: mandatory, search: mandatory, implement: mandatory, review: mandatory, recap: mandatory }
  refactor:
    stages: { brainstorm: optional, spec: mandatory, plan: mandatory, search: mandatory, implement: mandatory, review: mandatory, recap: mandatory }
  investigate:
    stages: { brainstorm: mandatory, spec: optional, plan: optional, search: mandatory, implement: forbidden, review: optional, recap: mandatory }
  doc:
    stages: { brainstorm: optional, spec: optional, plan: optional, search: mandatory, implement: mandatory, review: optional, recap: mandatory }
  odd-jobs:
    stages: { brainstorm: optional, spec: optional, plan: optional, search: mandatory, implement: mandatory, review: optional, recap: mandatory }
```

difficulty modifier：

| difficulty | implement 行为 | review 行为 | 全局 verify |
|---|---|---|---|
| simple | 单点 TDD | 单轮自检 | typecheck + test |
| medium | 完整流程不拆 | 单轮 reviewer | + lint |
| hard | 拆 sub-task + DAG 调度 | 多轮 reviewer + correlation test | + 跨 task review |
| hell | 拆 sub-task + a2a 订阅 | 多轮 + correlation + 复核 | 全套 + a2a 闭环验证 |

合并算法：`effectiveStage = max(profileReq, difficultyReq)`，但 `forbidden` 永不上升。

testStrategy 维度（独立 implement/review 的测试形态）：

| testStrategy | implement 写什么测试 | review 关联测试 |
|---|---|---|
| tdd | 经典红绿重构（unit） | 否 |
| cross-module | unit + integration | 是（启用 correlation.ts） |
| multi-test | unit + integration + property/fuzz | 是 + 多 reviewer agent 多角度 |

## 8. Coordination 模块

### 8.1 taskGraph.ts

```ts
class TaskGraph {
  add(task: SubTask): void
  link(from: SubTaskId, to: SubTaskId, reason: string): void
  ready(): SubTask[]
  markRunning(id, agentId): void
  markListening(id): void
  markDone(id, result): void
  toposort(): SubTaskId[]
  toJSON(): unknown
  static fromJSON(raw): TaskGraph
}
```

### 8.2 scheduler.ts

| difficulty | 调度行为 |
|---|---|
| simple | 不入图，主 agent 直接 implement |
| medium | 不入图，主 agent 完整 stage 流程 |
| hard | 进入 plan 时 `decomposeTask()` 拆分 → 拓扑层级 dispatch（同层 `pipeline_run` 并行，跨层串行） |
| hell | 同 hard，每个 sub-task 完成后默认 `markListening`，注册 A2ASubscription |

### 8.3 a2aRouter.ts

监听 `coordination.task.started`：找出所有 `triggersOn` 命中本 task 的订阅，让订阅 agent（仍 listening）通过 `messaging/router.ts` 主动给新 task 的 agent 发 message。`buildSupplement()` 从 owner task 的 result + scratchpad 抽取相关上下文。

`triggerCount ≤ 3` 死循环上限；`lifecycle = 'until-correlated-tasks-done'` 时所有 triggersOn 完成则自动 `markDone` 释放订阅。

### 8.4 correlation.ts

```ts
async function generateCorrelationTests(graph: TaskGraph, deps): Promise<TestSpec[]>
```

为有 `correlations` 的 sub-task 对生成关联测试文件（`test/correlation/<hash>.test.ts`），review stage 强制运行。`hard/hell` 难度或 `cross-module/multi-test` 测试策略下自动启用。

### 8.5 decompose.ts

LLM fork prompt：输入根 message + profile + difficulty，输出 `{ tasks: SubTask[], edges: [from, to, reason][] }`。zod 校验 + 2 次重试 + 失败 fallback "单点直跑"。

## 9. Editor 行为更新

`src/core/agents/builtin/editor.ts` system prompt 新增：

- 三轴语义说明。
- hard/hell 时必须先 `coordination_decompose`，再 dispatch。
- hell 时在每个 sub-task 启动前主动检查订阅表，必要时手动触发 `coordination_a2a_send`（兜底事件唤醒漏发）。

新增工具（注册到 builtin）：
- `coordination_decompose(rootMessage)` → TaskGraph
- `coordination_status()` → 当前图 + 订阅状态
- `coordination_a2a_send(fromAgentId, toAgentId, body)` → 手动触发

## 10. 删除清单（硬迁移）

| 删除/修改 | 原因 |
|---|---|
| `src/core/harness/classifier.ts` | 重写为 `triage.ts` |
| `src/core/harness/matrix.ts` 硬编码常量 | 替换为 YAML 加载 + difficulty modifier |
| `src/core/harness/types.ts` 旧 7-class TaskProfile | 替换为新 6 类 + Triage |
| `src/slash/harness.ts` 中老 profile flag/UI | 改为三轴展示 |
| `src/tui/Monitor/*` 中 profile 文案 | 同步更新 |
| 现有 `phase14d-harness-design.md` | 标注 superseded by 本文 |

## 11. 新增清单

- `src/core/coordination/` 整个模块：types / taskGraph / scheduler / a2aRouter / correlation / decompose / persist
- `src/core/harness/triage.ts`
- `assets/harness/profiles.yaml`
- `src/slash/triage.ts`、`src/slash/coordination.ts`
- 工具：`coordination_decompose` / `coordination_status` / `coordination_a2a_send`
- 4 个 `coordination.*` 事件类型

## 12. 测试计划（自身严格 TDD）

| 层级 | 测试 |
|---|---|
| unit | triage JSON 校验、modifier 合并算法、TaskGraph CRUD/toposort、A2ARouter 订阅匹配、scheduler 难度→行为映射、decompose 输出 schema |
| integration | 单 user message 端到端跑 triage→stage→implement，覆盖 4 难度 × 6 profile 抽样 6 组 |
| e2e | hell-feature：3 sub-task DAG，验证 a2a router 在 task B 启动时 agent1 给 agent2 发 supplement message |
| smoke | 旧 7-class 调用点全部触发 TS 编译错误（确认硬迁移彻底） |

## 13. 错误处理与边界

- triage LLM JSON 失败：2 次重试 → fallback `{feature, medium, tdd}` + 显式 prompt 让用户改。
- `coordination/<sessionId>.json` 损坏：尝试重建（仅保留 done 节点），失败则归零并 warn。
- a2a 死循环：`triggerCount ≤ 3` 上限。
- profile.implement = forbidden 在 hell 下仍 forbidden（红线）。
- decompose 输出空：退化为 medium 单点流程（不报错）。

## 14. 与现有 phase 的关系

- 沿用 phase14a 的 `pipeline_run / roundtable / team_create / send_message`。
- 沿用 phase14c 的 recap stage handoff。
- coordination scheduler 内部调用上述原语；只是多记 graph + 订阅表。
- monitor UI 加 4 个新事件 case（不重构）。

## 15. 后续可扩展

- profile YAML 支持加 `writing` / `workflow` 等非代码类（用户已明确）。
- testStrategy 可扩 `e2e-only` / `property-based` 等。
- A2ASubscription 可扩 `lifecycle: 'until-stage-end'` 等更细粒度。
