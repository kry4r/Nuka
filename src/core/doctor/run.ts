// src/core/doctor/run.ts
// Phase 10 §4.4 — Doctor diagnostics core.
//
// `runDoctor(deps)` runs all checks in parallel (each capped at 5 s) and
// returns a `DoctorReport`. The individual check modules live under `checks/`.

import { nodeCheck } from './checks/node'
import { providersCheck } from './checks/providers'
import { pluginsCheck } from './checks/plugins'
import { lspCheck } from './checks/lsp'
import { configCheck } from './checks/config'
import { diskCheck } from './checks/disk'
import type { ProviderResolver } from '../provider/resolver'
import type { LspManager } from '../lsp/manager'

/** Reject after `ms` milliseconds with a `${label} timeout` error. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    p.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export type CheckStatus = 'ok' | 'warn' | 'fail'

export type Check = {
  name: string
  status: CheckStatus
  detail: string
  remedy?: string
}

export type DoctorReport = {
  ok: boolean
  checks: Check[]
}

export type DoctorDeps = {
  /** $HOME for disk check */
  home: string
  /** current working directory for config check */
  cwd: string
  /** If absent, providers check is skipped to avoid real API calls in CI */
  providers?: ProviderResolver
  /** If absent, plugins check uses default home-based plugin discovery */
  plugins?: { dirs: string[] }
  /** If absent, lsp check is skipped */
  lsp?: LspManager
}

const CHECK_TIMEOUT_MS = 5_000

type RawCheckFn = (deps: DoctorDeps) => Promise<Check | Check[]>

const ALL_CHECKS: Array<{ name: string; fn: RawCheckFn }> = [
  { name: 'node',      fn: nodeCheck },
  { name: 'providers', fn: providersCheck },
  { name: 'plugins',   fn: pluginsCheck },
  { name: 'lsp',       fn: lspCheck },
  { name: 'config',    fn: configCheck },
  { name: 'disk',      fn: diskCheck },
]

export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const results = await Promise.allSettled(
    ALL_CHECKS.map(({ name, fn }) =>
      withTimeout(fn(deps), CHECK_TIMEOUT_MS, `check:${name}`).catch(err => {
        // Convert timeout/unexpected errors into a fail check
        const check: Check = {
          name,
          status: 'fail',
          detail: (err as Error).message ?? 'unknown error',
          remedy: 'Check system environment and retry.',
        }
        return check
      }),
    ),
  )

  const checks: Check[] = []
  for (const res of results) {
    if (res.status === 'fulfilled') {
      const val = res.value
      if (Array.isArray(val)) {
        checks.push(...val)
      } else {
        checks.push(val)
      }
    } else {
      // Shouldn't happen since we .catch() above, but handle defensively
      checks.push({
        name: 'unknown',
        status: 'fail',
        detail: String(res.reason),
      })
    }
  }

  const ok = checks.every(c => c.status === 'ok' || c.status === 'warn')
  return { ok, checks }
}
