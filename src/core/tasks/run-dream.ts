// src/core/tasks/run-dream.ts — Phase 14c §6.5 (replaces foundation stub)
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Task } from './types'
import type { DreamSpec } from './types'

export type RunDreamDeps = {
  home: string
  runFork: (prompt: string) => Promise<{ text: string }>
}

export async function runDream(task: Task, signal: AbortSignal, deps?: RunDreamDeps): Promise<void> {
  if (!deps) throw new Error('run-dream: deps required')

  const spec = task.spec as DreamSpec
  const { text } = await deps.runFork(spec.consolidationPrompt)

  if (signal.aborted) return

  const memdir = path.join(deps.home, '.nuka', 'memdir')
  fs.mkdirSync(memdir, { recursive: true })

  // Write the consolidated entry
  fs.writeFileSync(path.join(memdir, `consolidated-${Date.now()}.md`), text, 'utf8')

  // Release lock
  const lockFile = path.join(memdir, '.dream.lock')
  if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile)

  // Update lastConsolidatedAt sidecar
  fs.writeFileSync(
    path.join(memdir, '.dream.meta.json'),
    JSON.stringify({ lastConsolidatedAt: Date.now() }),
    'utf8'
  )
}
