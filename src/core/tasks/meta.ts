import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { tasksDir } from '../paths'
import type { Task, TaskKind, TaskState } from './types'
import type { ProgressTrackerSnapshot } from './progressTracker'

export type TaskMeta = {
  id: string
  kind: TaskKind
  state: TaskState
  startedAt: number
  finishedAt?: number
  agentId?: string
  agentName?: string
  agentTask?: string
  agentContext?: string
  resumed?: boolean
  providerId?: string
  model?: string
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
  const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
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

export function listMeta(home: string): TaskMeta[] {
  let entries: string[]
  const dir = tasksDir(home)
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: TaskMeta[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) continue
    const id = entry.slice(0, -'.meta.json'.length)
    const meta = readMeta(home, id)
    if (meta) out.push(meta)
  }
  return out
}

export function findLatestMetaByAgentId(
  home: string,
  agentId: string,
): TaskMeta | undefined {
  return listMeta(home)
    .filter(meta => meta.agentId === agentId)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
}

export function fromTask(t: Task): TaskMeta {
  const localAgent = t.spec.kind === 'local_agent' ? t.spec : undefined
  return {
    id: t.id,
    kind: t.kind,
    state: t.state,
    startedAt: t.startedAt ?? Date.now(),
    finishedAt: t.finishedAt,
    agentId: t.agentId,
    agentName: t.agentName ?? localAgent?.agentName,
    agentTask: localAgent?.task,
    agentContext: localAgent?.context,
    resumed: localAgent?.resumed,
    providerId: localAgent?.providerId,
    model: localAgent?.model,
    teamName: t.teamName,
    progress: t.progress,
  }
}
