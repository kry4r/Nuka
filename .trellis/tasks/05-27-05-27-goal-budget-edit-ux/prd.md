# Goal budget edit UX

## Goal

Add /goal edit and token-budget UX with statusline labeling.

## Requirements

- Let users edit the current goal objective without losing status, blocker, or
  budget metadata.
- Let users set and clear a token budget from `/goal budget`.
- When rendering a goal with a budget, account for current session token usage
  so an over-budget active goal becomes visibly budget-limited.
- Keep the TUI status row readable by rendering `budget_limited` as a short
  `budget:` prefix instead of the raw enum value.

## Acceptance Criteria

- [x] `/goal edit <text>` preserves existing status and budget fields.
- [x] `/goal budget <tokens|clear>` updates budget metadata and validates bad
  input without replacing the objective.
- [x] `/goal` with current token usage over budget updates and displays
  `budget_limited`.
- [x] `StatusPanel` renders budget-limited goals with a user-facing label.

## Notes

- Lightweight task; no separate design document.
