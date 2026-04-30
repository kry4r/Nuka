// src/core/recap/fields/pipelines.ts — Phase 14c
// Groups harness stage events into pipeline nodes.
// Convention: sessionId in harness events uses "pipelineId/nodeId" format.
import type { RecapFields } from '../types'

type Rec = { topic: string; payload: any; t?: number }
type NodeEntry = { id: string; status: string; agent: string }

export function reducePipelines(records: Rec[]): RecapFields['pipelines'] {
  // Map pipelineId → Map<nodeId, NodeEntry>
  const pipes = new Map<string, Map<string, NodeEntry>>()

  for (const r of records) {
    const p = r.payload
    if (r.topic !== 'harness') continue
    if (p.type !== 'harness.stage.enter' && p.type !== 'harness.stage.exit') continue

    const sessionId: string = p.sessionId ?? ''
    // Parse pipelineId/nodeId from sessionId convention
    const slashIdx = sessionId.indexOf('/')
    if (slashIdx === -1) continue // no pipeline convention, skip

    const pipelineId = sessionId.slice(0, slashIdx)
    const nodeId = sessionId.slice(slashIdx + 1)
    const stage: string = p.stage ?? nodeId

    if (!pipes.has(pipelineId)) pipes.set(pipelineId, new Map())
    const nodes = pipes.get(pipelineId)!

    if (p.type === 'harness.stage.enter') {
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, { id: stage, status: 'running', agent: nodeId })
      }
    } else if (p.type === 'harness.stage.exit') {
      const node = nodes.get(nodeId)
      if (node) {
        node.status = p.reason === 'error' ? 'failed' : 'completed'
      } else {
        nodes.set(nodeId, { id: stage, status: 'completed', agent: nodeId })
      }
    }
  }

  return [...pipes.entries()].map(([pipelineId, nodesMap]) => ({
    pipelineId,
    nodes: [...nodesMap.values()],
  }))
}
