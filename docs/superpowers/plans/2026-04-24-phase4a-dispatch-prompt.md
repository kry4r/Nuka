# Phase 4a Parallel Dispatch Prompt

This is the **ready-to-paste-in-a-new-session prompt** for executing Phase 4a across three parallel subagent streams via git worktrees.

---

## How to use

1. Open a fresh Claude Code session in `/data/xtzhang/Nuka`.
2. Paste the entire fenced block below as your first message.
3. Let the controlling agent dispatch three subagents in parallel (one per worktree), then monitor and merge.

Expected runtime: ~60–90 minutes of wall-clock work with three parallel agents.

---

## The prompt

````
You are the controller for Phase 4a of the Nuka project at /data/xtzhang/Nuka.

## Required reading before dispatching

1. `docs/superpowers/reviews/2026-04-24-phase3-vs-nuka-code.md` — the 68-item gap review.
2. `docs/superpowers/specs/2026-04-24-phase4-hardening-design.md` — what Phase 4 is and isn't.
3. `docs/superpowers/plans/2026-04-24-phase4-hardening-plan.md` — the bite-sized §M1 / §M2 / §M3 task bodies.
4. `docs/superpowers/plans/2026-04-24-full-divergence-schedule.md` — all 68 items scheduled by phase.

## Your job

Execute the 21 Phase-4a tasks across **three parallel mega-workstreams** (M1 MCP, M2 tool semantics, M3 plugin subsystem) using **three isolated git worktrees** so the subagents don't step on each other.

Baseline: HEAD is `bb830f1` on `main`; 272 tests passing; dist/cli.js 120 KB.

## Skills to invoke

- **`superpowers:using-git-worktrees`** — before dispatching subagents, create three worktrees: `../nuka-wt-m1`, `../nuka-wt-m2`, `../nuka-wt-m3`, each off a fresh branch from `main` (`phase4a-m1`, `phase4a-m2`, `phase4a-m3`).
- **`superpowers:dispatching-parallel-agents`** — dispatch all three implementation subagents concurrently in a single message (one Agent tool call per stream).
- **`superpowers:subagent-driven-development`** — each subagent executes its mega-workstream's tasks sequentially (M1.1 → M1.8, M2.1 → M2.6, M3.1 → M3.3) per the skill's implementer → spec-review → quality-review pattern.
- **`superpowers:verification-before-completion`** — each subagent must run `npm run typecheck` + `npm test` green before reporting done.

## Model selection

- Controller (you): Opus.
- M1 subagent: Opus — protocol work touches many files, elicitation is architecturally novel.
- M2 subagent: Sonnet — type widening is cross-cutting but well-specified.
- M3 subagent: Sonnet — plugin subsystem adds, mostly isolated.

Within each subagent's dispatch of helpers: use Sonnet for implementation, Haiku for read-only browsing.

## MCP tool usage per stream

Each worktree subagent has access to MCP tools and should use them explicitly when appropriate:

### Context7 (`mcp__context7__query-docs`, `mcp__context7__resolve-library-id`)
- **M1 subagent** should query context7 for:
  - `@modelcontextprotocol/sdk` — schema names (`ListRootsRequestSchema`, `ElicitRequestSchema`, `ElicitResult`), transport constructors (`SSEClientTransport`), event hooks (`onclose`, `setRequestHandler`). Your mock bridge is already in `src/core/mcp/sdkBridge.ts` — extend it as needed.
  - zod v4 discriminated-union + record interaction (for new config schema fields).
- **M2 subagent** should query:
  - zod v4 `parse` vs `safeParse` patterns for the input validator.
  - JSON Schema → Zod conversion patterns (`json-schema-to-zod` ideas, but we ship our own adapter — do NOT install a new dep).
- **M3 subagent** should query:
  - `execa` stream capture for hook runner (stdin piping, stdout JSON parse).
  - Node `fs.cp` atomicity + `fs.rename` semantics for marketplace cache.

Always resolve library IDs first with `resolve-library-id` before calling `query-docs`.

### Sequential Thinking (`mcp__sequential_thinking__sequentialthinking`)
Use when a decision has ≥3 viable approaches and you need to reason through tradeoffs before committing:
- **M2 subagent** should use it before starting M2.2 (tool result type widening) — the `string | ContentBlock[]` change is cross-cutting through providers, message factories, and the agent loop. Spend a thinking step enumerating the breakage surface.
- **M1 subagent** should use it before starting M1.12 (elicitation) — deciding the permission-bridge extension shape (reuse `ElicitationDialog` vs refactor permission dialog to be polymorphic) is worth a structured trace.
- **M3 subagent** should use it before starting M3.2 (hooks) — the event-set choice (just 4 events? should we include `beforeTurn`?) deserves explicit tradeoff analysis.

### Web search (`mcp__web-search__search`, `mcp__web-search__fetchWebContent`) and Fetch (`mcp__fetch__fetch`)
- **M1 subagent**: fetch the MCP specification pages to confirm elicitation request/response shapes and the roots capability declaration format. Source of truth: `spec.modelcontextprotocol.io`.
- **M3 subagent**: look up existing plugin-hook designs (Claude Code, VS Code, tmux-plugin-manager) if stuck on edge cases — do NOT copy code; only use for inspiration.

### Memory (`mcp__memory__create_entities` and relations)
Optional but useful for this multi-worktree run:
- Record decisions that affect other worktrees (e.g., "M2 decided to represent `ContentBlock` as a discriminated union with exactly 3 variants"). M1 and M3 can then query before wiring dependent code (e.g., M1 image persistence relies on the `ContentBlock` shape).
- Create a `Phase4a` entity at the start; add observations as each task completes.

### Filesystem / Git MCP
Prefer the native `Read` / `Edit` / `Write` / `Bash git ...` tools over the MCP wrappers unless cross-process isolation is required. Within a subagent's execution, the native path is more efficient.

## Dispatch sequence

### Step 1 — Worktrees

Use Bash to create the three worktrees. Do NOT dispatch subagents yet:

```bash
cd /data/xtzhang/Nuka
git fetch origin  # ensure main is current
git worktree add ../nuka-wt-m1 -b phase4a-m1 main
git worktree add ../nuka-wt-m2 -b phase4a-m2 main
git worktree add ../nuka-wt-m3 -b phase4a-m3 main
# Install deps in each (node_modules is not shared across worktrees for bundled tsx/vitest):
for d in ../nuka-wt-m1 ../nuka-wt-m2 ../nuka-wt-m3; do
  (cd "$d" && npm ci) &
done; wait
```

### Step 2 — Parallel dispatch

Send ONE message with three Agent tool calls. Each agent's prompt:
- States the worktree path and branch.
- Pastes the FULL text of its mega-workstream section from the plan doc (§M1 / §M2 / §M3).
- Reminds it to use subagent-driven-development for internal task sequencing.
- Lists the MCP tool usage guidance specific to its stream (above).
- Requires green `npm run typecheck` + `npm test` before each intra-stream commit.
- Reports back with: commit range, final test count, bundle size, and one-paragraph concerns.

### Step 3 — Merge sequence

After all three subagents report DONE:

```bash
# Rebase order per the plan: M2 first (foundation), then M1, then M3.
cd /data/xtzhang/Nuka

git switch main

git switch phase4a-m2
git rebase main
npm run typecheck && npm test                # must be green
git switch main && git merge --no-ff phase4a-m2 -m "phase4a: merge M2 tool semantics"

git switch phase4a-m1
git rebase main                              # likely trivial; only schema collision
npm run typecheck && npm test
git switch main && git merge --no-ff phase4a-m1 -m "phase4a: merge M1 MCP protocol"

git switch phase4a-m3
git rebase main                              # schema collision with M1 if both added keys
npm run typecheck && npm test
git switch main && git merge --no-ff phase4a-m3 -m "phase4a: merge M3 plugin subsystem"

# Cleanup
git worktree remove ../nuka-wt-m1
git worktree remove ../nuka-wt-m2
git worktree remove ../nuka-wt-m3
git branch -d phase4a-m1 phase4a-m2 phase4a-m3
```

If rebase conflicts appear in `src/core/config/schema.ts`, resolve by keeping all additive fields (M1 adds `mcp.connectTimeoutMs` / `requestTimeoutMs` / `maxResultChars`; M3 adds `plugins.enabled`). No semantic conflicts expected.

### Step 4 — Post-merge verification

```bash
npm run typecheck
npm test                 # expect 320+ passing
npm run build            # dist/cli.js ≤ 250 KB
```

Then append a "Gap Closure" appendix to `docs/superpowers/reviews/2026-04-24-phase3-vs-nuka-code.md` listing each 4a.M* task ID → commit SHA where it landed. Commit.

## Guard rails

- If a subagent reports BLOCKED, do NOT retry with more context if the issue is genuinely architectural — surface it to the user for triage instead. The plan is opinionated enough that BLOCKED usually means the plan needs revision.
- If two subagents both decide they need to extend `ContentBlock` in incompatible ways, pause them both and reconcile via sequential-thinking before resuming.
- Never skip hooks or bypass signing on merge commits.
- Never force-push to main.
- If test count drops below 272 at any point, halt that stream and investigate.

## Success criteria

Phase 4a is complete when:
1. All 21 tasks in `2026-04-24-full-divergence-schedule.md` marked Phase-4a have landing commits on `main`.
2. `npm test` is green with ≥ 320 passing tests.
3. `npm run typecheck` + `npm run build` clean; `dist/cli.js` ≤ 250 KB.
4. The review doc has a Gap Closure appendix with each task ID → commit SHA.
5. No open items in the plan marked "BLOCKED" or "DONE_WITH_CONCERNS".

Report back with:
- The three branch HEAD SHAs.
- Final merged SHA on main.
- Final test count + bundle size.
- Any `DONE_WITH_CONCERNS` notes elevated from subagents.
- Any gap-closure divergences vs the design (e.g., "took option B instead of A for elicitation; rationale X").

Start now. Begin with the required reading, then create the worktrees, then dispatch.
````

---

## Why this prompt design

- **Context loading up front** — the controller reads four docs before dispatching; each subagent only receives the slice it needs (its mega-workstream §) rather than the full corpus, keeping subagent context tight.
- **Three true parallel streams** — worktrees prevent file-level conflict; within each stream, subagent-driven-development enforces discipline (spec-review + quality-review per task).
- **Model tiering** — Opus only where protocol design judgment matters (M1) + controller; Sonnet for well-specified cross-cutting work (M2, M3); Haiku reserved for read-only subagents spawned by each stream.
- **Explicit MCP usage** — the prompt points each stream at the specific MCP tools that unblock its hard problems, rather than leaving "use MCP if useful" as a vague hint.
- **Sequential rebase order** — M2 (foundation) first because M1 annotations and M3 hook payloads both reference `ContentBlock`; then M1 + M3 merge in either order.
- **Guard rails** — explicit halting criteria (BLOCKED escalation, test count floor) prevent silent drift.

## If you want a faster / lower-friction variant

Strip the worktrees and run all three mega-streams sequentially in one session. Same plan doc, same tasks. Slower wall clock, simpler recovery on failure. The prompt structure is otherwise identical — just replace Step 1/2 with a single dispatch per stream in sequence.
