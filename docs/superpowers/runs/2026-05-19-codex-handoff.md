# Codex Handoff — ink-ui-explorer iteration

**Date**: 2026-05-19
**Author**: kry4r
**Skill source**: `skills/ink-ui-explorer/` (canonical) → mirrored to `~/.claude/skills/` and `~/.codex/skills/` by `scripts/install-skills.mjs`.
**Latest tip**: `a5b3798`

Use this doc to hand off the iter-2+ Nuka TUI iteration loop to Codex. The skill is platform-portable: same `SKILL.md` frontmatter format works in both Claude Code and Codex skills directories.

---

## Install on Codex (one time per machine)

```bash
cd /data/xtzhang/Nuka
npm install   # ensures dev deps exist
npm test -- test/skills/inkUiExplorer.test.ts   # fires pretest install hook
ls ~/.codex/skills/ink-ui-explorer    # should show SKILL.md, package.json, bin/
```

The `pretest` hook (`scripts/install-skills.mjs`) auto-copies the canonical source into `~/.codex/skills/` if `~/.codex/` already exists. Codex auto-discovers skills under `~/.codex/skills/` — no `[skills]` config entry needed.

---

## /goal content for Codex session

Paste the following block into Codex's `/goal` directive (or initial system prompt) to prime an autonomous iteration session:

```
你的目标：用已安装的 ink-ui-explorer skill 继续对 Nuka 的 TUI 做"渲染漏洞抓→修→红先验证"迭代。

skill 入口：`ink-ui-explorer` 二进制（PATH 上的 shim → `nuka explore <verb>`）。verbs: capture | sweep | fuzz | judge | repair。决策规则见 `~/.codex/skills/ink-ui-explorer/SKILL.md` decision rules table。

关键约束：
1. 红先纪律不可让步。每个 fix 必须先有 RED commit（test 加在 `test/ui-auto/fixtures/*.fixtures.tsx` 或对应单测，HEAD 时实证失败），再 GREEN commit（impl 改动，不动测试文件）。author 必须 `kry4r <Nidhogxt@outlook.com>` 经 `--author=` override（不改 git config）。commit message 末尾**不要** Co-Authored-By 行。
2. fixture 临时产物（包括 .ink-explorer/、`.tmp-*`、worktree dump 路径）必须 dot-prefix + 走 `.gitignore` + afterAll cleanup。**严禁**绝对 hardcoded 路径。
3. Mimo provider 已配（`~/.nuka/config.yaml`，selectedModel `mimo-v2-omni`，OpenAI 兼容 endpoint）。如要做对话/工具调用回归，**不要**让 skill 内置的 judge/repair client 直接打 Mimo（skill 默认 Anthropic 形态）—— 让真 Nuka 进程用自身 provider 链路，skill 只观察。
4. 派 subagent 时：探索/调研用 trellis-research 或读 spec；改代码用 trellis-implement（class-2 平台规定 prompt 第一行 `Active task: <task path>`）；review 用 trellis-check。**禁止**单一 subagent 既派调研又派实现——会触发递归 guard。
5. iter-1 已有重要发现：tsx/esm/api 的 `Date.now()` namespace 让每次 `tsImport` 产生独立 Ink 实例；fix 是 `tsx.register()` 单次 + native `import(pathToFileURL(p).href)`。任何新走 `import('xxx.tsx')` 的 explorer 路径必须先 `await ensureTsxRegistered()`（导出自 `src/core/testing/explorer/sweep/fixtureLoader.ts`）。

每轮工作流（target ≈30–90 分钟）：
1. 选 1 个 Nuka surface（候选见 §"待迭代 surface"）。
2. `nuka explore sweep --fixture-root=test/ui-auto/fixtures --no-judge --out=.ink-explorer/iter-N/` 抓 baseline。
3. 写新 fixture 到 `test/ui-auto/fixtures/iter-N-<slug>.fixtures.tsx`，commit 为 RED。
4. Re-sweep。失败若是 L1 invariant false positive：先修 invariant（见 §"invariant 改造规则"）。失败若是真 bug：分类（component / harness wiring）→ 派 subagent 修 → GREEN commit。
5. 每轮结束在 `docs/superpowers/runs/YYYY-MM-DD-iter-N.md` 写 run record（包括 failure 数量 delta、commit SHA、剩余 follow-up）。
6. 每个有意义 phase 结束跑 review（class-2 平台用 trellis-check；多评审用并发 trellis-research）。

如何停下：
- 单轮超过 90 分钟没收口 → 暂停，写 partial run record。
- 出现需要 ≥3 个 production tests 改造的 refactor → 暂停，写 follow-up task，让用户决定。
- 发现需要改 `~/.codex/skills/ink-ui-explorer/SKILL.md`（spec drift） → 暂停，写 spec update proposal。
```

---

## 待迭代 surface（priority order）

按用户先前 brainstorm 痛点 + iter-1 后剩余覆盖空白：

| Priority | Surface | Why                                                                                  | Likely fixture shape |
|---|---|---|---|
| P0 | **Welcome useTerminalSize refactor** (task #23) | iter-1 cjk-model-name 2 个失败的真正根因。production code 绕过 Ink useStdout。修它会破 6 个 production tests（agentCall, TasksPanel, toolCall, SubagentDetail, Field, PluginConfigDialog）—— 改造规模 ~90 LOC. | 现有 `iter-1-welcome-content-variants.fixtures.tsx` cjk-model-name case 自动复用为 RED. |
| P0 | **ModelPicker / 各 modal 关闭后 layout 重建** | M1-M6 修了 Bug B (ModelPicker exit corruption)，但其他类似 modal 关闭 race 应该还很多 (CommandPalette? Settings dialog? Help screen?). | 模拟开/关 modal 后渲染 frame，断言 prologue/Static channel 不污染 live area. |
| P1 | **Slash command 实时反馈 + stdin 处理** | 慢字键、字符省略、CJK 输入法事件未覆盖. | fuzz verb 喂 random stdin + 检查 grid hash 不出现 panic-shaped 输出. |
| P1 | **Messages 长会话 prologue/scrollback 协议** | hasEverStreamed 简化后 (M6) Edge cases 没全验。Static-only append vs live-area 转换. | Fixture 模拟 ≥50 条消息 + viewport resize，断言 Static count 单调递增。 |
| P2 | **PlanMode 进出 + lockout 边界** | 进/出 PlanMode 的 keyboard lockout 在 viewport resize 期间有竞态隐患. | 在 lockout 状态 fire viewport resize，断言无渲染漂移。 |
| P2 | **Status line / 底栏** | Vim mode 切换、token usage 指示、loading 闪电 (⚡ rotation per memory). | Narrow viewport (60×30/70×30) 下断言所有 indicators 都能容纳. |
| P3 | **Subagent loop UI** | 嵌套对话框、indent guides、parent/child task tree. | 多级 indent + viewport 70×30 容纳测试. |

---

## 任务清单（actionable，按依赖排序）

### Tier 1 — 直接可执行（依赖已就绪）

- [ ] **#23 完成 Welcome useTerminalSize → useStdout 改造**  
  Files: `src/tui/hooks/useTerminalSize.ts`, `test/tui/agentCall.test.tsx`, `test/tui/Tasks/TasksPanel.test.tsx`, `test/tui/toolCall.test.tsx`, `test/tui/Tasks/SubagentDetail.test.tsx`, `test/tui/Submenu/settings/Field.test.tsx`, `test/tui/dialogs/PluginConfigDialog.test.tsx`.  
  Pattern: 把 `Object.defineProperty(process.stdout, 'columns', {value: 60, configurable: true})` 换成 mount 时 `<StdoutContext.Provider value={{stdout: makeFakeStdout(60), write: ...}}>` 包裹，或直接传 `stdout` 给 `ink-testing-library` 的 render() (如果 API 支持).  
  Expected outcome: iter-1 cjk-model-name 失败消解、6 个 production tests 仍 green、npm test 整体 4997+ pass.

- [ ] **iter-2 ModelPicker 关闭 race fixture**  
  写一个 fixture 模拟 ModelPicker.onSave → closeSubmenu() 流程，在 viewport 60×30/79×24/100×30 抓 frame，断言（a）LOGO 不被 squash（reuse `getLayoutMode` assertion），（b）conversation area 非空（reuse `shouldPrologueGoStatic` gate）。预期初始 PASS（M6 已修核心 race），但加这个 fixture 锁定回归。

- [ ] **修 capture verb 的 `--no-snapshot` flag** (gap from Mimo dogfood)  
  Mimo dogfood agent 发现 `nuka explore capture` 默认会写 JSON snapshot 到 `captures/` 目录，对一次性 inspect 不友好。加一个 `--stdout-only` flag 直接打 ASCII 到 stdout，不落盘。

### Tier 2 — 需要新 skill verb（feature work）

- [ ] **`nuka explore live-capture` verb**  
  当前 skill 只能观察静态 fixture。加 `live-capture --cmd "node dist/cli.js" --duration 30 --out frame.txt` —— spawn 子进程，PTY 拦截 stdout，按时间窗采样 frame 落盘。这是 Mimo dogfood 走 Demo C 而非 Demo A 的根因。
- [ ] **`nuka explore diff` verb**  
  对两个 capture 结果做 grid-level diff（cell-by-cell），输出 ANSI-highlighted 差异 + violation breakdown。Useful for regression demo.

### Tier 3 — M7 review concerns followup (低优，全部 defer 中)

- [ ] T1 - SKILL.md decision-rule table 加 judge 行（消除 verb pin gap）.
- [ ] T3 - install-skills.mjs 加 `NUKA_SKIP_INSTALL_SKILLS=1` opt-out env.
- [ ] T5 - install-skills.mjs cpSync 并发竞态（加 lockfile 或文件锁）.
- [ ] A1 - 把 spec `2026-05-02-ink-ui-explorer-design.md` §5 的 decision rules 从 bullet 改为 table，与 SKILL.md 对齐.
- [ ] A6 - CI grep pattern 当 wired 时，把 `core/testing/explorer` 精确为 `core/testing/explorer/(runner|verifyWorker|index)\.(ts|js)`.

---

## Codex 与 Claude Code 等价的 skill 调用形态

| Action | Claude Code | Codex |
|---|---|---|
| 查看 skill | `Skill ink-ui-explorer` | 自动加载；命令 `ink-ui-explorer capture ...` 直接走 PATH shim |
| 派 review subagent | `Agent { subagent_type: superpowers:code-reviewer }` | `agents/trellis-check.toml` |
| 派 implement subagent | `Agent { subagent_type: general-purpose, model: sonnet }` | `agents/trellis-implement.toml` |
| 临时目录约定 | `.tmp-test-*/`+ `afterAll` cleanup | 同左 |

---

## Honest limits

1. Skill **仍是 fixture-only**。Mimo dogfood 走 Demo C（HTTP call → static fixture → sweep）。要做真 live Nuka 观察，需要 Tier 2 的 `live-capture` verb.
2. `nuka explore capture` 默认产 snapshot，对 ad-hoc inspect 不便（见 Tier 1 第三条）.
3. tsx-double-Ink 问题虽在 `fixtureLoader` 和 `capture` 解了，但 `L4_repair/verifyWorker.ts` 仍用 `tsImport` 走 worker_threads。这条目前没碰到问题，但加新 explorer 路径前要确认。
4. 6 个 production tests 依赖 `process.stdout.columns` 直接 patch 的旧模式 —— useTerminalSize refactor 必带这 6 个改造，否则 npm test 会炸 7 处（包括 iter-1 Welcome）.
