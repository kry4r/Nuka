import * as fs from 'node:fs'
import * as path from 'node:path'
import { tasksDir } from '../paths'
import type { Task, TaskKind, TaskState } from './types'
import type { ProgressTrackerSnapshot } from './progressTracker'

export type TaskMeta = {
  id: string
  kind: TaskKind
  state: TaskState
  startedAt: number
  finishedAt?: number
  agentName?: string
  teamName?: string
  progress?: ProgressTrackerSnapshot
  lastEventSeq?: number
}

export function metaPath(home: string, id: string): string {
  return path.join(tasksDir(home), `${id}.meta.json`)
}

export function writeMeta(home: string, meta: TaskMeta): void {
  const file = metaPath(home, meta.id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export function readMeta(home: string, id: string): TaskMeta | undefined {
  const file = metaPath(home, id)
  if (!fs.existsSync(file)) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as TaskMeta
  } catch {
    return undefined
  }
}

export function fromTask(t: Task): TaskMeta {
  return {
    id: t.id,
    kind: t.kind,
    state: t.state,
    startedAt: t.startedAt ?? Date.now(),
    finishedAt: t.finishedAt,
    agentName: t.agentName,
    teamName: t.teamName,
    progress: t.progress,
  }
}
