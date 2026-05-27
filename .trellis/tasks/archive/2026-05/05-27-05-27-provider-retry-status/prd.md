# Provider retry status

## Goal

Add provider retry config, pre-first-event stream retry, lifecycle events, and TUI retry status without transcript noise.

## Requirements

- Add `provider.retry` config for max attempts, backoff timing, jitter, and
  idle timeout.
- Retry provider streams only when an attempt fails before the first provider
  event; do not replay after partial output.
- Emit an `agent.provider.retry` event for retry visibility without appending
  transcript messages.
- Show a compact retry segment in the TUI statusline for the active session and
  clear it when a turn starts or settles.

## Acceptance Criteria

- [x] Config loading preserves project-scoped provider retry settings.
- [x] Agent loop retries pre-first-event stream failures and emits retry events.
- [x] Agent loop does not retry after partial provider output.
- [x] StatusPanel and App show retry state without transcript noise.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
