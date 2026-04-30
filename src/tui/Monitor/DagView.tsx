// src/tui/Monitor/DagView.tsx
import * as React from 'react'
import { PipelineDetail } from '../Tasks/PipelineDetail'

export function DagView(p: { nodes: Array<{ id: string; agentName: string; status: string; parents: string[] }> }): React.ReactNode {
  return <PipelineDetail pipelineId="live" nodes={p.nodes} />
}
