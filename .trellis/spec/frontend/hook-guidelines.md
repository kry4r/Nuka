# Hook Guidelines

> How hooks are used in this project.

---

## Overview

Hooks are used for terminal size, prompt editing, monitor subscriptions,
session streams, task columns, and small UI behaviors. Keep hooks close to the
feature they serve unless they are broadly reused.

---

## Custom Hook Patterns

Use hooks to isolate stateful behavior from rendering, but keep pure
transformations in plain functions or reducers.

Examples:

- `src/tui/hooks/useTerminalSize.ts` reads `useStdout()` and subscribes to
  resize events.
- `src/tui/PromptInput/useInputHistory.ts` owns history cursor state for the
  prompt.
- `src/tui/Tasks/useTasksColumns.ts` subscribes to the event bus and delegates
  event handling to `columnReducer`.
- `src/tui/promptMentions/usePromptMention.ts` exposes imperative handlers so
  the host `PromptInput` can keep one `useInput` path.

Pattern:

```typescript
export function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout()
  const [size, setSize] = useState(() => readTerminalSize(stdout))
  useEffect(() => {
    const onResize = () => setSize(readTerminalSize(stdout))
    onResize()
    stdout.on('resize', onResize)
    return () => { stdout.off('resize', onResize) }
  }, [stdout])
  return size
}
```

When a callback is passed into `useInput` or a subscription, prefer
`useCallback`. If the callback must see state updated by another input handler
before React re-subscribes, mirror that state in a ref.

---

## Data Fetching

There is no React Query/SWR layer. Runtime state comes from core services,
event buses, slash command effects, and provider streams composed by
`src/cli.tsx` and `src/tui/App.tsx`.

Guidelines:

- Keep provider/tool/task fetching in `src/core` or `src/cli.tsx`; components
  receive data and callbacks.
- Hooks may subscribe to in-process services such as the event bus, but should
  clean up listeners in `useEffect` return functions.
- For async command effects, `App.tsx` owns orchestration and appends user-visible
  notices instead of letting leaf components mutate session state directly.

---

## Naming Conventions

- Custom hooks must start with `use`.
- Feature-local hooks live with the feature: `PromptInput/useInputHistory.ts`,
  `Tasks/useTasksColumns.ts`.
- Shared TUI hooks live in `src/tui/hooks/`: `useTerminalSize`,
  `useAgentStream`, `useAwayRecap`, `useIdlePoke`, `useSession`.
- Pure helpers must not be named like hooks. Use names such as
  `rollupTokens`, `bucketTimeline`, `columnReducer`, or `formatProviderModel`.

---

## Common Mistakes

- Mounting competing `useInput` handlers for the same flow. This has caused
  tests to miss or duplicate keystrokes; prefer one root handler for wizard or
  dialog flows.
- Assuming a visual state change from one keypress means the next keypress sees
  that state inside every nested input callback. Use refs for cross-handler
  navigation state, as documented in `quality-guidelines.md`.
- Leaving event-bus or stdout resize subscriptions without cleanup.
- Putting pure width/layout math into hooks, which makes it harder to unit test
  without Ink. Keep pure layout helpers as plain functions where possible.
