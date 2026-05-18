# ink-ui-explorer — Bringup & First Regression Fixtures

**Status:** Active
**Date:** 2026-05-18
**Parent spec:** `docs/superpowers/specs/2026-05-02-ink-ui-explorer-design.md` (Design locked, 2026-05-02)
**Baseline:** `main` HEAD after `6107a64` and `0743b22`; Phase 9 harness shipped in `src/core/testing/` + `src/tui/testing/harness.ts`; 7 sample plans in `test-plans/`.

> This document is an **implementation increment**, not a redesign. The architecture, verb surface, and acceptance criteria for `ink-ui-explorer` are fixed by the 2026-05-02 spec. This document records:
>
> 1. The two current-version bugs that motivate the bringup and seed the regression fixture set.
> 2. The phasing under which the locked design is shipped.
> 3. The viewport matrix used by `sweep` and the regression fixtures.
> 4. The quality gate (two-reviewer Opus pass) applied at every phase boundary.

---

## 1. Context

User report 2026-05-18: two UI rendering bugs on Nuka `main` survive the layout fixes shipped in `6107a64` and `0743b22`.

- **Bug A — `hello` triggers `TodoWrite`.** The user types only `hello`. The model emits a `tool_use:TodoWrite` with a single trivial item (`"Welcome user and offer assistance"`), and the bottom Tasks/Plan panel appears.
- **Bug B — `ModelPicker` exit corrupts the main view.** After the user completes model setup in `ModelPicker` and the submenu closes, the top Welcome LOGO is squashed AND the conversation area is blank.

User selected scope **S3**: ship the full `ink-ui-explorer` skill described in the locked design, using these two bugs as the first regression fixtures and the first end-to-end exercise of `capture` / `sweep` / `judge` / `repair`.

---

## 2. Current-version root causes

### 2.1 Bug A — `hello` → `TodoWrite`

Not a UI rendering bug. The model genuinely returns `tool_use:TodoWrite` because nothing in the prompt surface tells it not to.

| File | Line | Observation |
|---|---|---|
| `src/core/tools/todoWrite.ts` | 17 | Tool `description` is one sentence: `"Replace the session todo list. Input is the complete new list of { title, status } items."` No "When NOT to use" guidance. |
| `src/core/agent/systemPrompt.ts` | — | No `TodoWrite` usage section. |
| `Nuka-Code/src/tools/TodoWriteTool/prompt.ts` | 1–30 | Reference: explicit negative rules — *single trivial task / conversational / informational → skip*. |

The fix surface is small: extend `todoWrite.ts` description AND inject a `TodoWrite` usage section into `systemPrompt.ts`.

### 2.2 Bug B — `ModelPicker` exit: LOGO squashed + conversation blank

Two independent root causes share the same trigger (the submenu close path).

**B1 — LOGO compacted on remount race**

| File | Line | Observation |
|---|---|---|
| `src/tui/App.tsx` | 1067 | `ModelPicker.onSave` calls `bumpMessages()` then `closeSubmenu()`. |
| `src/tui/App.tsx` | 433 | `closeSubmenu = dispatchUI({ type: 'reset' })` — drops the submenu subtree. |
| `src/tui/Welcome/Welcome.tsx` | 54–57 | Re-mounts and reads `useTerminalSize()`. |
| `src/tui/Welcome/layout.ts` | 17–20 | `getLayoutMode(cols)`: `< 80 → 'compact'`. |
| `src/tui/hooks/useTerminalSize.ts` | 6, 11 | Single resize listener; OK in steady state but the remount frame reads the latest snapshot, which can be a stale value if a SIGWINCH fired during the modal's lifetime. |

Result: at viewport widths near the 80-col cutoff, the post-close render frame can pick the wrong branch.

**B2 — Conversation area blank**

| File | Line | Observation |
|---|---|---|
| `src/tui/Messages/Messages.tsx` | 168 | `prologueGoesStatic = !!props.prologue && (total > 0 \|\| streaming !== null)`. Once *any* prior message exists (e.g. an `/effort` error, a `/settings` echo), the Welcome prologue is pushed into Ink's Static channel. |
| `src/tui/Messages/Messages.tsx` | 204–205 | Welcome only renders in the live area when `!prologueGoesStatic`. |
| `src/tui/App.tsx` | 1067 | `bumpMessages()` re-renders Messages; if `streaming` flaps `null → !null → null` during the close frame, the prologue ends up in Static for that frame and never returns to live, leaving the live area empty until the next user input. |

The 2026-05-02 spec calls this the "Messages `<Static>` pushes content to scrollback" gap that the existing harness cannot see; `capture` plus Static-commit interception is the foundation for catching it.

---

## 3. Goals (bringup)

| ID | Goal | Acceptance |
|---|---|---|
| **G1** | Implement `ink-ui-explorer` per locked design — verbs `capture`, `sweep`, `fuzz`, `judge`, `repair`. | All 5 verbs invokable via CLI subcommand `nuka explore <verb> ...`. |
| **G2** | Two regression fixtures (Bug A, Bug B). | `test/ui-auto/fixtures/regression-bug-a.tsx` and `regression-bug-b.tsx` exist; both fail at HEAD, pass after the fix lands. |
| **G3** | Use `repair` to fix Bug A. | `repair` subagent produces a patch to `todoWrite.ts` + `systemPrompt.ts`; verify loop confirms green; commit lands. |
| **G4** | Use `sweep` to catch Bug B across viewports. | Sweep run produces a failure record with grid frames at `cols ∈ {60, 70, 79, 100, 120}` showing one of the two symptoms; subsequent minimal fix renders all viewports clean. |
| **G5** | Two-reviewer gate at every phase. | Each phase concludes with two Opus reviewer subagents in parallel; merge only when both ack. |
| **G6** | Skill packaged. | `~/.claude/skills/ink-ui-explorer/SKILL.md` + helper scripts; skill description matches locked spec §1. |

---

## 4. Non-goals (bringup)

- Modify the locked 2026-05-02 design. Only implementation; no architectural changes.
- Structural migration of Welcome/ModelPicker into a `FullscreenLayout` / `ModalStack` (outside scope; B1/B2 are addressed only with minimal patches).
- Real PTY (`node-pty`), mouse, or cursor-position testing.
- Visual image diff (the explorer is text-grid only).
- Re-architecting `useTerminalSize` (e.g. introducing a Context) beyond what is required to make the fixtures stable.

---

## 5. Phasing

Each phase = one implementer subagent → two parallel reviewer subagents → commit. Models:

- **Implementer:** `sonnet` for verbs without heavy LLM dispatch (`capture`, `sweep`, packaging), `opus` for the verbs that themselves spawn LLM calls or coordinate subagents (`fuzz`, `judge`, `repair`, dogfood).
- **Reviewer:** always `opus`, always two in parallel.

| # | Phase | Impl model | Deliverable | Blocks |
|---|---|---|---|---|
| **P4** | `capture` verb + Bug A/B fixtures (failing) | sonnet | `src/core/testing/explorer/capture.ts`; `test/ui-auto/fixtures/regression-bug-a.tsx`, `regression-bug-b.tsx`; both currently failing under `vitest`. | P5 |
| **P5** | `sweep` verb (viewport × state matrix) | sonnet | `src/core/testing/explorer/sweep.ts`; CLI plumbing; reports failure records to `.ink-explorer/failures/`. | P6, P7 |
| **P6** | `fuzz` verb (randomized keystrokes + property assertions) | opus | `src/core/testing/explorer/fuzz.ts`; deterministic seed → reproducible run. | P9 |
| **P7** | `judge` verb (Haiku quick → Opus precise + grid-hash dedup) | opus | `src/core/testing/explorer/judge.ts`; cache at `.ink-explorer/judge-cache/`. | P8 |
| **P8** | `repair` verb (spawn repair subagent + verify loop + auto-promote failure to fixture) | opus | `src/core/testing/explorer/repair.ts`. | P9 |
| **P9** | Dogfood: `repair` fixes Bug A; `sweep` catches Bug B; minimal patches land; fixtures go green. | opus | Two commits: one for Bug A (prompt/description), one for Bug B (Welcome remount + `prologueGoesStatic` guard). | P10 |
| **P10** | Skill packaging | sonnet | `~/.claude/skills/ink-ui-explorer/SKILL.md`; helper CLIs; doc cross-reference. | — |

---

## 6. Viewport matrix

The `sweep` verb runs every fixture across these profiles by default:

| Profile | cols | rows | Why |
|---|---|---|---|
| narrow-compact | 60 | 30 | Welcome compact branch (`< 80`). Bug B1 most likely. |
| narrow-edge | 70 | 30 | Compact-branch slack. |
| pre-normal | 79 | 24 | Just below the normal cutoff; race-sensitive. |
| normal | 100 | 30 | Welcome normal layout. Bug B2 visible here. |
| normal-tall | 100 | 50 | Hero-height cap (`HERO_MAX_HEIGHT`) interaction. |
| wide | 120 | 30 | Welcome wide layout. Bug A reproducible here. |
| wide-tall | 140 | 60 | Max visible scrollback. |

Adding profiles is a one-line change in `sweep.ts`; new fixtures get the full sweep automatically.

---

## 7. Quality gate per phase

After each phase commit, the implementer hands off; the gate runs:

1. `npm run typecheck` clean.
2. `npm test` ≥ baseline test count; no regressions; only additions.
3. `npm run build`; `dist/cli.js` ≤ 720 KB.
4. Two Opus reviewer subagents dispatched **in parallel**. Each receives:
   - The phase diff.
   - This bringup doc.
   - The 2026-05-02 locked design.
   - Explicit ask: approve / changes-requested with file:line citations.
5. Both approve → next phase begins.
   Any changes-requested → targeted patch → re-review (no new phase opened).
6. Commits follow `<type>(<scope>): <message>` convention. No `Co-Authored-By`. `--author="kry4r <Nidhogxt@outlook.com>"`.

---

## 8. Risks & rollback

| Risk | Mitigation |
|---|---|
| `judge` LLM cost runaway | Grid-hash dedup; Haiku-only fallback when budget hit; `--judge=haiku-only` opt-in. |
| `repair` subagent loops | Hard timeout (5 min) per attempt; max 3 attempts; failures written to `.ink-explorer/failures/` for human follow-up. |
| Bundle size pushed over 720 KB | Explorer code lives behind dynamic import in `cli.tsx`; only loaded when `nuka explore` is invoked. |
| Bug B fix breaks unrelated viewports | Sweep before commit; all 7 profiles must remain clean. |
| CI flakiness from Static commits | `capture` uses Ink's `Output` channel directly and a deterministic clock; no wall-clock waits. |

Rollback: each verb is a standalone module under `src/core/testing/explorer/`; reverting the phase commit removes the verb without touching the existing Phase 9 harness.

---

## 9. References

- `docs/superpowers/specs/2026-05-02-ink-ui-explorer-design.md` — Locked architecture, verb surface, acceptance.
- `docs/superpowers/specs/2026-04-25-phase9-tui-auto-test-harness-design.md` — Existing harness that `ink-ui-explorer` builds on.
- Commits `6107a64`, `0743b22` — Prior UI bug fix batches; baseline for the current-version root causes in §2.
