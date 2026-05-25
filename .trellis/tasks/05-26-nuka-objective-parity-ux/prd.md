# Complete Nuka objective parity and UX roadmap

## Goal

Finish the active Nuka objective without narrowing its scope: keep the current
bug-fix set green, replicate the useful parts of `/data/xtzhang/Nuka-Code`'s
subagent system, replicate Codex-style efficient compact behavior, maintain an
up-to-date Claude Code / Codex / Pi feature intake checklist, iterate accepted
features, and keep improving the Ink TUI until common coding workflows feel
clearer, more direct, and more human.

Original objective:

> 完成当前bug修复，之后复刻/data/xtzhang/Nuka-Code中的subagent系统；同时对于compact，需要复刻codex的高效的compact系统；对于新feature，查看claude-code/codex/pi这些的新功能，列出一个清单，之后照着清单迭代；需要设计更好更拟人化的交互，现在的页面交互不直观并且丑,你需要自己更新

## Requirements

- Preserve the current bug-fix scope as a proven baseline and keep the full
  gate green after later edits.
- Track Nuka-Code subagent parity against concrete reference files under
  `/data/xtzhang/Nuka-Code/src/tools/AgentTool/`, not against memory or vague
  similarity.
- Implement only subagent behaviors that map cleanly onto Nuka's runtime:
  stable agent identity, background lifecycle, resume/send/fork semantics,
  worktree isolation, permissions, memory, skills, display metadata, and
  lifecycle observability.
- Track Codex compact parity against concrete Codex source references, including
  `/tmp/openai-codex/codex-rs/core/src/compact.rs` and
  `/tmp/openai-codex/codex-rs/core/src/compact_remote_v2.rs` when available.
- Preserve efficient context survival: native Responses compact, opaque
  compaction item passthrough, retained-message budgets, local microcompact,
  retry/shrink on context-window failures, and visible compact status.
- Refresh Claude Code, Codex, and Pi feature intake from primary sources before
  treating the checklist as current.
- Iterate accepted feature rows only after each row has a small design,
  test surface, and rollback boundary.
- Continue the TUI redesign through real Ink captures/sweeps, with special
  attention to subagent/team visibility, diff/detail review, hook/trust
  visibility, extension/plugin summaries, theme/update UX, and prompt-safe
  interaction.
- Keep `.trellis/spec/frontend/*` aligned with implementation patterns learned
  during the work.

## Acceptance Criteria

- [x] Current bug-fix baseline is verified in the current worktree:
  `git diff --check`, `npm run typecheck`, and the focused regression set for
  lazy slash commands, bundle size, agent lifecycle, tasks, and TUI status/app
  passed on 2026-05-26.
- [ ] Full verification gate passes after final edits: `npm test`,
  `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`.
- [ ] Subagent parity matrix has no unplanned P0 gap against the selected
  Nuka-Code reference behaviors, or every remaining gap is explicitly deferred
  with a documented reason and user-visible boundary.
- [ ] Compact parity has current evidence for native compact, fallback compact,
  provider-visible retained context, microcompact, retry/shrink behavior, and
  TUI compact progress; provider context-management gaps are either implemented
  or explicitly deferred with request-schema constraints.
- [ ] Upstream feature intake records a current-date recheck of Claude Code,
  Codex, and Pi primary sources, including observed latest versions/dates and
  any new accepted/deferred rows.
- [ ] Accepted feature checklist rows implemented in this task have focused
  tests and, for visible Ink changes, captured or swept TUI evidence.
- [ ] Human TUI redesign progress is proven by updated harness tests and
  `ink-ui-explorer` or equivalent sweep output, not only by source inspection.
- [ ] Completion audit maps every original objective requirement to current
  file/test/runtime evidence before the thread goal is marked complete.

## Current Evidence

- Roadmap source: `docs/plans/2026-05-23-nuka-objective-roadmap.md`.
- Feature intake source:
  `docs/plans/2026-05-23-upstream-feature-intake.md`.
- Current bug-fix gate run on 2026-05-26:
  - `git diff --check` exited 0.
  - `npm run typecheck` exited 0.
  - `npm test -- test/slash/lazy.test.ts test/build/bundle-size.test.ts test/build/explorerBundle.test.ts test/slash/simple.test.ts test/slash/goal.test.ts test/slash/permissions.test.ts test/core/agents/agentLifecycleTools.test.ts test/core/agents/spawnTool.test.ts test/core/tasks/manager.test.ts test/tui/app.test.tsx test/tui/Status.harness.test.tsx`
    passed with 11 files / 102 tests.

## Child Workstreams

- Current bug-fix hardening: keep baseline green while later work lands.
- Nuka-Code subagent parity: close true resume/fork, write-scope, hooks/MCP, and
  team/progress gaps.
- Codex compact parity: close provider context-management and richer progress
  gaps if the request/provider model can represent them safely.
- Upstream feature intake: refresh sources, prioritize accepted rows, and avoid
  decorative or risky broad ports.
- Human TUI redesign: improve agent/team workflows, review/detail surfaces,
  trust/extension visibility, and update/theme ergonomics through captures.

## Open Questions

- Which remaining workstream should be the next implementation target after the
  verified bug-fix baseline: subagent true resume/fork, compact provider
  context-management/progress, or TUI agent/team view?

## Notes

- This is a complex parent task. It should own the source requirement set,
  child-task map, final completion audit, and cross-track quality gates.
- Implementation should happen in child tasks unless a parent-level artifact or
  audit is being updated directly.
