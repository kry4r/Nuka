# Subagent runtime frontmatter hooks and MCP parity

## Goal

Close the next Nuka-Code subagent parity gap by allowing loose-file and plugin
agent definitions to carry Nuka-Code-style runtime frontmatter for MCP and hook
requirements without destabilizing Nuka's existing tool registry, plugin hooks,
or subagent dispatch flow.

This slice is deliberately about typed metadata and runtime availability
boundaries. It does not attempt to implement full agent-specific MCP server
connection or executable per-agent hook modules in one step.

## Requirements

- Accept and preserve `requiredMcpServers` on loose-file and plugin agent
  definitions.
- Accept and preserve declarative `mcpServers` metadata on loose-file and
  plugin agent definitions in a JSON-serializable shape.
- Accept and preserve declarative `hooks` metadata on loose-file and plugin
  agent definitions in a JSON-serializable shape.
- Filter agent visibility for `dispatch_agent` / `spawn_agent` descriptions and
  lookup through available MCP server names when an agent declares
  `requiredMcpServers`.
- Keep registered agents with unmet required MCP servers unavailable through the
  public agent tools, with clear unknown/unavailable-agent messaging.
- Preserve current behavior for agents that do not declare MCP or hook
  metadata.
- Do not execute arbitrary hook modules from agent frontmatter in this slice.
- Do not connect new MCP servers from agent frontmatter in this slice unless
  Nuka already has a safe reusable MCP runtime boundary; metadata-only support
  is acceptable and must be documented in output/spec boundaries.
- Keep unsupported Nuka-Code runtime pieces explicit: agent-specific MCP
  connection lifecycle, frontmatter hook execution, admin trust policy, and MCP
  tool hydration remain future work unless implemented and tested here.

## Acceptance Criteria

- [ ] Loose-file YAML/JSON/Markdown agents can declare
  `requiredMcpServers`, `mcpServers`, and `hooks`; the loader preserves the
  fields and still rejects malformed shapes.
- [ ] Plugin manifest agents can declare the same fields via `AgentDefSchema`
  and `resolveAgentDef` preserves them.
- [ ] `subagentToAgentDef` retains the runtime frontmatter metadata during
  loose-file registration.
- [ ] `AgentRegistry` can expose an availability-filtered view based on MCP
  server names, using Nuka-Code-compatible case-insensitive substring matching
  for `requiredMcpServers`.
- [ ] `dispatch_agent` and `spawn_agent` list only available agents when an
  availability filter is supplied, and reject hidden required-MCP agents with a
  clear unavailable/unknown message.
- [ ] Existing dispatch/spawn behavior remains unchanged when no availability
  filter is supplied.
- [ ] Focused tests cover loader parsing, schema preservation, registry
  filtering, dispatch/spawn visibility and rejection behavior, plus unchanged
  no-filter behavior.
- [ ] `npm test -- test/core/agents/subagentLoader.test.ts test/core/agents/loader.test.ts test/core/agents/registry.test.ts test/core/agents/dispatchTool.test.ts test/core/agents/spawnTool.test.ts`
  passes.
- [ ] `npm run typecheck` and `git diff --check` pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Nuka-Code references inspected:
  `/data/xtzhang/Nuka-Code/src/tools/AgentTool/loadAgentsDir.ts`,
  `/data/xtzhang/Nuka-Code/src/tools/AgentTool/runAgent.ts`, and
  `/data/xtzhang/Nuka-Code/src/tools/AgentTool/AgentTool.tsx`.
- Current Nuka references inspected:
  `src/core/agents/types.ts`, `src/core/agents/subagentLoader.ts`,
  `src/core/agents/registry.ts`, `src/core/agents/dispatchTool.ts`,
  `src/core/agents/spawnTool.ts`, and `src/core/hooks/*`.
