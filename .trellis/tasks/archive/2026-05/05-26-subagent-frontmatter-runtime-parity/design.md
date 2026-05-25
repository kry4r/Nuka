# Subagent Frontmatter Runtime Parity Design

## Current Behavior

Nuka already loads Nuka-Code-style loose-file subagents and preserves several
runtime fields such as `memory`, `isolation`, `background`, `permissionMode`,
`initialPrompt`, `effort`, and `skills`. It does not yet accept
`requiredMcpServers`, `mcpServers`, or `hooks` on either loose-file agents or
plugin manifest agents. Because the schemas are strict, these frontmatter
fields currently reject otherwise valid Nuka-Code agent definitions.

Nuka's subagent tools list all registered agents from `AgentRegistry`, with no
availability filtering based on MCP server requirements.

## Target Slice

This task adds a typed metadata contract and a safe availability gate:

- `AgentDefSchema` and `ResolvedAgentDef` carry optional
  `requiredMcpServers`, `mcpServers`, and `hooks`.
- `SubagentDefinition` and `subagentToAgentDef` preserve the same fields.
- Markdown frontmatter normalizes list-like fields in the same style as
  existing `tools` and `skills` parsing.
- `AgentRegistry` exposes MCP-aware filtering helpers so tools can list and
  resolve only available agents when the host supplies available MCP server
  names.
- `dispatch_agent` and `spawn_agent` accept an optional
  `availableMcpServers` callback from CLI wiring. When present, they list and
  resolve through the filtered view.

## Contracts

### Metadata Shape

`requiredMcpServers?: string[]`

Required MCP server name patterns. A requirement is satisfied when at least one
available server name contains the required pattern case-insensitively.

`mcpServers?: unknown[]`

Declarative MCP server metadata preserved for later runtime support. This slice
does not interpret or connect it.

`hooks?: unknown`

Declarative hook metadata preserved for later runtime support. This slice does
not execute it.

### Visibility

No availability callback:

- All registered agents remain visible and dispatchable, preserving existing
  behavior and tests.

Availability callback supplied:

- Agents with no `requiredMcpServers` remain visible.
- Agents whose requirements are satisfied remain visible.
- Agents whose requirements are not satisfied are hidden from tool
  descriptions and cannot be selected by `dispatch_agent` or `spawn_agent`.

## Deferred

- Starting agent-specific MCP clients from `mcpServers`.
- Hydrating MCP tools into a subagent-specific tool registry.
- Executing frontmatter hooks or importing hook modules from agent files.
- Admin trust and plugin-only lockdown policy for agent frontmatter.

Those are larger runtime changes and need separate tests around security,
cleanup, tool hydration, and failure isolation.

## Validation

Focused tests should prove:

- Loader/schema acceptance and rejection behavior.
- Metadata survives loose-file conversion and plugin-agent resolution.
- Registry filtering matches Nuka-Code's required-MCP semantics.
- Dispatch/spawn tools hide and reject unavailable agents only when the host
  supplies MCP availability.
- Existing no-filter dispatch/spawn behavior stays green.
