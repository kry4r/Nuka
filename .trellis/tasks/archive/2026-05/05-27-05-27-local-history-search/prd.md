# Add local conversation history search

## Goal

Implement the accepted Codex CLI local conversation history search row so users
can recover prior persisted Nuka sessions by searching local conversation
content instead of browsing only newest-first previews.

## Requirements

- Preserve the existing persistence gate: `/history` still explains
  `NUKA_SESSION_PERSIST=1` when session persistence is disabled.
- Keep `/history` with no arguments working as the current full persisted
  session browser.
- Add `/history <query>` to open the same browser filtered by local persisted
  message content.
- Search must be case-insensitive and should match user prompts, assistant
  text, system text, and string tool outputs stored in session JSONL.
- Search result rows should show a useful preview around the first match when
  possible, falling back to the existing first-user-message preview.
- Malformed or unreadable persisted messages must not crash the history
  browser.
- Keep the UI compact and width-aware; this task may show the active query and
  result count but must not add a new full dialog or keybinding system.

## Acceptance Criteria

- [x] `HistoryStore.search(query)` returns newest-first matching sessions with
  case-insensitive content matching and match-derived previews.
- [x] Blank search input preserves `HistoryStore.list()` behavior.
- [x] `/history <query>` returns a `history-list` dialog descriptor carrying
  the query while keeping the disabled-persistence text path unchanged.
- [x] `SessionList` renders a compact filtered-result line for nonblank
  queries and still supports resume/delete/cancel keyboard actions.
- [x] Focused tests pass for core history search, slash handling, and the
  history TUI list.

## Notes

- Research reference:
  `research/codex-history-search.md`.
- MVP excludes prompt Ctrl+R reverse history search and a persistent search
  index.
- Verification on 2026-05-27:
  - `npm test -- test/core/session/history/store.test.ts test/slash/history.test.ts test/tui/History/SessionList.test.tsx test/tui/app.test.tsx`
    passed with 4 files / 36 tests, including App-level `/history <query>`
    orchestration, filtered-delete query retention, and explicit
    resume/delete/cancel keyboard coverage for the history list.
  - `npm run build` exited 0 and reported `dist/cli.js` at 576.1 KiB.
  - `node dist/cli.js explore sweep --fixture-root=test/ui-auto/fixtures --no-judge`
    passed with 209 cases / 0 failures.
  - `npm run typecheck` exited 0.
  - `npm run lint` exited 0 with the existing 55 warning baseline.
  - `git diff --check` exited 0.
