// src/core/testing/explorer/repair.ts
//
// L4 Repair verb — M5.T4 orchestrator. See locked spec §4.6.
//
// Flow:
//   1. Resolve the dump file from failureId (absolute path OR
//      .ink-explorer/failures/<id>.md OR the resolved/ mirror for the
//      idempotent re-run case).
//   2. Parse the dump into a FailureRecord via dumpReader.
//   3. Run the Opus subagent (callable via _client DI in tests).
//   4. On status=verified: promote a regression fixture, move the dump
//      from failures/ to resolved/ (overwrite if a previous resolved
//      copy exists — idempotent).
//   5. On exhausted/timeout: return promoted=false with the subagent's
//      summary so the caller (CLI) can decide whether to retry.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { readDump } from './L4_repair/dumpReader'
import { runRepairSubagent } from './L4_repair/subagent'
import { promote } from './L4_repair/promote'
import type { RepairOpts, RepairResult, FailureRecord } from './types'

/** Extended opts surface — accepts the _client DI used by tests. */
type RepairOptsExtended = RepairOpts & {
  _client?: Parameters<typeof runRepairSubagent>[0]['_client']
  _now?: () => number
}

const DEFAULT_OUT_REL = 'test/ui-auto/fixtures'

/**
 * Run one repair attempt end-to-end.
 *
 * @throws if neither the dump nor the resolved/ mirror exists.
 */
export async function repair(opts: RepairOptsExtended): Promise<RepairResult> {
  const {
    failureId,
    cwd = process.cwd(),
    apiKey = process.env.ANTHROPIC_API_KEY ?? '',
    maxTurns,
    timeoutMs,
    fixtureOutDir,
    _client,
    _now,
  } = opts

  const explorerRoot = path.join(cwd, '.ink-explorer')
  const failuresDir = path.join(explorerRoot, 'failures')
  const resolvedDir = path.join(explorerRoot, 'resolved')

  // ---- 1. Resolve dump path ----------------------------------------------
  const { dumpPath, alreadyResolved } = resolveDumpPath({
    failureId,
    failuresDir,
    resolvedDir,
  })

  // Idempotent fast-path: dump is already in resolved/ → assume previous
  // repair succeeded. Return promoted=true so callers don't error.
  if (alreadyResolved) {
    return {
      promoted: true,
      summary:
        `repair: dump ${failureId} already in resolved/ — skipping ` +
        `(idempotent re-run).`,
      status: 'verified',
    }
  }

  // ---- 2. Parse dump ------------------------------------------------------
  const failure: FailureRecord = readDump(dumpPath)

  // ---- 3. Run subagent ----------------------------------------------------
  const subagentRes = await runRepairSubagent({
    failure,
    cwd,
    apiKey,
    maxTurns,
    timeoutMs,
    _client,
    _now,
  })

  if (subagentRes.status !== 'verified') {
    return {
      promoted: false,
      summary: subagentRes.summary,
      status: subagentRes.status,
    }
  }

  // ---- 4. Promote regression fixture -------------------------------------
  const outDir = fixtureOutDir ?? path.join(cwd, DEFAULT_OUT_REL)
  let promoteRes
  try {
    promoteRes = promote({
      failure,
      outDir,
      dumpPath,
      rootCause: subagentRes.summary,
    })
  } catch (err) {
    return {
      promoted: false,
      summary: `repair: subagent verified but promote failed: ${(err as Error).message}`,
      status: 'verified',
    }
  }

  // ---- 5. Move dump failures/ → resolved/ --------------------------------
  mkdirSync(resolvedDir, { recursive: true })
  const resolvedPath = path.join(resolvedDir, path.basename(dumpPath))
  try {
    // Overwrite if a previous resolved copy exists.
    if (existsSync(resolvedPath)) {
      try {
        unlinkSync(resolvedPath)
      } catch {
        /* best-effort */
      }
    }
    renameSync(dumpPath, resolvedPath)
  } catch {
    // Cross-device rename can fail (rare in CI; defensive). Fall back to
    // copy + delete.
    try {
      copyFileSync(dumpPath, resolvedPath)
      unlinkSync(dumpPath)
    } catch {
      /* leave the failures/ copy in place; the promote already succeeded */
    }
  }

  return {
    promoted: true,
    fixturePath: promoteRes.fixturePath,
    summary: subagentRes.summary,
    status: 'verified',
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDumpPath(args: {
  failureId: string
  failuresDir: string
  resolvedDir: string
}): { dumpPath: string; alreadyResolved: boolean } {
  const { failureId, failuresDir, resolvedDir } = args

  // Absolute or relative-with-extension path?
  if (
    path.isAbsolute(failureId) ||
    failureId.endsWith('.md') ||
    failureId.includes(path.sep)
  ) {
    const abs = path.isAbsolute(failureId)
      ? failureId
      : path.resolve(failureId)
    if (!existsSync(abs)) {
      throw new Error(`repair: dump path not found: ${abs}`)
    }
    return { dumpPath: abs, alreadyResolved: false }
  }

  // Bare id → look in failures/ then resolved/.
  const inFailures = path.join(failuresDir, `${failureId}.md`)
  if (existsSync(inFailures)) {
    return { dumpPath: inFailures, alreadyResolved: false }
  }
  const inResolved = path.join(resolvedDir, `${failureId}.md`)
  if (existsSync(inResolved)) {
    return { dumpPath: inResolved, alreadyResolved: true }
  }
  throw new Error(
    `repair: dump for id '${failureId}' not found in ${failuresDir} ` +
      `or ${resolvedDir}`,
  )
}

// Silence unused-import warnings on the CLI bundling path — these are
// used in the cross-device-rename fallback above.
void readFileSync
void writeFileSync
