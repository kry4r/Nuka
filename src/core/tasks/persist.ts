// src/core/tasks/persist.ts
//
// Phase 10 §4.3 — disk persistence for task output.
//
// Each task gets a single append-only log file under
//   <home>/.nuka/tasks/<id>.log
// `home` is injected (not read from `os.homedir()`) so tests can use a
// tmpdir without polluting the real home directory.

import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

export function tasksDir(home: string): string {
  return path.join(home, '.nuka', 'tasks')
}

export function taskOutputPath(home: string, id: string): string {
  return path.join(tasksDir(home), `${id}.log`)
}

/** Ensure the tasks directory exists (no-op if already present). */
export async function ensureTasksDir(home: string): Promise<string> {
  const dir = tasksDir(home)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

/** Synchronous variant — used by `TaskManager.enqueue` so the directory
 *  is guaranteed to exist before the runner fires its first append. */
export function ensureTasksDirSync(home: string): string {
  const dir = tasksDir(home)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Append a chunk of text to the task's output log. Synchronous for
 * tight write loops (e.g. spawn stdout chunks). Returns the number of
 * bytes written.
 */
export function appendOutputSync(file: string, chunk: string | Buffer): number {
  const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
  fs.appendFileSync(file, buf)
  return buf.length
}

/**
 * Read the last `n` lines of the task's output log. Returns an empty
 * array if the file does not exist. Used by `/tasks show <id>`.
 */
export async function tailOutput(file: string, lines: number): Promise<string[]> {
  let text: string
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const all = text.split('\n')
  // Drop a trailing empty element if the file ended with a newline.
  if (all.length > 0 && all[all.length - 1] === '') all.pop()
  return all.slice(-lines)
}
