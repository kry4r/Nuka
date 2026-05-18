# Bug A repair — run record (simulated)

**Date:** 2026-05-18
**Verb:** `nuka explore repair`
**Failure id:** `bug-a-001`
**Status:** patches-correct-by-inspection; real-run pending API budget

> This is a **simulated run**, not a real Opus subagent invocation. The
> patches below are hand-authored to match what an Opus repair subagent
> would produce given the seeded failure dump. The autonomous M6
> execution lacked an authorized Anthropic API budget; the simulation
> exists to exercise the dogfood plumbing end-to-end (dump → patches →
> promote → regression fixture) without billed tokens.

## Failure dump (seeded)

Path: `test/fixtures/explorer-dumps/regression-bug-a.md`
Component: `BugA-TodoWritePromptSurface`
Case: `tool-description-has-when-not-to-use`
Viewport: 120x30
Root cause (bringup §2.1): `src/core/tools/todoWrite.ts:17` description had
no "When NOT to use" guidance, and `src/core/agent/systemPrompt.ts`
contained no `TodoWrite` usage section.

## Simulated subagent transcript

**Turn 1 — read.** Subagent reads `src/core/tools/todoWrite.ts` and
`src/core/agent/systemPrompt.ts`. Confirms the description on line 17 is
a single sentence; confirms the system prompt has no TodoWrite block.

**Turn 2 — edit.** Subagent extends `todoWrite.ts:17` with a "When NOT
to use" paragraph (greetings, single-step tasks, informational replies)
and injects a "TodoWrite usage:" section into `systemPrompt.ts` after
the existing "Tool usage:" block.

**Turn 3 — verify.** Subagent calls `verify` on
`test/ui-auto/fixtures/regression-bug-a.fixtures.tsx`, case
`tool-description-has-when-not-to-use` at viewport 120x30. The fixture
asserts `tool.description.includes('When NOT to use')` and
`prompt.includes('TodoWrite')` — both pass. Status: `verified`.

## Final edits

- `src/core/tools/todoWrite.ts`: description extended (~7 lines).
- `src/core/agent/systemPrompt.ts`: 9-line "TodoWrite usage:" block
  appended after the existing "Tool usage:" bullets.

Both diffs are minimal and land as separate commits per plan §569:
- `feat(tools/todo): add 'when not to use' guidance`
- `feat(agent/systemprompt): add todowrite usage block`

## Promoted regression fixture

`test/ui-auto/fixtures/BugA-TodoWritePromptSurface/regression-bug-a-001.fixtures.tsx`
re-mounts the original case at the failing viewport (120x30). The file
matches the `promote.ts` output shape verbatim so a future real-Opus
re-run would overwrite it idempotently.

## Note on real-run reproduction

To reproduce with a real Opus subagent, set `ANTHROPIC_API_KEY` and run

```
node dist/cli.js explore repair test/fixtures/explorer-dumps/regression-bug-a.md
```

Expect approximately $2 of Opus tokens for a 3-turn read/edit/verify
loop (verify spins one worker_threads round-trip per turn; budget is
default `maxTurns=20` / `timeoutMs=300000`). The post-repair tree
should be byte-identical to the simulated landing.
