# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Frontend components in this repo are terminal-first. When text can exceed the
viewport, width must be measured in terminal cells, not code units.

## Required Patterns

### Convention: Use display-width helpers for visible truncation

**What**: Use `stringWidth` and `truncateByWidth` for terminal text that may
need truncation or alignment.

**Why**: `String.prototype.length` undercounts CJK and emoji. Manual
`slice(0, n)` truncation can still overflow the viewport or cut a grapheme
mid-cluster.

**Example**:
```typescript
import { truncateByWidth } from '../../core/stringWidth'

const width = Math.max(20, columns - 4)
const summary = truncateByWidth(JSON.stringify(call.input), width)
```

**Related**: `useTerminalSize`, `PromptInput`, `Welcome`, `toolSummary`.

## Forbidden Patterns

- Using `.length` or `.slice()` to cap visible terminal text when display
  width matters.
- Re-implementing width-aware truncation in a component when the shared helper
  already exists.

## Testing Requirements

- Add a narrow viewport fixture for any text that can exceed the frame.
- Assert the visible tail or ellipsis that proves the text was truncated by
  display width.
- Keep the sweep baseline honest: a fixed regression fixture should fail on the
  broken implementation and pass after the width-aware fix.

## Common Mistakes

- Writing a fixture that asserts the full original string for content that is
  intentionally truncated.
- Assuming CJK characters are width 1.
