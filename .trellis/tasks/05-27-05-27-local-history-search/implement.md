# Add local conversation history search - implementation plan

1. [x] Add RED tests.
   - Extend `test/core/session/history/store.test.ts` for
     `HistoryStore.search`.
   - Extend `test/slash/history.test.ts` for `/history <query>`.
   - Extend `test/tui/History/SessionList.test.tsx` for nonblank query display.

2. [x] Implement core search.
   - Add search result support in `src/core/session/history/types.ts` if needed.
   - Add text extraction and snippet construction to
     `src/core/session/history/store.ts`.
   - Keep blank query behavior delegated to `list()`.

3. [x] Wire slash and App.
   - Extend `DialogDescriptor` for `history-list` query metadata.
   - Update `src/slash/history.ts` usage/examples and dialog return.
   - Update `src/tui/App.tsx` history dialog loading/deleting to use the active
     query when present.
   - Add App-level regression coverage for `/history <query>` opening filtered
     persisted results and preserving the active filter after delete.

4. [x] Update TUI list.
   - Add a `query` prop to `SessionList`.
   - Render a concise result-count line for nonblank queries.
   - Preserve existing keyboard behavior.

5. [x] Verify and record evidence.
   - Run `npm test -- test/core/session/history/store.test.ts test/slash/history.test.ts test/tui/History/SessionList.test.tsx`.
   - Run `npm run typecheck`.
   - Run `git diff --check`.
   - Update this task and the parent roadmap/PRD evidence.

## Rollback

The slice is additive. Rollback removes the `HistoryStore.search` helper,
the optional dialog query field, and the query display in `SessionList`.

## Verification

- RED evidence: the focused set first failed for missing
  `history.search`, missing dialog `query`, and missing `SessionList` search
  summary. A later RED check caught the empty filtered state still saying
  "No past sessions."
- `npm test -- test/core/session/history/store.test.ts test/slash/history.test.ts test/tui/History/SessionList.test.tsx test/tui/app.test.tsx`
  passed with 4 files / 36 tests, including App-level `/history <query>`
  orchestration, filtered-delete query retention, and explicit
  resume/delete/cancel keyboard coverage for the history list.
- `npm run build` exited 0 and reported `dist/cli.js` at 576.1 KiB.
- Initial explorer sweep caught that narrow search rows clipped the match
  preview to `AUTH ...`; search-mode rows now prioritize the matched preview.
- `node dist/cli.js explore sweep --fixture-root=test/ui-auto/fixtures --no-judge`
  passed with 209 cases / 0 failures.
- `npm run typecheck` exited 0.
- `npm run lint` exited 0 with the existing 55 warning baseline.
- `git diff --check` exited 0.
