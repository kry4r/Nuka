---
name: ink-ui-explorer
description: |
  Explore and repair UI layout/render bugs in any Ink-based React TUI.
  Use when: the user reports a TUI looks wrong, when starting work on an Ink
  component, or after touching ink/yoga layout. Verbs: capture | sweep | fuzz
  | judge | repair.
---

# ink-ui-explorer — Autonomous UI-Error Explorer for Ink TUIs

Requires `nuka` on PATH (`npm link` in the Nuka repo, or `npm install -g nuka`).

## Verbs

- `ink-ui-explorer capture <fixture-path> [--viewport=80x24]`
  Mount a single fixture at one viewport, write the ASCII grid + grid JSON to
  `.ink-explorer/captures/`. Use to *see* what a component renders.

- `ink-ui-explorer sweep [--fixtures=<glob>] [--no-judge]`
  Run fixtures × default viewport matrix → L1 invariants → Judge (default on).
  Writes failure dumps and prints a summary table.

- `ink-ui-explorer fuzz [--target=app|<fixture-path>] [--seed=N] [--steps=200]`
  Random stdin + occasional viewport resize, shrunk to minimal repro on failure.

- `ink-ui-explorer judge [--re-judge]`
  Re-run only the Judge stage on the most recent sweep's grids; skip cache
  with --re-judge.

- `ink-ui-explorer repair <failure-id>`
  Spawn Opus subagent to read the dump, propose edits, verify, and promote a
  regression fixture.

## Decision rules

| Trigger | Verb |
|---|---|
| User asks "what does X look like?" | `capture` |
| User says "find UI bugs" / starts a TUI session | `sweep` |
| User says "test it harder" / sweep was clean but user is suspicious | `fuzz` |
| A failure dump exists (`.ink-explorer/failures/<id>.md`) | `repair <id>` |

## Runtime-Blind-Spot Checks

When a user reports an Ink UI bug after a clean sweep, verify these surfaces
explicitly before trusting screenshots:

- **Live transcript vs `<Static>` scrollback**: use production-mode
  `renderWithViewport`/`staticTap`, not `ink-testing-library` debug output.
  Debug mode concatenates static and dynamic output and can hide the real bug
  where previous chat turns leave the live viewport.
- **Native terminal cursor**: for focused inputs, require a positioned native
  cursor event, not only a rendered inverse-space glyph. Add
  `requiresNativeCursor: true` to relevant fixtures so the L1
  `nativeCursorDeclared` invariant checks Ink cursor ANSI telemetry.
- **Prompt/text fixtures**: when touching input components, run the default
  sweep and include at least one fixture with `requiresNativeCursor: true`.

## PATH requirement

The shim delegates to `nuka explore "$@"`. Ensure `nuka` is on PATH before
invoking `ink-ui-explorer`. In development: `npm link` inside the Nuka repo.
In CI: install globally (`npm install -g nuka`) or use `npx nuka`.

## Per-project setup

The runner writes transient state to `.ink-explorer/` at project root
(auto-gitignored on first run). Fixtures live under
`test/ui-auto/fixtures/**/*.fixtures.tsx` by default.
