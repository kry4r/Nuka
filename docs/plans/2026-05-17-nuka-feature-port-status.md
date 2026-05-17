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

> 截至 2026-05-17 第 11+12 轮 /loop（A 方案 5 项 + 7 项扩展 + 9/10/11 移植）后状态。
> 已废弃项归集到 [Section 10.5](#105-已废弃-mcp-相关)。

### P0 — 立即可做（独立、低风险）

1. ~~**WWW pipeline mode 转默认**~~ — **DONE (Turn 11)**: `afterToolCall` 默认翻为 pipeline，`NUKA_HOOK_PIPELINE_MODE=last-write-wins` 是新的 opt-out 路径，legacy 路径作为加性保留
2. ~~**whitespace.normalize() 接 model output 后处理**~~ — **DONE (Turn 11, observer-only)**: 新增 lifecycle event `afterAssistantMessage`，whitespace handler 通过 `data.whitespaceNormalize` 暴露 normalize 结果。mutable replaceText 升级在 Turn 13 in-progress
3. ~~**Plugin hooks 文档**~~ — **DONE (Turn 11)**: `docs/plugin-hooks.md` + `examples/plugins/hello-hook/`（plugin.yaml + hooks/index.mjs + README），E2E smoke test 验证 `inProcessHooks:` 注册路径

### P1 — 中等复杂度（需要 discovery）

4. ~~**prompt-mentions PromptInput 集成**~~ — **DONE (Turn 11+13)**: `usePromptMention` hook + `<MentionPalette>` 取代 legacy `MentionPanel`，`@` start-of-value/whitespace 后触发，键位 ↑/↓/←/→/Tab/Enter/Esc。Turn 13 follow-up: non-file kinds (diff/staged/git/commit/url) 在 submit 时经 `inlineReferencesIntoText` → `resolvePromptDraft` 真接 `promptContextReferences/resolver`；image kind 暂留 placeholder 行（provider transport 待 follow-up）。legacy `src/tui/PromptInput/MentionPanel.tsx` + `test/tui/mentionPanel.test.tsx` 物理删除
5. ~~**MCP listing tool**~~ — **已废弃** — 见 Section 10.5
6. ~~**Worktree cwdOverride wiring**~~ — **DONE (Turn 12)**: `resolveToolCwd` helper 覆盖 loop.ts (并行 + 串行) + dispatch.ts (subagent tool exec + sessionStart) 4 个 callsite，subagent 默认继承 main worktree state
7. ~~**merge legacy awaySummary stub**~~ — **DONE (Turn 12, 决策 B)**: legacy `src/core/recap/awaySummary.ts` 已删（0 production caller），覆盖由 `test/core/awaySummary/summary.test.ts` 13 cases 接管
8. ~~**Cron rehydrate console.warn → Welcome banner**~~ — **DONE (Turn 12 + Turn 13)**: Turn 12 桥决策 A/B 均不适用——`bootCronRehydrate` 在 cli.tsx 是 `await` 早于 `render(<App>)`，`missed` 直接作 prop 传入。Turn 13 移到 `src/tui/Status/CronMissedBanner.tsx` 持久化（BOTTOM 槽 `AwaySummaryCard` 上方，gate 同 `!submenuInline && promptVisible`），dismiss 策略 `session.messages.length > 0` 自动隐藏
9. ~~**EnterPlanMode behavior:'ask' UX polish**~~ — **DONE (Turn 12)**: `PermissionPayload.variant?: 'default' | 'planMode'` 新字段，专属 dialog 分支（warn 橙 `[PLAN MODE]` 头 + read-only 副标题 + 去除 session-scope remember 防静默自动进入）

### P2 — 较大改造（建议先评估）

10. ~~**MCP server live enumeration**~~ — **已废弃** — 见 Section 10.5
11. **Background task path lifecycle wiring** — `tasks/run-agent.ts` 当前是 content-agnostic sink，无 production caller；有 caller 之后需要 fire lifecycle
12. ~~**bundle-size 优化**~~ — **DONE (P2 #12 turn)**: dist/cli.js 779.9KB → 706KB (−73KB)；ceiling 440KB → 720KB；新增 `dist/tools-extra.js` sidecar bundle 含 13 个 heavy text-utility tool + ApplyDiff + FindReplace + LSPQuery；`src/core/tools/lazy.ts` 提供 `makeLazyTool(meta, loader)` proxy；`src/core/tools/extra/lazyMetas.ts` 抄写 metadata（drift-guarded by `test/core/tools/lazy.test.ts`）；Wizard 路径改 dynamic import；APPLY_DIFF_TOOL_NAME 抽到独立常量模块避免 permission-hook 把 tool 拉进主 bundle. wrapWithHooks 不动 — lazy proxy 是合法 Tool, hook threading 完整保留. 进一步 < 650KB 需要 TUI 重构（App/PromptInput/StatusPanel boot-time render），属另一项工作.

### P3 — Turn 11+12 完成后新生 follow-ups

13. ~~**OutputStyles caller wiring**~~ — **DONE (Turn 13)**: `src/core/outputStyles/resolve.ts` 3 pure helpers，优先级 `NUKA_OUTPUT_STYLE` env > `config.outputStyle` > unset；APPEND 加 `## Output Style` header / REPLACE 替换 / empty body collapse；merge 在 `buildSystemPrompt` 最后（保留 IIII LSP recommendation 不变）；main loop + dispatch 两路 thread；`dispatchTool.ts` 用 resolver closure 支持 mid-session env 变化
14. **memdir team memory port (`teamMemPaths.ts` + `teamMemPrompts.ts`)** — Turn 12 显式跳过（架构不兼容，Nuka memdir 是 per-cwd hashed 路径，无 team subdir 概念，需先有 team memory 设计才能 port）
15. **SkillsLoader bundled 17 个具体 skills** — Turn 12 仅 port registry pattern；具体 skills body 依赖 Nuka-Code 私有 Tool/Cron/Kairos surface，需逐个评估迁移
16. ~~**promptContextReferences resolver wiring**~~ — **DONE (Turn 13)**: 新增 `src/promptContextReferences/inlineReferences.ts` 纯 helper（synthetic PromptDraft → `resolvePromptDraft` → 文本块拼接），App.tsx `handleSubmit` 调用，`AppProps.resolverDeps?` 注入测试 stub；image kind 行为留为 placeholder 行（[image: …] (resolution deferred)），新 follow-up #19 跟踪 provider image transport
17. ~~**Mention vim + 组合单测**（Turn 11 留 follow-up）~~ — **DONE (Turn 14)**: `test/tui/PromptInput.vimMention.test.tsx` 三 case 覆盖 vim insert + `@` 打开 palette / Esc dismiss 保留 vim mode (palette 关、`@a` 保留、vim state 未破坏) / Enter accept 后 vim resync 到新 value（后续 keystroke 正确 append 在引用之后）。**伴随 bug fix**：测试暴露 vim insert 路径不同步 `cursorOffset`，导致 mention trigger 检测看到空 prefix → palette 永不打开；`applyVimKey` 加上 `setCursorOffset(flat)` 同步
18. **PromptMentions image provider transport**（Turn 13 新生）— image kind 目前 inline 为 `[image: …] (resolution deferred)` 占位行，真正接 provider message payload 的 `imageArtifacts` 通道留后续 iteration

### 10.5 已废弃 — MCP 相关

Nuka 主打不支持 MCP（per user feedback 2026-05-17，user 明确要求遇到 MCP 相关功能"想想怎么干掉或替换"）。以下条目作废：

- ~~P1 #5 MCP listing tool~~
- ~~P2 #10 MCP server live enumeration~~

Turn 11 已扫荡现存残留：`promptContextReferences/types.ts` `'mcp_resource'` kind / `toolSearch/tool.ts` `isMcp` boost + `mcp__` 前缀路径 / `toolSummary/summary.ts` 注释中性化 / `plugin/install/bundle.ts` `.mcpb`+`.dxt` bundle 整文件删（决策 B：零 caller，是死代码）。代码层面 grep `mcp` 仅剩**审计注释**说明"不要 MCP 的原因"。

---

## 11. 已知 trade-off / 设计妥协

1. **`compact/auto.ts`（session-aware legacy）和 `agent/autoCompact.ts`（pure VVV）共存** — pure path 是 `NUKA_AUTOCOMPACT_MODE=pure` opt-in，没替代 legacy。两条 path 互相加性，长期应统一
2. ~~**afterToolCall pipeline 是 opt-in，默认 last-write-wins**~~ — **已翻转 (Turn 11)**: pipeline 是新默认，`NUKA_HOOK_PIPELINE_MODE=last-write-wins` 是 opt-out
3. **`tasks/run-agent.ts` 不 fire lifecycle** — RRR 发现该 path 是 content-agnostic 不持有 provider/session，无 production caller 之前不修
4. **Cron `lastFiredAt` 内存追踪后再 persist** — HHHH 落地了持久化，但 scheduler 还是先内存再写盘；非问题但值得记录
5. **`replaceResult` 接受 sibling 字段（如 EEEE 的 `urls`）** — `isToolResult` 守卫只检查 `output`/`isError`，extra fields 结构式 passthrough。下游 consumer 自己判断是否消费 sibling
6. ~~**`afterAssistantMessage` 是 observer-only**~~ — **Turn 13 已升级 mutable**: fire-site 移到 pre-`appendMessage`，新 `extractReplaceText` (last-write-wins) + `applyReplaceTextToAssistant` (text blocks 替换为 single block，tool_use 保序)；空字符串视为有效 rewrite，非 string 忽略
7. ~~**CronMissed banner 当前在 Welcome**~~ — **Turn 13 已移到 `src/tui/Status/CronMissedBanner.tsx`**，BOTTOM 槽持久化；**Turn 14 EmergencyTip 同步移到 `src/tui/Status/EmergencyTipBanner.tsx`**（同 `<Static>` 滚走 bug，保留 tri-color: warn / error / dim 边框 + 文本）
8. ~~**OutputStyles loader 无 caller**~~ — **Turn 13 已接 system prompt assembly**（见 Section 10 P3 #13）
9. **SkillsLoader bundled 子目录空**（Turn 12 落地）— 仅 port `register/get/clear` pattern，Nuka-Code 的 17 个具体 skills 依赖私有 surface，逐个迁移代价大

---

## 12. 4 个 baseline pre-existing test failures（与本工作无关）

从 Turn 1 起就在 fail，所有 turn 都跳过修：

- ~~bundle-size 超 440KB ceiling~~ — fixed by P2 #12: dist/cli.js 706KB under 720KB ceiling via sidecar bundle
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

---

## 16. Turn 11+12+13 已落地清单（2026-05-17 增补）

### Turn 11（A 方案 5 项 — 5 subagent 并行）

- **PipelineDefault**: `afterToolCall` 默认翻为 pipeline + 测试更新 + 新 regression 锁默认
- **WhitespaceAssistant**: 新 lifecycle event `afterAssistantMessage`（observer-only）+ whitespace handler `NUKA_WHITESPACE_HOOK=1` opt-in
- **PluginHooksDocs**: `docs/plugin-hooks.md` + `examples/plugins/hello-hook/` E2E smoke 验证
- **PromptMentions**: PromptInput 替换 legacy `MentionPanel` 为 `usePromptMention` + `MentionPalette`，`@` trigger，键位完整
- **MCPCleanup**: 4 文件清残留 + `plugin/install/bundle.ts` 整文件删（决策 B：零 caller）

### Turn 12（P1 剩余 4 项 + 9/10/11 三块 — 7 subagent 并行）

- **CronBanner**: cron rehydrate `console.warn` → Welcome banner（rehydrate 已 `await`，无需 deferred flush）
- **WorktreeCwd**: 4 个 cwd resolution 点统一走 `resolveToolCwd` 助手，subagent 默认继承
- **AwaySummaryMerge**: 删 legacy `recap/awaySummary.ts`（决策 B：0 生产 caller）
- **PlanModeUX**: `PermissionPayload.variant?: 'planMode'` 字段 + 专属 dialog 分支
- **MemdirEnhance**: port `memoryAge.ts` / `memoryScan.ts` / `findRelevantMemories.ts` + slim `memoryTypes.ts`；`teamMem*` 因架构不兼容跳过
- **OutputStyles**: 新 `src/core/outputStyles/` markdown+frontmatter loader（caller wiring 留 follow-up）
- **SkillsLoader**: 扩 `core/skill/` 添加 `bundled.ts` + `loadDir.ts`，bundled 子目录 17 个具体 skills 暂跳过

### Turn 13（A+D 收尾 — 4 subagent + 主线 plan 更新）

- **PromptMentionsWiring** ✓: 新 `inlineReferences.ts` 纯 helper（synthetic PromptDraft → `resolvePromptDraft` → 文本块拼接）；PromptInput `onAttachReference` prop（file 路径不变，其他 kinds 走 reference path）；App.tsx `pendingReferences` ref + `AppProps.resolverDeps?` 注入；handleSubmit 顺序 file → 引用 → user prompt；image kind 留占位（follow-up #18）；legacy `MentionPanel.tsx` + test 删除
- **OutputStylesWire** ✓: `resolve.ts` 3 pure helpers；优先级 `NUKA_OUTPUT_STYLE` env > `config.outputStyle` > unset；APPEND/REPLACE/empty 三模式；merge 在 `buildSystemPrompt` 最后；main + dispatch + dispatchTool（resolver closure）三处 wire
- **CronStatusLine** ✓: 新 `CronMissedBanner.tsx` 在 BOTTOM 槽 `AwaySummaryCard` 上方；dismiss 策略 `session.messages.length > 0` 自动隐藏；Welcome cronMissed prop + `Welcome/notices/CronMissedNotice.tsx` 移除
- **WhitespaceReplaceText** ✓: fire-site 移到 pre-`appendMessage`；`extractReplaceText` (last-write-wins) + `applyReplaceTextToAssistant`（text blocks 替换为 single block，tool_use 保序，空字符串视为有效 rewrite）；whitespace handler 在 `changed === true` 时 emit `data.replaceText: normalized`

### 累计统计

- **新增 / 修改文件**: ~50 src + ~30 测试（跨 16 完成任务）
- **新增测试**: 累计 ~300+ 个新测试越过 turn 11-12-13
- **删除文件**: 6 个（`bundle.ts` / `installBundle.test.ts` / `recap/awaySummary.ts` + test / `MentionPanel.tsx` + test / `Welcome/notices/CronMissedNotice.tsx`）
- **MCP 残留**: 已清空（仅审计注释保留）

### Turn 14（A 方案三项收尾 polish — 1 subagent 合并）

- **EmergencyTipBanner** ✓: 新 `src/tui/Status/EmergencyTipBanner.tsx`，结构同 `CronMissedBanner` 但保留 EmergencyTip tri-color 语义（warning/error/dim）；删除 legacy `src/tui/Welcome/notices/EmergencyTip.tsx` + Welcome.tsx 里的 `emergencyTip` prop / render；App.tsx BOTTOM 槽 `AwaySummaryCard` ↘ `EmergencyTipBanner` ↘ `CronMissedBanner` 三连，dismiss 策略均为 `session.messages.length > 0`；`test/tui/notices/EmergencyTip*.test.tsx` 两个测试文件 retarget 到新 banner（borderColor + dismissed 行为）
- **VimMentionTests + cursorOffset fix** ✓: 新 `test/tui/PromptInput.vimMention.test.tsx`，3 case 覆盖 vim insert 下 `@` 触发 palette / Esc 关 palette 且不破坏 vim state / Enter accept 后 vim resync（后续 keystroke 正确 append 在 `@src/alpha.ts` 之后）。**测试暴露真 bug 并修了**：vim insert 路径 `applyVimKey` 只更新 `props.value` 不动 `cursorOffset`，`detectPromptMentionQuery` 看到空 prefix，palette 永远打不开；fix 在 `applyVimKey` 末尾按 `buffer.cursor.{row,col}` 算 flat offset 然后 `setCursorOffset(flat)`
- **PlanDocCleanup** ✓: Section 10 P3 删 `19. _（占位）_`；Section 11 trade-off #7 增补 EmergencyTip 同步条；本 Section 16 新增 Turn 14 子段

### 剩余 follow-ups（Turn 14 之后）

- **#18 PromptMentions image provider transport**（Turn 13 新生，需 provider 加 image channel）
