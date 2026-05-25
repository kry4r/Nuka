# Nuka-Code Frontmatter Runtime Notes

## References

- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/loadAgentsDir.ts`
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/runAgent.ts`
- `/data/xtzhang/Nuka-Code/src/tools/AgentTool/AgentTool.tsx`
- Current Nuka: `src/core/agents/types.ts`,
  `src/core/agents/subagentLoader.ts`, `src/core/agents/registry.ts`,
  `src/core/agents/dispatchTool.ts`, `src/core/agents/spawnTool.ts`

## Findings

Nuka-Code agent definitions carry runtime metadata beyond prompt and tool
allowlists:

- `requiredMcpServers` controls whether an agent is offered when required MCP
  server names are unavailable.
- `mcpServers` declares agent-specific MCP server references or inline server
  definitions.
- `hooks` declares agent-scoped hook settings.

Nuka-Code filters available agents before rendering the Agent tool prompt by
checking each `requiredMcpServers` pattern against available MCP server names
using case-insensitive substring matching.

Nuka's current loose-file loader is strict and rejects these fields. Nuka's
plugin `AgentDefSchema` also rejects them. Nuka has a HookRegistry and plugin
hook module support, but no safe agent-specific hook execution boundary yet.
Nuka has MCP-style source labels and MCP mentions in tests, but the inspected
subagent dispatch path does not expose a reusable agent-specific MCP client
connection lifecycle.

## Recommended Slice

First implement typed metadata preservation plus required-MCP availability
filtering. Defer actual MCP connection and hook execution until those runtime
boundaries can be tested for cleanup, trust policy, and tool hydration.
