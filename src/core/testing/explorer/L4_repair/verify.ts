// src/core/testing/explorer/L4_repair/verify.ts
//
// M5.T2 — re-mount + L0/L1 verification of a single fixture case at a
// single viewport. See locked spec §4.6 step 3.
//
// **worker_threads (NOT a subprocess — spec §4.6/§509 interpretation):**
//   Spec §509 says "no subprocess". `worker_threads` is NOT a subprocess:
//   the Worker runs in the SAME process (same PID) but in a separate V8
//   isolate with its own ESM module registry. This satisfies the spec's
//   intent (no IPC overhead, no spawn cost, no PATH-resolution surprises)
//   while giving us a *fresh module graph per verify call*, including all
//   transitive imports. The old copy-rename hack only freshened the entry
//   file's cache key; transitive deps still hit the stale registry.
//
// **M6.P0 fix (transitive deps):**
//   M6.T1 observed that verify() was producing false-positive "verified"
//   when the Opus subagent edited non-fixture source files (e.g.
//   src/core/tools/todoWrite.ts). The old in-process strategy could never
//   fix this because Node's ESM registry is append-only: once a URL is
//   cached, no userland API can evict it. worker_threads solves it cleanly:
//   each Worker boots a brand-new V8 isolate whose module registry is empty,
//   so every import — including transitive deps — is resolved fresh from disk.
//
// **Worker startup timing (empirical — measured 2026-05-18):**
//   Round-trip ~700-850ms per verify() call. At the M5.T3 default budget of
//   maxTurns=20, that adds ≤17s of worker overhead — well inside the
//   300s wall-clock budget. Flagged here for future tuning if turn count
//   increases significantly.
//
// **Fallback policy:**
//   1. Worker with `execArgv: ['--import', 'tsx']` — this is the primary path.
//      tsx's ESM loader hook registers inside the worker isolate so tsImport
//      can handle .tsx resolution.
//   2. Only if both Worker variants fail empirically may the caller fall back
//      to spawning a subprocess — that deviation MUST be documented in the
//      header. This file intentionally contains no subprocess imports.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import type { Viewport, Violation } from '../types'

export type VerifyOpts = {
  fixturePath: string
  caseName: string
  viewport: Viewport
  cwd: string
}

export type VerifyResult =
  | { clean: true }
  | { clean: false; violations: Violation[] }

// 30-second timeout per verify call — generous enough for slow CI and warm
// worker startup, tight enough to surface hangs rather than silently eating
// the whole repair budget.
const VERIFY_TIMEOUT_MS = 30_000

/**
 * Mount one fixture-case at one viewport, run L1 invariants, return the
 * pass/fail JSON.
 *
 * Each call spins up a fresh worker_threads Worker with its own V8 isolate
 * and ESM module registry. This guarantees that every verify() call sees the
 * latest on-disk content of ALL imported modules — not just the fixture entry
 * file. The Worker shares the same process PID (not a subprocess per spec
 * §4.6/§509).
 *
 * @throws if `fixturePath` does not exist, is not loadable as a FixtureDef,
 *         or `caseName` is not present in the fixture's `cases` map.
 */
export async function verify(opts: VerifyOpts): Promise<VerifyResult> {
  const { fixturePath, caseName, viewport, cwd } = opts

  const absPath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.join(cwd, fixturePath)

  if (!existsSync(absPath)) {
    throw new Error(`verify: fixture not found: ${absPath}`)
  }

  // Resolve the worker entry. In source-mode (vitest, tsx) import.meta.url
  // points at the .ts file; in dist mode it points at dist/explorer.js. We
  // probe for a .js neighbour first (dist) then fall back to .ts (source).
  const workerUrl = resolveWorkerUrl()

  return new Promise<VerifyResult>((resolve, reject) => {
    let settled = false

    const worker = new Worker(workerUrl, {
      workerData: { fixturePath: absPath, caseName, viewport, cwd },
      execArgv: ['--import', 'tsx'],
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(
        new Error(
          `verify: worker timed out after ${VERIFY_TIMEOUT_MS}ms ` +
            `(fixture: ${absPath}, case: ${caseName})`,
        ),
      )
    }, VERIFY_TIMEOUT_MS)

    worker.on('message', (msg: { clean: boolean; violations?: Violation[]; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (msg.error) {
        reject(new Error(`verify: worker error — ${msg.error}`))
        return
      }
      if (msg.clean) {
        resolve({ clean: true })
      } else {
        resolve({ clean: false, violations: msg.violations ?? [] })
      }
    })

    worker.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`verify: worker failed — ${err.message}`))
    })

    worker.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`verify: worker exited with code ${code}`))
      }
    })
  })
}

/**
 * Resolve the verifyWorker entry path. In dist mode (import.meta.url ends
 * with .js or is under dist/) we look for verifyWorker.js next to the
 * current bundle. In source mode we use verifyWorker.ts next to this file.
 */
function resolveWorkerUrl(): URL | string {
  const selfUrl = import.meta.url
  const isDist =
    selfUrl.endsWith('.js') ||
    selfUrl.includes('/dist/') ||
    selfUrl.includes('\\dist\\')

  if (isDist) {
    // dist/explorer.js lives alongside dist/verifyWorker.js
    const selfDir = path.dirname(fileURLToPath(selfUrl))
    return path.join(selfDir, 'verifyWorker.js')
  }

  // Source mode: verifyWorker.ts is next to verify.ts
  return new URL('./verifyWorker.ts', selfUrl)
}
