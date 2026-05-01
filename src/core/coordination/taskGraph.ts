import type { Difficulty } from '../harness/types'
import type { SubTask, SubTaskId, TaskGraph as TaskGraphData } from './types'

/**
 * In-memory mutable wrapper around `TaskGraphData` providing CRUD,
 * Kahn-style topological sort, and JSON round-tripping.
 *
 * Design notes:
 *   - `markListening` is treated as "done enough" for downstream readiness
 *     (hell-mode a2a needs the agent to keep firing for unstarted dependents
 *      while not blocking dependents from running).
 *   - `link(from, to, reason)` adds BOTH a correlation AND a `dependsOn`
 *     edge if the destination already exists; otherwise it only records
 *     the correlation (caller is expected to add the destination separately).
 */
export class TaskGraph {
  private data: TaskGraphData

  constructor(opts: { rootMessage: string; difficulty: Difficulty }) {
    this.data = {
      rootMessage: opts.rootMessage,
      difficulty: opts.difficulty,
      nodes: {},
      correlations: [],
    }
  }

  add(task: SubTask): void {
    this.data.nodes[task.id] = task
  }

  link(from: SubTaskId, to: SubTaskId, reason: string): void {
    // dedupe correlation
    const exists = this.data.correlations.some(
      (c) => (c.between[0] === from && c.between[1] === to) || (c.between[0] === to && c.between[1] === from),
    )
    if (!exists) {
      this.data.correlations.push({ between: [from, to], reason })
    }
    // also wire dependency if both nodes exist
    const dst = this.data.nodes[to]
    if (dst && !dst.dependsOn.includes(from)) dst.dependsOn.push(from)
    const src = this.data.nodes[from]
    if (src && !src.contextFor.includes(to)) src.contextFor.push(to)
  }

  /** Tasks whose dependsOn are all `done` or `listening`, that are themselves still pending. */
  ready(): SubTask[] {
    const isResolved = (id: SubTaskId): boolean => {
      const n = this.data.nodes[id]
      return !!n && (n.status === 'done' || n.status === 'listening')
    }
    return Object.values(this.data.nodes).filter(
      (t) => t.status === 'pending' && t.dependsOn.every(isResolved),
    )
  }

  markRunning(id: SubTaskId, agentId: string): void {
    const t = this.data.nodes[id]
    if (!t) throw new Error(`unknown task ${id}`)
    t.status = 'running'
    t.agentId = agentId
  }

  markListening(id: SubTaskId): void {
    const t = this.data.nodes[id]
    if (!t) throw new Error(`unknown task ${id}`)
    t.status = 'listening'
  }

  markDone(id: SubTaskId, result: { summary: string; artifacts: string[] }): void {
    const t = this.data.nodes[id]
    if (!t) throw new Error(`unknown task ${id}`)
    t.status = 'done'
    t.result = result
  }

  markFailed(id: SubTaskId, summary: string): void {
    const t = this.data.nodes[id]
    if (!t) throw new Error(`unknown task ${id}`)
    t.status = 'failed'
    t.result = { summary, artifacts: [] }
  }

  /**
   * Kahn's algorithm: returns task IDs in dependency order. Throws on cycle.
   * Cross-level edges are handled (graph need not be layered).
   */
  toposort(): SubTaskId[] {
    const indeg: Record<SubTaskId, number> = {}
    for (const id of Object.keys(this.data.nodes)) indeg[id] = this.data.nodes[id].dependsOn.length
    const queue: SubTaskId[] = Object.keys(indeg).filter((id) => indeg[id] === 0)
    const out: SubTaskId[] = []
    while (queue.length) {
      const id = queue.shift() as SubTaskId
      out.push(id)
      const node = this.data.nodes[id]
      // every node that depends on `id` has its indeg decremented
      for (const otherId of Object.keys(this.data.nodes)) {
        const other = this.data.nodes[otherId]
        if (other.dependsOn.includes(id)) {
          indeg[otherId] -= 1
          if (indeg[otherId] === 0) queue.push(otherId)
        }
      }
      void node
    }
    if (out.length !== Object.keys(this.data.nodes).length) {
      throw new Error('cycle detected in TaskGraph')
    }
    return out
  }

  snapshot(): TaskGraphData {
    return JSON.parse(JSON.stringify(this.data)) as TaskGraphData
  }

  toJSON(): TaskGraphData {
    return this.snapshot()
  }

  static fromJSON(raw: TaskGraphData): TaskGraph {
    const g = new TaskGraph({ rootMessage: raw.rootMessage, difficulty: raw.difficulty })
    g.data = JSON.parse(JSON.stringify(raw)) as TaskGraphData
    return g
  }
}
