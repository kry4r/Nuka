// src/core/doctor/checks/lsp.ts
// Phase 10 §4.4 — LSP servers check.

import type { Check, DoctorDeps } from '../run'

export async function lspCheck(deps: DoctorDeps): Promise<Check[]> {
  if (!deps.lsp) {
    return [
      {
        name: 'lsp',
        status: 'ok',
        detail: 'No LSP manager configured (skipped)',
      },
    ]
  }

  const defs = deps.lsp.list()
  if (defs.length === 0) {
    return [
      {
        name: 'lsp',
        status: 'ok',
        detail: 'No LSP servers registered',
      },
    ]
  }

  // The LspManager lazy-spawns clients; we report registered defs as 'ok' (warn
  // if not yet spawned — no status available without actually spawning).
  return defs.map(def => ({
    name: `lsp:${def.name}`,
    status: 'ok' as const,
    detail: `${def.name} registered (${def.command})`,
  }))
}
