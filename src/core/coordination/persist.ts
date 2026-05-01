import * as fs from 'node:fs'
import * as path from 'node:path'
import { TaskGraph } from './taskGraph'
import type { TaskGraph as TaskGraphData } from './types'

/** Atomically write the graph to disk (tmp + rename to avoid partial writes). */
export function saveGraph(filePath: string, graph: TaskGraph): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(graph.toJSON(), null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

/**
 * Load a previously-saved graph. Returns `null` when:
 *   - the file does not exist
 *   - the file exists but cannot be parsed (corrupt JSON)
 *
 * The router's higher-level recovery decides whether to repair or discard.
 */
export function loadGraph(filePath: string): TaskGraph | null {
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const obj = JSON.parse(raw) as TaskGraphData
    return TaskGraph.fromJSON(obj)
  } catch {
    return null
  }
}
