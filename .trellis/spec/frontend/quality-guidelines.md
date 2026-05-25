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

### Scenario: Agent runtime frontmatter metadata

#### 1. Scope / Trigger

- Trigger: loose-file or plugin agent definitions add runtime metadata such as
  MCP availability requirements or declarative hook/MCP server configuration.

#### 2. Signatures

- Contract owner: `src/core/agents/types.ts`.
- Loader boundary: `AgentDefSchema`, `ResolvedAgentDef`, and
  `SubagentDefinition`.
- Visibility boundary:
  `AgentRegistry.listAvailable(availableMcpServers: readonly string[])` and
  `findAvailable(name, availableMcpServers)`.
- Tool host boundary: public agent tools may accept
  `availableMcpServers?: () => readonly string[]`.

#### 3. Contracts

- `requiredMcpServers?: string[]` contains case-insensitive server-name
  patterns. Every required pattern must match at least one available server
  name by substring.
- `mcpServers?: JsonValue[]` and `hooks?: JsonValue` are declarative metadata
  only until a later task adds tested MCP lifecycle or hook execution support.
- `JsonValue` means JSON primitives, arrays, and string-keyed records only.
  Do not allow functions, `undefined`, symbols, class instances, or other
  non-serializable values through plugin or loose-file schemas.
- Availability callback omitted preserves existing behavior: all registered
  agents remain visible and selectable.
- Availability callback supplied and requirements unmet hides the agent from
  public tool descriptions and rejects direct selection with an unavailable
  message listing required MCP servers.

#### 4. Tests Required

- Loader tests for loose-file YAML/JSON/Markdown preservation of
  `requiredMcpServers`, `mcpServers`, and `hooks`.
- Plugin-loader tests proving `resolveAgentDef` preserves the fields and the
  schema rejects non-JSON metadata.
- Registry tests for required-MCP filtering and MCP server-name extraction from
  `mcp__server__tool`.
- Dispatch/spawn tests for description filtering, direct-selection rejection,
  and unchanged no-filter behavior.

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
