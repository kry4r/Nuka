// src/core/doctor/checks/mcp.ts
// Phase 10 §4.4 — MCP servers check.

import type { Check, DoctorDeps } from '../run'

export async function mcpCheck(deps: DoctorDeps): Promise<Check[]> {
  if (!deps.mcp) {
    return [
      {
        name: 'mcp',
        status: 'ok',
        detail: 'No MCP manager configured (skipped)',
      },
    ]
  }

  const statuses = deps.mcp.status()
  if (statuses.length === 0) {
    return [
      {
        name: 'mcp',
        status: 'ok',
        detail: 'No MCP servers configured',
      },
    ]
  }

  return statuses.map(({ name, status }) => {
    if (status.kind === 'connected') {
      return {
        name: `mcp:${name}`,
        status: 'ok' as const,
        detail: `${name} connected`,
      }
    }
    if (status.kind === 'error') {
      return {
        name: `mcp:${name}`,
        status: 'fail' as const,
        detail: `${name} error: ${status.error ?? 'unknown'}`,
        remedy: `Check MCP server config for '${name}' in ~/.nuka/config.yaml.`,
      }
    }
    // idle / connecting
    return {
      name: `mcp:${name}`,
      status: 'warn' as const,
      detail: `${name} status: ${status.kind}`,
      remedy: `MCP server '${name}' is not yet connected. Try restarting.`,
    }
  })
}
