# Directory Structure

> How frontend code is organized in this project.

---

## Overview

Nuka's "frontend" is an Ink terminal UI. UI code lives under `src/tui/`,
while domain logic, persistence, tools, providers, testing utilities, and
event buses live under `src/core/`. UI components should be thin renderers
over typed data and callbacks from core modules.

---

## Directory Layout

```
src/
├── cli.tsx                         # composition root and CLI wiring
├── core/                           # provider, agent, tasks, config, testing, tools
│   ├── agent/                      # main agent loop, compact wiring, system prompt
│   ├── agents/                     # subagent definitions, spawn/resume/send tools
│   ├── compact/                    # manual/native compact and local microcompact
│   ├── config/                     # zod schemas, load/save, migrations
│   ├── events/                     # typed event bus payloads
│   ├── tasks/                      # background task runtime and sidecars
│   └── testing/explorer/           # Ink capture/sweep/fuzz/judge harness
└── tui/
    ├── App.tsx                     # top-level Ink state machine and routing
    ├── Messages/                   # transcript rows and tool/agent call renderers
    ├── PromptInput/                # prompt editing, history, mentions
    ├── Status/                     # statusline and cost/context banners
    ├── Submenu/                    # settings/tasks/harness submenus
    ├── Tasks/                      # task and subagent monitor panels
    ├── Welcome/                    # boot screen and feed layout
    ├── design-system/              # small reusable Ink primitives
    ├── dialogs/                    # full-screen or picker-style dialogs
    ├── hooks/                      # TUI-only hooks
    └── testing/                    # TUI test harness helpers
```

---

## Module Organization

Keep feature boundaries aligned with runtime ownership:

- Put business logic and contracts in `src/core/<feature>/`.
- Put Ink presentation in `src/tui/<Feature>/`.
- Put command registration and cross-feature wiring in `src/cli.tsx`.
- Put test helpers that are generally reusable under `src/core/testing/` or
  `src/tui/testing/`, not beside a single test file.
- Keep rare full-screen dialogs behind the existing sidecar boundary:
  `src/tui/dialogs/fullDialogComponents.ts` is bundled as `dist/tui-dialogs.js`.

Examples:

- Subagent runtime: `src/core/agents/*`, `src/core/tasks/*`, UI in
  `src/tui/Tasks/*`, tests in `test/core/agents/*` and `test/tui/Tasks/*`.
- Compact runtime: `src/core/compact/*`, config in `src/core/config/schema.ts`,
  CLI/TUI wiring in `src/cli.tsx` and `src/tui/Submenu/settings/CompactForm.tsx`.
- Statusline: rendering in `src/tui/Status/StatusPanel.tsx`, template logic in
  `src/tui/Status/statusLine.ts`, tests in `test/tui/Status.harness.test.tsx`.

---

## Naming Conventions

- React component files use PascalCase: `Messages/ToolCall.tsx`,
  `Tasks/SubagentDetail.tsx`, `Status/CostBanner.tsx`.
- TUI hooks use `use*` and live either next to their feature or in
  `src/tui/hooks/`: `PromptInput/useInputHistory.ts`,
  `Tasks/useTasksColumns.ts`, `hooks/useTerminalSize.ts`.
- Pure reducers/helpers use lower camel case filenames:
  `Tasks/columnReducer.ts`, `Welcome/layout.ts`, `Monitor/rollupTokens.ts`.
- Core modules generally group the implementation and tool wrapper together:
  `compact/compact.ts`, `compact/microCompact.ts`,
  `fileSearch/recentFilesTool.ts`.
- Tests mirror source ownership: `test/core/compact/compact.test.ts`,
  `test/tui/Messages.static.test.tsx`,
  `test/tui/Tasks/columnReducer.test.ts`.

---

## Examples

- `src/tui/Messages/` keeps transcript rendering split by row type while sharing
  width-sensitive behavior through `Markdown.tsx`, `MessageRow.tsx`, and
  `Messages.tsx`.
- `src/tui/Tasks/` separates pure state (`columnReducer.ts`,
  `focusReducer.ts`) from Ink rendering (`TasksPanelNew.tsx`,
  `SubagentDetail.tsx`).
- `src/core/config/schema.ts` centralizes runtime configuration shape with Zod,
  while feature-specific interpreters such as `src/core/config/microCompact.ts`
  convert config into runtime options.
- `src/core/testing/explorer/` owns the production-mode Ink capture pipeline
  used by UI regressions instead of duplicating screenshot logic in tests.
