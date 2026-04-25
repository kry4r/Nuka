// src/core/plan/state.ts
//
// Phase 8 §4.4 — per-cwd plan persistence.
//
// A plan is a plain Markdown document stored at
//   ~/.nuka/plans/<sha1(cwd)>.md
// so every working directory gets its own plan without collisions. The
// file is written atomically (tmp + rename) and missing files read as
// empty strings — callers treat "no file" and "empty plan" identically.

import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'

/**
 * Resolve the plan-file path for a given cwd. The basename is SHA1(cwd)
 * so we never expose the user's directory name in the filesystem and so
 * any path (including non-POSIX characters on Windows) maps safely.
 */
export function planFilePath(cwd: string, home: string = os.homedir()): string {
  const digest = createHash('sha1').update(cwd).digest('hex')
  return path.join(home, '.nuka', 'plans', `${digest}.md`)
}

/** Ensure the parent directory for a plan file exists. */
async function ensurePlanDir(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
}

/** Read the plan, returning '' when no file is present. */
export async function readPlan(cwd: string, home?: string): Promise<string> {
  const file = planFilePath(cwd, home)
  try {
    return await readFile(file, 'utf8')
  } catch {
    return ''
  }
}

/** Overwrite the plan with `text` (atomic). */
export async function writePlan(cwd: string, text: string, home?: string): Promise<void> {
  const file = planFilePath(cwd, home)
  await ensurePlanDir(file)
  const tmp = file + '.tmp'
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}

/** Append `text` to the plan, separated by a blank line if the plan is non-empty. */
export async function appendPlan(cwd: string, text: string, home?: string): Promise<void> {
  const current = await readPlan(cwd, home)
  const trimmed = current.endsWith('\n') || current === '' ? current : current + '\n'
  const next = current === '' ? text : trimmed + '\n' + text
  await writePlan(cwd, next.endsWith('\n') ? next : next + '\n', home)
}

/** Delete the plan file. No-op when it does not exist. */
export async function clearPlan(cwd: string, home?: string): Promise<void> {
  const file = planFilePath(cwd, home)
  await unlink(file).catch(() => undefined)
}
