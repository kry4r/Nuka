# Failure dump: bug-a-001

- **component:** BugA-TodoWritePromptSurface
- **case:** tool-description-has-when-not-to-use
- **viewport:** 120x30
- **timestamp:** 2026-05-18T00:00:00.000Z
- **gridHash:** 0000000000000000000000000000000000000000000000000000000000000000
- **fixturePath:** /data/xtzhang/Nuka/test/ui-auto/fixtures/regression-bug-a.fixtures.tsx

## Violations

### prompt-surface-missing-when-not-to-use (error)

Bug A: TodoWrite.description missing "When NOT to use" section.

The model genuinely returns tool_use:TodoWrite on trivial conversational
inputs like "hello" because nothing in the prompt surface tells it not
to. Two fix sites are required (bringup §2.1):

  1. src/core/tools/todoWrite.ts:17 — extend tool description with a
     "When NOT to use" paragraph listing greetings, single-step tasks,
     and informational replies.
  2. src/core/agent/systemPrompt.ts — inject a "TodoWrite usage:"
     section into the assembled system prompt so the model sees the
     guidance at the top-level prompt, not just per-tool.

```
todo-tool-prompt-surface
```

Cells: (0,0)

## ASCII view

```
todo-tool-prompt-surface
```
