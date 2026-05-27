# Add local conversation history search - design

## Scope

This child task implements the accepted Codex CLI local conversation history
search row for Nuka's existing persisted-session history browser.

The MVP is `/history <query>` plus a core search API over persisted session
messages. It is not a prompt-composer reverse search and does not add new
keybindings.

## Data Flow

`/history <query>` -> `DialogDescriptor { kind: "history-list", query }` ->
`App.tsx` -> `HistoryStore.search(query)` -> `SessionStore.list()` plus
`SessionStore.readMessages(sessionId)` -> `SessionList`.

Blank queries preserve the existing `HistoryStore.list()` behavior. Nonblank
queries perform case-insensitive matching across local persisted message text
and return newest-first `HistoryListEntry` rows with the existing metadata plus
a match-derived preview.

## Contracts

- `HistoryStore.search(query)` returns `HistoryListEntry[]`.
- Search is local only and reads the same persisted session JSONL files used by
  `/history` and `--resume`.
- Matching is case-insensitive and whitespace-normalized.
- User, assistant, system, and string tool output text are searchable.
  Non-text image blocks and opaque Responses compaction payloads are ignored.
- Result previews prefer a snippet around the first match. If no snippet is
  available, the existing first-user-message preview remains the fallback.
- Malformed or unreadable message files do not crash the browser; those
  sessions simply do not match a nonblank query.
- `SessionList` remains presentational. It receives the active query and
  displays a compact filtered-result line.

## Out Of Scope

- Interactive in-dialog typing or filtering after the dialog opens.
- Composer Ctrl+R reverse prompt history search.
- A persistent search index. The MVP scans persisted JSONL on demand.
- Cross-project privacy controls beyond the existing history directory and
  persistence gate.

## Verification Strategy

- Core tests for case-insensitive content search, match previews, no-match
  behavior, and fallback list behavior for blank queries.
- Slash tests for `/history <query>` preserving the persistence gate and
  returning the query on the dialog descriptor.
- TUI tests for the filtered-result line and existing resume/delete behavior.
- Focused verification:
  - `npm test -- test/core/session/history/store.test.ts test/slash/history.test.ts test/tui/History/SessionList.test.tsx`
  - `npm run typecheck`
  - `git diff --check`
