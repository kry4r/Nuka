# Codex History Search Reference

## Sources Checked

- `/tmp/openai-codex/codex-rs/tui/src/bottom_pane/chat_composer/history_search.rs`
- `/tmp/openai-codex/codex-rs/tui/src/resume_picker.rs`
- `/tmp/openai-codex/codex-rs/tui/src/keymap.rs`
- `/tmp/openai-codex/codex-rs/tui/src/keymap_setup/actions.rs`

## Findings

Codex has two adjacent search patterns:

- Composer reverse history search, opened through the composer keymap
  (`history_search_previous` / `history_search_next`, default Ctrl+R/Ctrl+S).
  This searches prompt-entry history and previews matches in the composer.
- Resume picker search, where the persisted-session picker exposes a visible
  "Type to search" line and filters resume candidates.

## Mapping To Nuka

Nuka already has prompt input history navigation and a persisted `/history`
browser backed by `SessionStore` / `HistoryStore`. The accepted feature row is
"Local conversation history search" and specifically mentions recovery of
prior work by content, so the closest low-risk MVP is a searchable persisted
session browser rather than a prompt-composer reverse-search port.

## MVP Recommendation

Add content search to `HistoryStore`, allow `/history <query>` to open the
existing full-screen history browser with filtered results, and render the
active query in the list. Keep prompt Ctrl+R history search out of scope for
this child task because it affects prompt input ownership and keybindings.
