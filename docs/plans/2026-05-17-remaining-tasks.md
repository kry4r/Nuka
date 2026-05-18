# Nuka 剩余可做项 — 2026-05-17 快照

> 配套文档：`docs/plans/2026-05-17-nuka-feature-port-status.md`（96 个已落地 feature 状态）。
> 本文只列**可继续推进**的项；已废弃 / 已完成项见状态文档。

---

## A. Plan doc 明确残留 follow-ups（小颗粒）

| # | 项 | 复杂度 | 卡点 / 备注 |
|---|---|---|---|
| A1 | #18 PromptMentions image → provider transport（image artifacts channel） | 中 | 需改 provider message payload schema；当前 inline 为 `[image: …] (resolution deferred)` 占位 |
| A2 | #15 SkillsLoader bundled 17 个具体 skills 逐个迁移 | 大 | 每 skill 依赖 Nuka-Code 私有 Tool/Cron/Kairos surface，需重写；registry pattern 已 port |
| A3 | #11 Background `tasks/run-agent.ts` lifecycle wiring | 小 | **无 production caller**，先做 caller 才有意义；Turn 15 已确认 |
| A4 | trade-off #1 统一 `compact/auto.ts` legacy + `agent/autoCompact.ts` pure 双路 | 中 | 当前 pure 是 `NUKA_AUTOCOMPACT_MODE=pure` opt-in；migrate 全部 caller 后才能删一边 |
| A5 | #14 memdir team memory port（`teamMemPaths.ts` + `teamMemPrompts.ts`） | 大 | 架构不兼容（Nuka memdir 是 per-cwd hashed 路径，无 team subdir 概念）；需先设计 team memory |

---

## B. Nuka-Code 尚未移植板块（按价值排序）

| # | 板块 | 价值 | 说明 |
|---|---|---|---|
| B1 | `cost-tracker.ts` + `costHook.ts` | 高 | 实时 token 用量 / 费用追踪 + TUI 显示，用户可看花了多少 |
| B2 | `keybindings` | 中 | 用户可配置键位（当前 PromptInput/Vim hardcode） |
| B3 | `migrations` | 中 | config schema 版本化迁移系统（v1→v2 升级不破坏旧配置） |
| B4 | `history.ts` 完整移植 | 中 | session 跨启动 resume / 列表浏览；Nuka 现仅有 in-process session |
| B5 | `coordinator` | 中 | multi-agent/session 协调（subagent dispatch 已有，coordinator 是上一层） |

---

## C. 体验 / 质量类（无新功能，固本）

| # | 项 | 说明 |
|---|---|---|
| C1 | baseline 测试审计（2026-05-18 完成）：bundle-size 已修（Turn 15）；plugin/loader macOS realpath 已修（symmetric `realpath` in beforeEach，Linux 上 no-op）；cli/offline 与 config/scope 当前 Linux Node 22 均 green（17/17、1/1），无需修复，状态从 "pre-fail" 改为 "baseline-green"。详见 `docs/plans/2026-05-18-baseline-test-fixes.md` | DONE |
| C2 | Hook 系统完整 reference docs（events × handlers × pipeline 行为表） | 现仅 plan doc 散落，缺统一文档 |
| C3 | E2E smoke CI workflow（github actions runs `tsc + vitest --run targeted`） | 现无 CI |

---

## D. 已禁用项（feedback memory 锁定，不要做）

- Voice / STT / 远控（feedback memory: skip_voice_remote_prefer_practical）
- IDE bridge
- MCP 任何形式（feedback memory 2026-05-17：遇到 MCP 想办法干掉 / 替换）
- Auth / OAuth flow（Nuka invariant：无 OAuth，env-var resolution only）

---

## E. 推荐组合（供后续 turn 直接选用）

| 组合 | 包含项 | subagent 数 | 备注 |
|---|---|---|---|
| 保守 | B1 + C1 | 4-5 | 用户直接受益 + 修长期 baseline |
| 激进 | B1 + B3 + A1 | 5-6 | 多面推进；A1 需先确认 provider schema |
| 小步 | B1 + C2 + A4 评估 | 3 | A4 只先评估，不动手 |
| 文档 | C2 + C3 | 2 | 只补质量基线，不加 feature |

---

*生成于 Turn 16（2026-05-17），状态对应 commit `4fdb218`（Turn 15 收尾）。*
