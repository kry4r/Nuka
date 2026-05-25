# Upstream Feature Intake

Date: 2026-05-23

Refresh: 2026-05-25 (Asia/Shanghai)

Purpose: turn current Claude Code, Codex, and Pi feature research into a Nuka
iteration queue. This is an intake list, not an implementation spec; each
accepted feature still needs its own small design, tests, and UI capture when
it touches Ink.

## Sources

| Source | Evidence | Version / date | License / constraint |
| --- | --- | --- | --- |
| Codex | Local repo `/tmp/openai-codex`; remote `https://github.com/openai/codex.git`; official changelog `https://developers.openai.com/codex/changelog`; May 21 ChatGPT/OpenAI release notes for Codex app updates | local commit `7d47056ea42636271ac020b86347fbbef49490aa`; latest official observed entries still Codex app `26.519` and CLI `0.133.0`, 2026-05-21 | Apache-2.0 in `/tmp/openai-codex/LICENSE`; official docs/changelog are product references, implementation ideas can be ported from the open-source repo with attribution awareness |
| Claude Code | Official changelog `https://code.claude.com/docs/en/changelog`; docs fetched from `https://code.claude.com/docs/en/sub-agents` and `https://code.claude.com/docs/en/hooks`; sidebar/docs pages observed for agent view, teams, worktrees, MCP, plugins, skills, scheduled tasks, goals, checkpointing | latest observed `2.1.150` dated 2026-05-23; latest user-facing feature/fix release remains `2.1.149` dated 2026-05-22 | Docs are proprietary product documentation; use as behavioral reference, do not copy text or assets |
| Pi | Official `https://pi.dev/news/releases` changelog; current release page links to GitHub/npm; latest release page `https://pi.dev/news/releases/0.75.5` | latest observed release page entry: 0.75.5 dated 2026-05-23 | Pi release page/footer identifies MIT license, but repository-level confirmation is still required before code porting; use changelog as product-behavior reference only |
| Nuka-Code | Local repo `/data/xtzhang/Nuka-Code`; remote `http://47.93.142.235:3000/Teng/Nuka-Code.git` | commit `b873d92069a30be6187d3a4e57be871b6ae602f5`, 2026-04-23 | Internal reference; direct behavioral target for subagent system |

## Feature Checklist

| Priority | Source | Feature | User value | Nuka equivalent | Gap | Risk | Test surface |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | Codex app-server | `thread/fork`, `thread/resume`, `thread/read`, paged `thread/turns/list` | Users can branch, inspect, and recover work without losing state | `resume_agent` and task sidecars now cover agent metadata/output only | No full transcript persistence/fork semantics for Nuka sessions or subagents | Incorrect fork could mix tool results, cwd, or permissions | Session store tests; provider-visible transcript tests; agent lifecycle tests |
| P0 | Nuka-Code / Claude Code | First-class subagent fork/send lifecycle | Parallel work becomes addressable, resumable, and steerable | `spawn_agent`, `wait_agent`, `close_agent`, `resume_agent`, `send_agent`, `send_input`, and lightweight `fork_context` exist | Missing true transcript/worktree reconstruction and cache-identical fork prefix semantics | Recursive delegation and write-scope collisions | Agent lifecycle tool tests; task sidecar tests; worktree inheritance tests |
| P0 | Codex compact | Remote Responses compact plus retained-message budget and compaction-item passthrough | Long sessions survive without bloating context | Native `/responses/compact`, opaque item passthrough, retry/shrink, and `compact.retainedMessageBudget` are implemented | Missing deeper provider context-management controls | Over-pruning can drop needed tool context | `autoCompact` boundary tests; provider OpenAI tests; simulated context-window error tests |
| P0 | Codex app-server | `thread/compact/start` with streamed progress notifications | Manual compact feels visible and non-blocking | `/compact` now exposes running/done/failed state in the TUI | No streamed subphase progress or task-level compaction event | UI can become misleading if compact runs as hidden turn | Compact command tests; TUI status/task frame tests |
| P0 | Claude Code / Codex | Persistent goal mode with progress, pause/resume, budget/status accounting | Long-running objectives become explicit, inspectable, and restartable | Thread goal context exists externally in the current environment, not as a Nuka product primitive | No Nuka-native goal store, CLI command, or compact status surface | Bad UX if goal state becomes another verbose status block | Goal store tests; statusline truncation harness; compact/resume integration tests |
| P1 | Claude Code | Agent view and agent teams | Users can see parallel work and coordinate specialists | TUI task panels classify subagents | No agent-focused view, colors, summaries, or team grouping | Adding another noisy panel can worsen current UX | Ink harness captures; `Tasks/columnReducer` tests |
| P1 | Claude Code / Codex | Worktree-isolated sessions and forks | Safer concurrent edits, less accidental overwrite | `EnterWorktree` exists and dispatch inherits active worktree | `spawn_agent` cannot create/own isolated worktrees | Cleanup and dirty-worktree policy errors can lose work | Worktree store tests; spawn-agent isolation tests |
| P1 | Claude Code | `/usage` cost breakdown by skills, subagents, plugins, and MCP server | Users can understand which automation is burning context or limits | Nuka has usage totals and statusline cost/count snippets | No attribution by feature/source, so cost debugging is guesswork | Attribution can be wrong if provider usage is incomplete | Usage reducer tests; provider accounting tests; narrow statusline harness |
| P1 | Claude Code / Nuka TUI | Scrollable diff detail and GFM task checkbox rendering | Review and task progress are easier to inspect in-terminal | Nuka renders messages/tools and can show diffs as output | No dedicated scrollable diff/detail view; markdown task lists are not a first-class progress surface | More UI state can reintroduce scroll/input focus bugs | Markdown render tests; diff-detail navigation harness; scrollback App tests |
| P1 | Claude Code / Codex | Hook discovery, trust state, and managed-hook lockdown | Automation becomes reliable without silently running unsafe hooks | Nuka has hook registry and lifecycle events | No UI/listing/trust management; partial task hook metadata only | Security and confusing hook failures | Hook config loader tests; lifecycle task tests |
| P1 | Codex / Claude Code | Plugin/skill marketplace and per-plugin MCP/app summaries | Makes extension ecosystem discoverable | Nuka has plugin loading and skills | No marketplace UX, auth policy metadata, or installed summary view | Scope creep, auth complexity | Plugin loader tests; settings submenu harness |
| P1 | Codex CLI | Permission profile list/inheritance, managed requirements, and runtime refresh | Permission posture becomes auditable and centrally managed | Nuka has local permission checks and plan-mode restrictions | No named profile catalog, inheritance, or managed policy refresh | Over-broad profiles can silently weaken sandboxing | Permission checker tests; config hot-reload tests; settings UI harness |
| P1 | Codex / Claude Code / Pi | Subagent lifecycle events and parallel-output diagnostics | Parent agents and extensions get useful per-agent progress/failure details | Nuka has background local-agent tasks and lifecycle aliases | No extension-visible `SubagentStart`/stop-style events or structured failed-subtask summaries | Noisy events can pollute transcript or hide real failures | Agent lifecycle hook tests; task sidecar tests; TUI task digest harness |
| P1 | Pi | WebSocket-cached Codex/OpenAI transport | Avoids resending full history on supported providers | Nuka currently streams per request | No cached transport abstraction | Provider-specific complexity and stale context bugs | Provider resolver tests; fake websocket transport tests |
| P1 | Pi | Model thinking-level metadata (`thinkingLevelMap`) | UI only exposes valid reasoning/thinking levels per model | Provider config now supports per-model `effort` capability metadata; agent loop filters unsupported effort before provider requests; `/effort` warns from the same metadata; EffortPicker marks unsupported levels unavailable and skips them in keyboard navigation | Need broader provider preset metadata so built-ins ship useful defaults | Bad mapping can hide valid settings or send invalid ones | Model picker tests; provider request payload tests |
| P1 | Pi | Extension-controlled working row and message replacement | Extensions can present cleaner progress/cost UI | Nuka output styles can render tool results; statusline is internal | No extension event for finalized assistant message replacement | Can obscure real model output or cost if untrusted | Extension API tests; TUI frame tests |
| P1 | Pi | Provider retry/idle-timeout controls and lifecycle-settled retry/compaction events | Long provider streams and compaction retries fail less mysteriously | Nuka has provider request paths, compact retry/shrink, and streaming events | No user-facing provider idle-timeout control or `willRetry`-style lifecycle event | Retrying unsafe tool-adjacent turns can duplicate side effects if scoped poorly | Provider config tests; fake stream timeout tests; compact retry tests |
| P1 | Pi | Cleaner collapsed read tool output | File reads stay scannable in long transcripts while details remain expandable | Nuka renders tool calls and can scroll transcript output | No read-specific collapsed summary that shows only the read line with expandable content | Hiding too much can obscure tool evidence or make review harder | App/TUI read-tool transcript harness; scrollback capture |
| P1 | Pi | Custom Anthropic-compatible adaptive thinking flag | Custom Anthropic-compatible providers can opt into Claude adaptive-thinking behavior | Nuka has provider capability metadata and effort filtering | No explicit custom-provider compat flag for adaptive thinking behavior | Incorrect flag handling can send unsupported reasoning fields | Fake custom-provider request scenario; provider config validation |
| P1 | Pi | Unified patch details for edit tool results | SDK/extension consumers receive structured edit diffs instead of scraping text | Nuka has tool result rendering and diff-related output | Tool result metadata does not expose a standard patch detail contract | Patch metadata can drift from actual file changes | Edit-tool functional scenario with result metadata assertions |
| P1 | Pi | Bash output truncation line-count fixes | Tool cards do not overcount trailing newlines or show duplicate truncation paths | Nuka renders command/tool output in message cards | Need feature-level coverage for trailing-newline truncation behavior in command output | Output compaction can hide real terminal evidence | App/TUI bash-output truncation harness |
| P2 | Pi | Theme picker displays theme content names | Users see the theme name they configured, not an incidental file stem | Nuka has settings/theme surfaces | Theme picker labeling needs a functional UX pass after statusline cleanup | Display-name changes can break selection identity | Settings/theme picker functional harness |
| P2 | Pi | Package update ref reconciliation and settings preservation | Package updates keep pinned refs and existing package settings intact | Nuka has partial update checks and plugin/package loading | No coherent update command/panel or package-update settings preservation checks | Update automation can silently change extension state | Package update smoke scenario; notification snapshot |
| P2 | Pi | Provider catalog additions and friendly `/login` display | Easier provider onboarding, clearer identity | Custom provider name/id fixes are done; Xiaomi custom works via custom provider | Built-in Cloudflare/Moonshot/Mistral/Xiaomi provider presets not complete | Provider churn and credentials docs burden | Onboarding wizard tests; provider probe tests |
| P2 | Codex | MCP OAuth/login/status and resource read APIs | Better MCP reliability and introspection | Nuka has MCP resource tools via platform capabilities, not product UI | No server status dashboard or OAuth flow | Requires cross-process auth state | MCP config tests; settings UI harness |
| P2 | Codex app | Appshots and advanced browser annotations | Visual/frontend feedback can be captured precisely without long prompts | Nuka has terminal UI harness and file/image prompt references | No desktop app, browser surface, or annotation attachment model | Large scope; not useful until terminal workflow is cleaner | Defer to GUI/browser track; attachment schema tests before UI work |
| P2 | Pi | Supply-chain hardened self-update and interactive update notes | Updates become safer and less opaque | Nuka update checks exist in parts | No shrinkwrap/release install hardening or post-update changelog note | Update prompts can be noisy; package-manager differences | Package smoke tests; update command tests; notification snapshot |
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
   - cached transport investigation for OpenAI-compatible providers
   - provider preset backlog from Pi only after custom provider path stays stable
4. Add goal and observability surfaces before broad desktop-style features:
   - Nuka-native goal store with pause/resume/edit/clear
   - cost/context attribution by skills, subagents, plugins, and MCP servers
   - provider retry/timeout status that does not bloat the statusline
5. Tighten review and TUI inspection loops:
   - scrollable diff/detail view
   - GFM task checkbox rendering
   - Fish-shell prompt paste/newline regression coverage
   - effective effort display from skill/agent overrides, not only configured baseline
6. Then expand extension surfaces:
   - hook list/trust UI
   - plugin/skill marketplace summaries
   - extension-controlled working row/message replacement
   - subagent lifecycle events and failed-subtask summaries

## Rejected Or Deferred

| Feature | Decision | Reason |
| --- | --- | --- |
| Decorative landing/marketing UI from upstream docs | Reject | Does not improve repeated coding work or TUI comprehension |
| Broad provider catalog port in one batch | Defer | Provider churn is high; Nuka first needs stronger custom-provider and model metadata |
| Copying Claude Code docs text/assets | Reject | Use behavior as reference only |
| Websocket-cached transport before transcript invariants | Defer | Cached transport is risky until Nuka has strict provider-visible history tests |
| Appshots, browser annotations, or remote locked computer use in the TUI track | Defer | These are app/desktop surfaces; first finish Nuka's terminal workflow, attachment schema, and security model |

## Verification For This Intake

- Sources were inspected on 2026-05-23 with current local filesystem state plus official web pages.
- Codex source commit and license were recorded from the local checkout.
- Pi release items were taken from `pi.dev/news/releases` entries with links to npm/GitHub releases.
- Claude Code features were taken from official docs page metadata/navigation and fetched HTML for subagents/hooks.
- Refresh on 2026-05-24 inspected official Claude Code changelog, official OpenAI Codex changelog/release notes, and Pi `0.75.4` release notes.
- Refresh on 2026-05-25 inspected official Claude Code changelog, official OpenAI Codex changelog/release notes, and Pi `0.75.5` release notes.
- OpenAI developer pages were reachable through indexed browsing; direct `curl` received a 403 from the OpenAI edge, so the official web view and local Codex checkout remain the recorded evidence.
