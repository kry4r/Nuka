# TUI diff detail and checkbox rendering

## Goal

Render GFM task checkboxes quietly and let Ctrl+O expanded read/diff results use a bounded scrollable detail window.

## Requirements

- Render GitHub Flavored Markdown task-list items in transcript Markdown as
  quiet checkbox rows (`[ ]` / `[x]`) instead of noisy bullet syntax.
- Keep ordinary Markdown text unchanged until the broader Markdown renderer is
  implemented.
- When `Ctrl+O` expands the latest successful read-like tool result, bound long
  read/diff output to a viewport-sized line window instead of letting it consume
  the whole transcript.
- Let PageDown, PageUp, Home, and End scroll the expanded detail window while a
  read/diff detail is open, without leaking escape sequences into the prompt.
- Keep the existing `Ctrl+O` affordance and avoid adding a new modal or dialog
  for this slice.

## Acceptance Criteria

- [x] `Markdown` renders checked and unchecked GFM task items without preserving
  the leading list bullet.
- [x] Expanded long `git_diff` / read-like results show a line range header and
  only the configured visible line window.
- [x] `Ctrl+O` opens/closes the latest read-like result and PageDown scrolls
  the detail window while leaving the prompt clean.
- [x] Focused TUI tests for Markdown, Messages, and App pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
- Verification on 2026-05-27:
  - `npm test -- test/tui/Markdown.test.tsx test/tui/Messages.static.test.tsx test/tui/app.test.tsx`
    passed with 3 files / 26 tests.
  - `npm run typecheck` exited 0.
  - `npm run lint` exited 0 with the existing 55 warning baseline.
  - `npm run build` exited 0 and reported `dist/cli.js` at 576.1 KiB.
  - `git diff --check` exited 0.
