# Implementation Plan

## Scope

Implement metadata and availability filtering only. Keep the write set focused
on:

- `src/core/agents/types.ts`
- `src/core/agents/subagentLoader.ts`
- `src/core/agents/registry.ts`
- `src/core/agents/dispatchTool.ts`
- `src/core/agents/spawnTool.ts`
- focused tests under `test/core/agents/*`

## Steps

1. [ ] RED tests for metadata parsing and preservation
   - Add loose-file loader tests for Markdown/YAML `requiredMcpServers`,
     `mcpServers`, and `hooks`.
   - Add plugin-schema/loader coverage through `resolveAgentDef`.
   - Add `subagentToAgentDef` preservation assertions.

2. [ ] RED tests for MCP availability filtering
   - Add `AgentRegistry` tests for no requirements, satisfied requirements,
     unsatisfied requirements, and case-insensitive substring matching.
   - Add dispatch/spawn tool tests proving hidden agents are omitted from tool
     descriptions and rejected when selected.
   - Add no-filter tests proving existing behavior is unchanged.

3. [ ] Add typed contracts
   - Add optional metadata fields to `AgentDefSchema`, `AgentDef`, and
     `ResolvedAgentDef`.
   - Add optional fields to `SubagentDefinition`.
   - Keep runtime shapes JSON-serializable.

4. [ ] Implement parser/preservation path
   - Normalize `requiredMcpServers` from Markdown frontmatter.
   - Preserve `mcpServers` and `hooks` values without executing them.
   - Thread fields through `subagentToAgentDef` and `resolveAgentDef`.

5. [ ] Implement availability filtering
   - Add registry helper(s) for MCP-aware list/find.
   - Thread optional available-MCP callback into dispatch/spawn tools.
   - Keep unknown/unavailable error messages clear and list only available
     agents.

6. [ ] Verify
   - `npm test -- test/core/agents/subagentLoader.test.ts test/core/agents/loader.test.ts test/core/agents/registry.test.ts test/core/agents/dispatchTool.test.ts test/core/agents/spawnTool.test.ts`
   - `npm run typecheck`
   - `git diff --check`

## Rollback

If preserving arbitrary `mcpServers` / `hooks` metadata causes type or bundle
issues, keep `requiredMcpServers` filtering and defer the opaque metadata
fields with an explicit PRD update.
