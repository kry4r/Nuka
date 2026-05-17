# Nuka ← Nuka-Code 自动功能演化 — 状态快照

> 截至 2026-05-17，10 轮 `/loop` 自主演化累计 96 个 feature。本文记录现有架构、落地清单、deferred follow-ups。

---

## 1. 工作模式

通过 `/loop` 动态模式运行自主演化：每个 turn 派 2-4 个 subagent 并行实现，主线只编排 + 验证（`npx tsc --noEmit` + 目标测试），iter 之间不留空档，turn 之间用 60-120s 最小 wakeup 保活。

**核心 invariant：**
- 每个 hook handler 默认 off 或保守，env opt-in 不破坏现有行为
- subagent 派发实现，主线只验证（feedback memory: implementation-via-subagent）
- 加性优先于替换（新 path 和 legacy path 共存）
- strict TS，禁 `any` / `@ts-ignore`，禁加新 npm deps

---

## 2. 八个已成熟的子系统

| 子系统 | 核心模块 | 闭环状态 |
|---|---|---|
| **Hook 系统** | `src/core/hooks/` | registry + wrapTool + pipeline/replaceResult/skip + 7 handler + plugin 注入 + lifecycle 5 events + shell↔in-process bridge |
| **Plan mode** | `src/core/planMode/` + `src/core/permission/` | tool 调用 → PermissionHint='ask' askUser → state 翻转 → Session.mode='plan' → PermissionChecker gating + TUI 红章 |
| **Cron** | `src/core/cron/` | scheduler tick + `lastFiredAt` 持久化 + REPL agent prompt 注入闭环；durable + session-only 两种 task |
| **AutoCompact** | `src/core/agent/autoCompact.ts` | Pure orchestrator + production wire（loop.ts 旁加性集成 legacy auto.ts）+ beforeAutoCompact veto |
| **AwaySummary** | `src/core/awaySummary/` + `src/tui/Recap/` | idleWatcher + poke() 接 PromptInput keystroke + LLM recap + TUI banner + 第一次 keystroke dismiss |
| **LSP** | `src/core/lsp/` | 7-action LSPQuery + subagent system prompt 推荐使用 |
| **Subagents** | `src/core/agents/` | dispatch + hookRegistry threading + YAML/JSON definition loader |
| **Plugin** | `src/core/plugin/` | `inProcessHooks:` sidecar field 让 plugin 注册 in-process hook handler |

---

## 3. 已落地清单（按 turn）

### Turn 1-4（基础 + 编译期 Hook 系统）

- 全部 src/core/<area>/ pure libraries：slug、glob、urlExtract、textStats、whitespace、caseConvert、jsonFormat、jsonEscape、wordWrap、truncate、codeBlocks、stringWidth、pathDisplay、duration、ansi、fileSearch、retry 等约 24 个
- ~38 个 Tool surface（agent-callable）：SlugTool、FindReplaceTool、TextStatsTool、CaseConvertTool、UrlExtractTool、GlobMatchTool、WhitespaceTool、JsonFormatTool、CodeBlocksTool、TruncateTool、WrapTextTool、FileSearchTool、RecentFilesTool、FormatDurationTool、AwaySummaryTool、HookListTool 等
- Hook 系统 infra（ZZ）+ LIVE wiring into tool execution（DDD，通过 `wrapWithHooks` 包每个注册的 tool）
- retry helper（EEE）
- ApplyDiffTool surface + FindReplaceTool compound（VV）

### Turn 5（JJJ-SSS）

- **JJJ**: 5 个 lifecycle event 全部 fire（sessionStart/sessionEnd/promptSubmit/afterTurn/beforeAutoCompact）
- **KKK**: ApplyDiff permission gate via hook（`NUKA_APPLY_DIFF_ALLOWED_ROOTS`，从 diff 文本提取目标 path）
- **LLL**: pathDisplay afterToolCall hook（**发现 afterToolCall 是 last-write-wins 不是 pipeline**）
- **MMM**: Subagent definition loader（YAML/JSON，扫 `.nuka/subagents/`）
- **NNN**: jsonFormat afterToolCall hook（compact JSON pretty-print）
- **OOO**: recentFiles 磁盘持久化（原子 tmp+rename，`~/.nuka/recent-files.json`）
- **PPP**: StructuredOutputTool 测试加固
- **QQQ**: TokenCountTool（count/estimate/budget 3 actions）
- **RRR**: Subagent dispatch hookRegistry threading（context: 'subagent' 区分）
- **SSS**: AnsiStyleTool（strip/has/apply 3 actions，41 个 StyleName）

### Turn 6（TTT-YYY）

- **TTT**: Auto-compact 纯 orchestrator（Pure Message[] in/out，sibling 不替代 legacy session-aware auto.ts）
- **UUU**: LSP query Tool 4 actions（**Nuka 已有完整 LSP stack**，加统一 surface）
- **VVV**: autoCompact wired into loop.ts（`deps.autoCompactPure` + `NUKA_AUTOCOMPACT_MODE=pure` env，加性不动 legacy）
- **WWW**: afterToolCall pipeline mode（**解决 LLL 组合性问题**，handlers 现在可串。`NUKA_HOOK_PIPELINE_MODE=pipeline` opt-in）
- **XXX**: WebFetch hardening（39→394 LOC + 30 测试，私网 IP 过滤、redirect 后重校验、AbortSignal 超时）
- **YYY**: Plan-mode tools first pass（**大发现：Nuka 已有 permission infra**，YYY 只 ship 独立 PlanModeState）

### Turn 7（ZZZ-CCCC）

- **ZZZ**: PlanModeState ↔ Session.mode wire + writePlan 持久化（subscribe pattern，YYY 的 tools 现在真触发 PermissionChecker）
- **AAAA**: Slugify wired into worktree naming（`"feat: my thing"` → 合法 slug）
- **BBBB**: WordWrap afterToolCall hook（终端宽度感知）
- **CCCC**: LSP workspace queries（workspaceSymbol/implementation/callHierarchy 3 actions，client capabilities 加 3 项）

### Turn 8（DDDD-GGGG）

- **DDDD**: Plan-mode TUI badge（StatusPanel 三 layout 集成，useEffect 订阅触发重渲染）
- **EEEE**: urlExtract afterToolCall hook（**output 不动只加 sibling `urls` field**）
- **FFFF**: EnterPlanMode `confirm` gate（暂时用 schema field，LLLL 改成 PermissionHint='ask'）
- **GGGG**: Cron scheduler REPL tick（`NUKA_CRON_SCHEDULER=1`，30s tick，overlap-guarded，one-shot 自动删）

### Turn 9（HHHH-KKKK）

- **HHHH**: Cron lastFiredAt 持久化（Option B 加性不 bump version）
- **IIII**: Subagent LSP recommendation（editor + researcher + implementer prompt 加 LSPQuery 推荐）
- **JJJJ**: Cron fire → agent input（CronPromptQueue + runAgent-start drain，**不打断 mid-turn**，`NUKA_CRON_INJECT_PROMPTS=1`）
- **KKKK**: Plugin HookRegistry exposure（`inProcessHooks:` sidecar field，namespaced ID `plugin:<name>:<entry-id>`）

### Turn 10（LLLL-OOOO）

- **LLLL**: PermissionHint `'ask'` 类型（**zero exhaustive switches**，纯加性。EnterPlanMode 从 FFFF custom 字段切换到统一 `needsPermission: () => 'ask'`）
- **MMMM**: TUI idleHook.poke() 接 PromptInput（单 callsite 在 useInput handler）
- **NNNN**: awaySummary recap TUI banner（复用已有 AwaySummaryCard，第一次 keystroke 同时 poke + dismiss）
- **OOOO**: shell-hook → in-process bridging（`shellHookExecuted` event，side-channel 不破坏 shell hook 语义）

---

## 4. 7 个内置 hook handler

| Handler | Event | 默认 | 触发条件 |
|---|---|---|---|
| recentFiles-auto-touch | beforeToolCall | ✓ 默认开 | Read/Edit/Write |
| auto-truncate-output | afterToolCall | ✓ 默认开 | 输出超 8000 字符 |
| apply-diff-permission | beforeToolCall | env opt-in | `NUKA_APPLY_DIFF_ALLOWED_ROOTS=<paths>` |
| path-display-rewriter | afterToolCall | env opt-in | `NUKA_PATH_DISPLAY_HOOK=1` |
| json-format-pretty-printer | afterToolCall | env opt-in | `NUKA_JSON_FORMAT_HOOK=1` |
| word-wrap-rewriter | afterToolCall | env opt-in | `NUKA_WORD_WRAP_HOOK=1`（+ `NUKA_WORD_WRAP_WIDTH=<int>`） |
| url-extract-annotator | afterToolCall | env opt-in | `NUKA_URL_EXTRACT_HOOK=1` |

**外部扩展点：**
- 用户：`~/.nuka/hooks.config.{js,mjs}` 或 `cwd/.nuka/hooks.config.{js,mjs}`（GGG）
- Plugin：`plugin.yaml inProcessHooks: <path-to-js>`（KKKK）

---

## 5. Lifecycle events + bridge event

| Event | Payload 关键字段 | Fire 位置 |
|---|---|---|
| sessionStart | sessionId, providerId, model, cwd, resumed, context, agentName | cli.tsx 启动 / dispatch.ts |
| sessionEnd | sessionId, reason: sigint/exit/manual/completed/aborted, context, agentName | SIGINT cleanup / dispatch.ts |
| promptSubmit | sessionId, text, context, agentName | loop.ts user-message append 前 |
| afterTurn | sessionId, stopReason, toolCalls, context, agentName | loop.ts turn 结束 |
| beforeAutoCompact | sessionId, tokensBefore, threshold, contextWindow | loop.ts auto-compact 之前（**支持 `{skip:true}` veto**） |
| **shellHookExecuted** | event, hookId, command(≤500), exitCode, stdoutPreview, stderrPreview, canceled, durationMs, tool? | OOOO bridge from shell hook runner |

`context: 'main' \| 'subagent' \| 'task'` 区分 fire 上下文。

---

## 6. Hook 协议

| 行为 | Handler 返回值 | 备注 |
|---|---|---|
| Allow（默认） | `{}` | 不修改任何东西 |
| Veto tool call | `{ skip: { reason: '...' } }` | beforeToolCall only（KKK 用到） |
| Replace tool result | `{ data: { replaceResult: NewToolResult } }` | afterToolCall（III 引入） |
| Annotate result | `{ data: { replaceResult: { ...result, customField } } }` | EEEE 用 sibling field 模式 |
| Compose with prior | 同上 | pipeline 模式下（WWW），handler B 看到的是 handler A 之后的 result |

**Pipeline vs last-write-wins**：默认 last-write-wins（III 语义）。`NUKA_HOOK_PIPELINE_MODE=pipeline` 切到 pipeline 模式让 handler 串联。

---

## 7. ~38 个 agent-callable tools

按主题分组：

**File ops:** ApplyDiff、FindReplace、FileSearch、RecentFiles、Glob

**Text utils:** TextStats、Whitespace、CaseConvert、JsonFormat、JsonEscape、CodeBlocks、Truncate、WrapText、Slug、UrlExtract、Stringwidth、AnsiStyle

**Code intel:** LSPQuery（7 actions：definition/references/hover/documentSymbols/workspaceSymbol/implementation/callHierarchy）

**Token mgmt:** TokenCount（count/estimate/budget）、EstimateTokens（legacy）、StructuredOutput

**Tools mgmt:** HookList、ToolSearch、ToolSummary

**Time / lifecycle:** Sleep、AwaySummary、FormatDuration

**Cron:** CronCreate、CronList、CronDelete

**Worktree:** EnterWorktree、ExitWorktree

**Subagent:** dispatchAgent、Brief

**Plan mode:** EnterPlanMode、ExitPlanMode、IsInPlanMode

**Tasks:** TaskOutput、TaskStop、TaskList、TaskCreate

**Web:** WebFetch

---

## 8. 磁盘持久化位置

| 内容 | 位置 | 落地于 |
|---|---|---|
| Recent files MRU | `~/.nuka/recent-files.json` (v1) | OOO |
| Subagent definitions | `.nuka/subagents/*.{yaml,yml,json}`（cwd + home） | MMM |
| User hook config | `.nuka/hooks.config.{js,mjs}`（cwd + home） | GGG |
| Plan files | per-cwd via existing `src/core/plan/state.ts` | ZZZ wire |
| Cron tasks | per existing cron persist（含 lastFiredAt，HHHH） | HHHH |

---

## 9. Env 变量参考

| 变量 | 作用 | 默认 |
|---|---|---|
| `NUKA_APPLY_DIFF_ALLOWED_ROOTS` | ApplyDiff path allowlist（逗号分隔） | 未设 = 不 gate |
| `NUKA_PATH_DISPLAY_HOOK=1` | 启用 pathDisplay 后处理 | off |
| `NUKA_JSON_FORMAT_HOOK=1` | 启用 jsonFormat 后处理 | off |
| `NUKA_WORD_WRAP_HOOK=1` | 启用 wordWrap 后处理 | off |
| `NUKA_WORD_WRAP_WIDTH=<int>` | wordWrap 目标宽度 | 100 |
| `NUKA_URL_EXTRACT_HOOK=1` | 启用 URL 抽取注解 | off |
| `NUKA_HOOK_PIPELINE_MODE=pipeline` | afterToolCall 串联 | last-write-wins |
| `NUKA_AUTOCOMPACT_MODE=pure` | Pure auto-compact | session（legacy） |
| `NUKA_CRON_SCHEDULER=1` | 启动 cron tick | off |
| `NUKA_CRON_INJECT_PROMPTS=1` | Cron fire 注入 agent input | off |
| `NUKA_RECENT_FILES_NO_PERSIST=1` | 关 recentFiles 持久化 | on（持久化） |
| `NUKA_WEBFETCH_ALLOW_LOCAL=1` | WebFetch 允许 private IPs | block |

---

## 10. Deferred follow-ups（优先级排序）

### P0 — 立即可做（独立、低风险）

1. **WWW pipeline mode 转默认** — 7 个 handler 都成熟，pipeline 让它们能组合（如 `jsonFormat → pathDisplay → wordWrap → urlExtract`）；当前是 env opt-in
2. **whitespace.normalize() 接 model output 后处理** — 类似 BBBB/LLL，但作用在 assistant 消息而非 tool 输出（需要新 event type 或新 hook 点）
3. **Plugin hooks 文档** — KKKK 加了 `inProcessHooks:` field 但没 example/README

### P1 — 中等复杂度（需要 discovery）

4. **prompt-mentions PromptInput 集成** — `src/promptContextReferences/` + `src/tui/promptMentions/` scaffold 已存在，缺主流程集成（Turn 11 第一次尝试被 503 中断）
5. **MCP listing tool** — 需要先 discovery Nuka 现有 MCP infra（系统里能看到 MCP servers 在跑，所以 plugin 加载 MCP servers 的机制存在）
6. **Worktree cwdOverride wiring** — agent loop 内 cwd 切换
7. **merge legacy awaySummary stub** — `src/core/recap/awaySummary.ts` (legacy) 和 `src/core/awaySummary/summary.ts` (新) 共存
8. **Cron rehydrate console.warn → Welcome banner** — 启动时错过 task 用 banner 提示
9. **EnterPlanMode behavior:'ask' UX polish** — LLLL 已用 PermissionHint='ask'，但 askUser 文案/UI 可以专门 plan-mode 优化

### P2 — 较大改造（建议先评估）

10. **MCP server live enumeration** — P1 #5 列表工具的下一步，需要真正接 client
11. **Background task path lifecycle wiring** — `tasks/run-agent.ts` 当前是 content-agnostic sink，无 production caller；有 caller 之后需要 fire lifecycle
12. **bundle-size 优化** — 长期超 440KB ceiling（基线 fail），需要 lazy register / tree-shake

---

## 11. 已知 trade-off / 设计妥协

1. **`compact/auto.ts`（session-aware legacy）和 `agent/autoCompact.ts`（pure VVV）共存** — pure path 是 `NUKA_AUTOCOMPACT_MODE=pure` opt-in，没替代 legacy。两条 path 互相加性，长期应统一
2. **afterToolCall pipeline 是 opt-in，默认 last-write-wins** — 见 P0 #1
3. **`tasks/run-agent.ts` 不 fire lifecycle** — RRR 发现该 path 是 content-agnostic 不持有 provider/session，无 production caller 之前不修
4. **Cron `lastFiredAt` 内存追踪后再 persist** — HHHH 落地了持久化，但 scheduler 还是先内存再写盘；非问题但值得记录
5. **`replaceResult` 接受 sibling 字段（如 EEEE 的 `urls`）** — `isToolResult` 守卫只检查 `output`/`isError`，extra fields 结构式 passthrough。下游 consumer 自己判断是否消费 sibling

---

## 12. 4 个 baseline pre-existing test failures（与本工作无关）

从 Turn 1 起就在 fail，所有 turn 都跳过修：

- bundle-size 超 440KB ceiling
- cli/offline 某项
- config/scope 某项
- plugin/loader 一项 `realpath /private/var` macOS 差异

---

## 13. 完全没碰的大块（feedback memory 明确排除或没列）

- **Voice / STT / 远控** — feedback memory 排除
- **IDE bridge** — 同上
- **TUI iconMode / theme 系统** — DDDD 集成 plan mode badge 时绕过
- **Provider / model 抽象层** — 没 audit 过
- **Auth / OAuth flow** — 没看

---

## 14. 关键 invariant（跨 turn 必须保持）

1. **每个 hook handler 默认 off 或保守**（env opt-in），不破坏现有用户行为
2. **subagent 派发实现**，主线只编排 + 验证（feedback memory: implementation-via-subagent）
3. **iter 之间不留空档**，parallel 派 subagent，wakeup 用 60-120s 最小保活
4. **加性优先于替换**，新 path 和 legacy path 共存比直接换更安全
5. **strict TS**，禁 `any` / `@ts-ignore`，禁加新 npm deps（除非 package.json 已有）

---

## 15. 测试 / 验证

- 全部新增 / 修改测试均通过 `npx tsc --noEmit` + targeted vitest run
- 不跑全套（避免触发 4 个 baseline pre-fail）
- 累计 600+ 个新增测试跨 10 turns，分布在 ~80 个测试文件

---

*本文档由 `/loop` 主线生成，描述 10 轮自主演化的累计状态。Active memory 文件：`harness-three-axis-refactor-state.md`、`nuka-feature-port-from-nuka-code.md`、`feedback_implementation_via_subagent.md`、`feedback_skip_voice_remote_prefer_practical.md`、`feedback_nuka_loop_no_delay_between_iters.md`。*
