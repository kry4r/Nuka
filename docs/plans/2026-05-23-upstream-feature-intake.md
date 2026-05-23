# Upstream Feature Intake

Date: 2026-05-23

Purpose: turn current Claude Code, Codex, and Pi feature research into a Nuka
iteration queue. This is an intake list, not an implementation spec; each
accepted feature still needs its own small design, tests, and UI capture when
it touches Ink.

## Sources

| Source | Evidence | Version / date | License / constraint |
| --- | --- | --- | --- |
| Codex | Local repo `/tmp/openai-codex`; remote `https://github.com/openai/codex.git`; docs in `codex-rs/app-server/README.md`, `codex-rs/README.md`, `docs/config.md`, compact sources under `codex-rs/core/src/` | commit `7d47056ea42636271ac020b86347fbbef49490aa`, 2026-05-22 | Apache-2.0 in `/tmp/openai-codex/LICENSE`; implementation ideas can be ported with attribution awareness |
| Claude Code | Official docs fetched from `https://code.claude.com/docs/en/sub-agents` and `https://code.claude.com/docs/en/hooks`; sidebar/docs pages observed for agent view, teams, worktrees, MCP, plugins, skills, scheduled tasks, goals, checkpointing | fetched 2026-05-23 | Docs are proprietary product documentation; use as behavioral reference, do not copy text or assets |
| Pi | Official `https://pi.dev/news/releases` changelog fetched 2026-05-23; links to GitHub `badlogic/pi-mono` and npm `@mariozechner/pi-coding-agent`; recent entries 0.72.0, 0.71.1, 0.71.0, 0.70.6, 0.70.3 | latest observed release page entry: 0.72.0 dated 2026-05-01 | Source/license still needs repository-level confirmation before code porting; use changelog as product-behavior reference only |
| Nuka-Code | Local repo `/data/xtzhang/Nuka-Code`; remote `http://47.93.142.235:3000/Teng/Nuka-Code.git` | commit `b873d92069a30be6187d3a4e57be871b6ae602f5`, 2026-04-23 | Internal reference; direct behavioral target for subagent system |

## Feature Checklist

| Priority | Source | Feature | User value | Nuka equivalent | Gap | Risk | Test surface |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | Codex app-server | `thread/fork`, `thread/resume`, `thread/read`, paged `thread/turns/list` | Users can branch, inspect, and recover work without losing state | `resume_agent` and task sidecars now cover agent metadata/output only | No full transcript persistence/fork semantics for Nuka sessions or subagents | Incorrect fork could mix tool results, cwd, or permissions | Session store tests; provider-visible transcript tests; agent lifecycle tests |
| P0 | Nuka-Code / Claude Code | First-class subagent fork/send lifecycle | Parallel work becomes addressable, resumable, and steerable | `spawn_agent`, `wait_agent`, `close_agent`, `resume_agent`, `send_agent`, `send_input`, and lightweight `fork_context` exist | Missing true transcript/worktree reconstruction and cache-identical fork prefix semantics | Recursive delegation and write-scope collisions | Agent lifecycle tool tests; task sidecar tests; worktree inheritance tests |
| P0 | Codex compact | Remote Responses compact plus retained-message budget and compaction-item passthrough | Long sessions survive without bloating context | Native `/responses/compact`, opaque item passthrough, retry/shrink, and `compact.retainedMessageBudget` are implemented | Missing deeper provider context-management controls | Over-pruning can drop needed tool context | `autoCompact` boundary tests; provider OpenAI tests; simulated context-window error tests |
| P0 | Codex app-server | `thread/compact/start` with streamed progress notifications | Manual compact feels visible and non-blocking | `/compact` now exposes running/done/failed state in the TUI | No streamed subphase progress or task-level compaction event | UI can become misleading if compact runs as hidden turn | Compact command tests; TUI status/task frame tests |
| P1 | Claude Code | Agent view and agent teams | Users can see parallel work and coordinate specialists | TUI task panels classify subagents | No agent-focused view, colors, summaries, or team grouping | Adding another noisy panel can worsen current UX | Ink harness captures; `Tasks/columnReducer` tests |
| P1 | Claude Code / Codex | Worktree-isolated sessions and forks | Safer concurrent edits, less accidental overwrite | `EnterWorktree` exists and dispatch inherits active worktree | `spawn_agent` cannot create/own isolated worktrees | Cleanup and dirty-worktree policy errors can lose work | Worktree store tests; spawn-agent isolation tests |
| P1 | Codex app-server | Persistent goal object with budget/status accounting | Long-running objectives become explicit and inspectable | Thread goal context exists externally in current environment, not Nuka product | No Nuka-native goal store/UI | Bad UX if goal state becomes another verbose status block | Goal store tests; statusline truncation harness |
| P1 | Claude Code / Codex | Hook discovery, trust state, and managed-hook lockdown | Automation becomes reliable without silently running unsafe hooks | Nuka has hook registry and lifecycle events | No UI/listing/trust management; partial task hook metadata only | Security and confusing hook failures | Hook config loader tests; lifecycle task tests |
| P1 | Codex / Claude Code | Plugin/skill marketplace and per-plugin MCP/app summaries | Makes extension ecosystem discoverable | Nuka has plugin loading and skills | No marketplace UX, auth policy metadata, or installed summary view | Scope creep, auth complexity | Plugin loader tests; settings submenu harness |
| P1 | Pi | WebSocket-cached Codex/OpenAI transport | Avoids resending full history on supported providers | Nuka currently streams per request | No cached transport abstraction | Provider-specific complexity and stale context bugs | Provider resolver tests; fake websocket transport tests |
| P1 | Pi | Model thinking-level metadata (`thinkingLevelMap`) | UI only exposes valid reasoning/thinking levels per model | Provider config now supports per-model `effort` capability metadata; agent loop filters unsupported effort before provider requests; `/effort` warns from the same metadata | Effort picker still shows all levels instead of disabling unsupported choices | Bad mapping can hide valid settings or send invalid ones | Model picker tests; provider request payload tests |
| P1 | Pi | Extension-controlled working row and message replacement | Extensions can present cleaner progress/cost UI | Nuka output styles can render tool results; statusline is internal | No extension event for finalized assistant message replacement | Can obscure real model output or cost if untrusted | Extension API tests; TUI frame tests |
| P2 | Pi | Provider catalog additions and friendly `/login` display | Easier provider onboarding, clearer identity | Custom provider name/id fixes are done; Xiaomi custom works via custom provider | Built-in Cloudflare/Moonshot/Mistral/Xiaomi provider presets not complete | Provider churn and credentials docs burden | Onboarding wizard tests; provider probe tests |
| P2 | Codex | MCP OAuth/login/status and resource read APIs | Better MCP reliability and introspection | Nuka has MCP resource tools via platform capabilities, not product UI | No server status dashboard or OAuth flow | Requires cross-process auth state | MCP config tests; settings UI harness |
| P2 | Claude Code | Scheduled tasks and external channels | Automate repeated prompts/events | Nuka has cron/scheduler primitives | No user-facing scheduled task workflow | Background work could surprise users | Cron scheduler tests; task list harness |
| P2 | Codex / Pi | Self-update detection and package update UX | Keeps CLI current | Nuka update checks exist in parts | No coherent update command/panel | Update prompts can be noisy | Update loader tests; notification snapshot |

## Accepted Iteration Order

1. Finish subagent parity before broad UI additions:
   - `send_input` for running local agents
   - explicit `fork_context` API shape
   - transcript/worktree persistence for true `resume_agent`
   - agent display/color metadata and task summaries
2. Finish compact efficiency:
   - compare Nuka-Code API-round grouping
   - add streamed compact subphase progress only if compact latency remains confusing
   - investigate provider context-management controls once request schemas can model them cleanly
3. Improve provider/model ergonomics:
   - disable unsupported effort choices in the picker using provider/model capability metadata
   - cached transport investigation for OpenAI-compatible providers
   - provider preset backlog from Pi only after custom provider path stays stable
4. Then expand extension surfaces:
   - hook list/trust UI
   - plugin/skill marketplace summaries
   - extension-controlled working row/message replacement

## Rejected Or Deferred

| Feature | Decision | Reason |
| --- | --- | --- |
| Decorative landing/marketing UI from upstream docs | Reject | Does not improve repeated coding work or TUI comprehension |
| Broad provider catalog port in one batch | Defer | Provider churn is high; Nuka first needs stronger custom-provider and model metadata |
| Copying Claude Code docs text/assets | Reject | Use behavior as reference only |
| Websocket-cached transport before transcript invariants | Defer | Cached transport is risky until Nuka has strict provider-visible history tests |

## Verification For This Intake

- Sources were inspected on 2026-05-23 with current local filesystem state plus official web pages.
- Codex source commit and license were recorded from the local checkout.
- Pi release items were taken from `pi.dev/news/releases` entries with links to npm/GitHub releases.
- Claude Code features were taken from official docs page metadata/navigation and fetched HTML for subagents/hooks.
