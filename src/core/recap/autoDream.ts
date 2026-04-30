// src/core/recap/autoDream.ts — Phase 14c §6.5
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { TaskManager } from '../tasks/manager'
import { buildConsolidationPrompt } from './consolidationPrompt'
import type { DreamSpec } from '../tasks/types'

const LOCK_FILE = '.dream.lock'

export type AutoDreamDeps = {
  home: string
  tasks: TaskManager
  config: { minHours: number; minSessions: number }
  now: () => number
  newSessionsCount: () => number
  lastConsolidatedAt: () => number
}

export function initAutoDream(deps: AutoDreamDeps): { tick: () => Promise<void>; stop: () => void } {
  const memdir = path.join(deps.home, '.nuka', 'memdir')
  let stopped = false

  const tick = async (): Promise<void> => {
    if (stopped) return

    // Gate 1: time since last consolidation
    const hoursSince = (deps.now() - deps.lastConsolidatedAt()) / 3_600_000
    if (hoursSince < deps.config.minHours) return

    // Gate 2: number of new sessions
    if (deps.newSessionsCount() < deps.config.minSessions) return

    // Gate 3: acquire lock (atomic create-exclusive)
    const lockFile = path.join(memdir, LOCK_FILE)
    try {
      fs.mkdirSync(memdir, { recursive: true })
      fs.writeFileSync(lockFile, JSON.stringify({ startedAt: deps.now(), pid: process.pid }), { flag: 'wx' })
    } catch {
      return // Another consolidator is running
    }

    const entries = listMemdirEntries(memdir)
    const spec: DreamSpec = {
      kind: 'dream',
      description: 'memdir consolidation',
      consolidationPrompt: buildConsolidationPrompt(entries),
      parentSessionId: 'system',
    }
    deps.tasks.enqueue(spec)
  }

  return {
    tick,
    stop: () => { stopped = true },
  }
}

function listMemdirEntries(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
}
